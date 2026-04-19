/**
 * SessionVault — public session-backed envelope vault API.
 *
 * Opens the CLI's encrypted vault file once per session (one KeyProvider
 * prompt), caches the decrypted contents in RAM, and serves reads without
 * further prompts. External writes (e.g. the CLI in another shell) become
 * visible via mtime-check coherence on every read.
 *
 * Addresses the per-item Keychain-prompt problem flagged in issue #40:
 * long-running daemons (centient-labs/maintainer) holding N credentials
 * across a long lifetime should not reach into the OS keychain on every
 * access. Envelope encryption with a single master-key unlock matches
 * industry standard (KMS, HashiCorp Vault, 1Password, Bitwarden).
 *
 * ## Threat model (what this protects and doesn't)
 *
 * - Protects against filesystem-read-only adversaries (ciphertext is AEAD
 *   encrypted; forging plaintext requires the master key).
 * - Protects against live-session and cold-start vault-file rollback by a
 *   filesystem-write-only adversary via the combined in-payload
 *   `vaultVersion` + sidecar-file `highestSeenVersion` scheme.
 * - Does NOT protect against an adversary with **both** master-key access
 *   and filesystem write — game over for any local envelope vault.
 * - Does NOT protect against an adversary with write access to the vault
 *   directory who chooses to downgrade both vault and sidecar in lockstep
 *   — the sidecar lives next to the vault. If your threat model includes
 *   adversarial writes to `~/.centient/secrets/`, use a secrets service
 *   with remote attestation (HashiCorp Vault, AWS Secrets Manager,
 *   1Password Connect) instead.
 * - Session key is in process RAM for the full session lifetime. Any code
 *   with execution in the process has access to all secrets in the vault.
 *   Operators running daemons with this API SHOULD disable core dumps
 *   (`ulimit -c 0` / `prlimit --core=0`) and disable the Node.js inspector
 *   (`NODE_OPTIONS=--inspect` grants heap read to anyone on the inspector
 *   socket — a full master-key compromise vector).
 * - On macOS, a newly-started process will still prompt the user for
 *   Keychain access even if another process holds the vault open.
 *   Keychain ACLs are per-process, not per-vault-file.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  renameSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
  openSync,
  closeSync,
} from "fs";
import { dirname, resolve as pathResolve } from "path";
import { homedir } from "os";
import { join } from "path";
import { createHash, randomBytes } from "crypto";

import { encryptObject, decryptObject } from "../crypto/vault-common.js";
import { resolveKeyProvider } from "../key-providers/resolve.js";
import type { KeyProviderType } from "../key-providers/types.js";
import { runBeforeHooks, runAfterHooks } from "./policy.js";

// =============================================================================
// Constants
// =============================================================================

/** Current payload schema version — bump requires a compat migration. */
export const VAULT_SCHEMA_VERSION = 1;

/** Default vault file location — same path the CLI uses, so they share state. */
export const DEFAULT_VAULT_PATH = join(homedir(), ".centient", "secrets", "vault.enc");

/** Default sidecar location — stores highest-ever-seen vault version. */
export const DEFAULT_SIDECAR_PATH = join(
  homedir(),
  ".centient",
  "secrets",
  "vault.seen-version",
);

/** Max time a writer will wait to acquire the file lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;

/** Poll interval when waiting on a held lock. */
const LOCK_RETRY_INTERVAL_MS = 25;

/** Stale-lock threshold — if a lock file is older than this, assume crash. */
const LOCK_STALE_MS = 30_000;

// =============================================================================
// Errors
// =============================================================================

/** Base class for SessionVault errors. */
export class VaultError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "VaultError";
  }
}

/** Thrown when the master key can't be retrieved from the configured provider. */
export class VaultUnlockError extends VaultError {
  constructor(message: string) {
    super("VAULT_UNLOCK_FAILED", message);
    this.name = "VaultUnlockError";
  }
}

/** Thrown when decryption fails — wrong key, corrupted file, or AAD mismatch. */
export class VaultDecryptError extends VaultError {
  constructor(message: string) {
    super("VAULT_DECRYPT_FAILED", message);
    this.name = "VaultDecryptError";
  }
}

/** Thrown when rollback is detected and not explicitly accepted. */
export class VaultRollbackError extends VaultError {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      "VAULT_VERSION_ROLLBACK_DETECTED",
      `Vault version rollback detected: sidecar expects version >= ${expected}, ` +
        `but vault file reports version ${actual}. If this is an intentional ` +
        `restore, pass { acceptRollback: true } to openVault().`,
    );
    this.name = "VaultRollbackError";
  }
}

/** Thrown when operations are attempted on a closed vault. */
export class VaultClosedError extends VaultError {
  constructor() {
    super("VAULT_CLOSED", "Vault has been closed; reopen with openVault() to continue.");
    this.name = "VaultClosedError";
  }
}

/** Thrown when the write-path file lock can't be acquired within the timeout. */
export class VaultLockError extends VaultError {
  constructor(message: string) {
    super("VAULT_LOCK_FAILED", message);
    this.name = "VaultLockError";
  }
}

// =============================================================================
// Payload shape
// =============================================================================

/**
 * The encrypted payload stored inside the vault file.
 *
 * Format commitment: once this shape ships, changing it is a breaking change.
 * The `schema` field exists so future migrations can detect payload format
 * without guessing, and the AAD binds `schema` + `vault-path` so a v2 payload
 * cannot be substituted into a v1 vault path undetected.
 */
interface VaultPayload {
  /** Payload schema version — currently 1. */
  schema: number;
  /** Monotonic version that increments on every successful write. */
  vaultVersion: number;
  /** The actual secrets: name → value. */
  secrets: Record<string, string>;
}

// =============================================================================
// Options / public types
// =============================================================================

export type CoherenceStrategy = "mtime-check" | "strict" | "best-effort";

export interface OpenVaultOptions {
  /** Alternate vault file path. Defaults to the same path the CLI uses. */
  path?: string;
  /** Alternate sidecar path. Defaults to vault directory + `vault.seen-version`. */
  sidecarPath?: string;
  /**
   * Coherence strategy for concurrent external writes. Default `mtime-check`:
   * stat on every read; re-decrypt if mtime advanced. `strict` throws on stale
   * snapshot. `best-effort` keeps the in-memory snapshot until `reload()`.
   */
  coherence?: CoherenceStrategy;
  /**
   * Opt-in acceptance of a detected rollback (sidecar version > vault version).
   * Emits a scary warning on stderr. Use only when the operator explicitly
   * intends to restore an older vault (backup restore, etc.).
   */
  acceptRollback?: boolean;
  /**
   * Opt-in acceptance of a missing sidecar. Default behaviour when the sidecar
   * is absent is to emit a stderr warning and auto-initialize
   * `seenVersion = vaultVersion`. Passing `true` suppresses the warning for
   * known-first-use contexts (test fixtures, fresh installs).
   */
  acceptMissingSidecar?: boolean;
  /**
   * Optional auto-close TTL in milliseconds. Not set by default — daemons run
   * forever; forced re-auth undoes the point of a session vault. Useful for
   * short-lived script consumers that want defense-in-depth.
   */
  ttlMs?: number;
}

export interface SessionVault {
  /** Read a secret by name. Returns null if the name isn't in the vault. */
  get(name: string): Promise<string | null>;
  /** List all secret names, optionally prefix-filtered. Sorted ascending. */
  list(prefix?: string): Promise<string[]>;
  /** Write a secret. Re-encrypts and saves the vault file atomically. */
  set(name: string, value: string): Promise<void>;
  /** Delete a secret. Returns true if the name existed and was removed. */
  delete(name: string): Promise<boolean>;
  /** Force an immediate reload from disk regardless of coherence strategy. */
  reload(): Promise<void>;
  /** Release the session key and in-memory state. No-op if already closed. */
  close(): void;
  /** Diagnostic — the KeyProvider that unlocked this session. */
  readonly provider: KeyProviderType;
  /** Diagnostic — absolute path of the vault file. */
  readonly path: string;
  /** Diagnostic — the current in-memory vault version. */
  readonly vaultVersion: number;
}

// =============================================================================
// File lock (native, no new dependency)
// =============================================================================

/**
 * Acquire an exclusive write lock via O_EXCL on `{vaultPath}.lock`. Polls up
 * to LOCK_TIMEOUT_MS. Locks older than LOCK_STALE_MS are considered orphaned
 * (the holding process crashed) and stolen. Returns a release function.
 *
 * Filesystem-level locks are advisory: a cooperating writer must call this
 * before mutating the vault. We don't need a lock on the read path — the
 * mtime-check coherence strategy handles stale reads.
 */
function acquireWriteLock(vaultPath: string): () => void {
  const lockPath = `${vaultPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // Lock file may have been removed by stale-lock stealing in another
          // process; ignore — our critical section is over regardless.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // Check for stale lock.
      try {
        const lockStat = statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(lockPath);
          } catch {
            // Another process may have already stolen it; loop and retry.
          }
          continue;
        }
      } catch {
        // Lock was just released; loop and retry.
      }

      // Busy wait — synchronous lock acquisition is deliberate here. Callers
      // invoke set()/delete() in async contexts but we don't yield while
      // holding the lock so we never deadlock against another Node task
      // holding it on the same event loop.
      const sleepUntil = Date.now() + LOCK_RETRY_INTERVAL_MS;
      while (Date.now() < sleepUntil) {
        // Spin.
      }
    }
  }

  throw new VaultLockError(
    `Timed out after ${LOCK_TIMEOUT_MS}ms waiting for vault write lock at ${lockPath}`,
  );
}

// =============================================================================
// AAD derivation
// =============================================================================

/**
 * Derive Additional Authenticated Data binding ciphertext to its vault
 * identity. A payload encrypted for vault A cannot be substituted into
 * vault B (different path) without failing auth-tag verification.
 */
function deriveAad(absoluteVaultPath: string, schema: number): Buffer {
  return createHash("sha256")
    .update(`centient-secrets-vault:v${schema}:${absoluteVaultPath}`)
    .digest();
}

// =============================================================================
// Sidecar I/O
// =============================================================================

interface SidecarContent {
  /** Highest vault version ever successfully observed. Monotonic. */
  highestSeenVersion: number;
}

function readSidecar(path: string): SidecarContent | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = (parsed as { highestSeenVersion?: unknown }).highestSeenVersion;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
    return { highestSeenVersion: v };
  } catch {
    return null;
  }
}

/**
 * Atomically write the sidecar with mode 0600. Uses temp-file-then-rename
 * so a crash during the write can't leave a half-written sidecar that would
 * fail JSON parse on the next open.
 */
function writeSidecar(path: string, content: SidecarContent): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmpPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(content), { mode: 0o600 });
  renameSync(tmpPath, path);
}

/**
 * Check sidecar file mode; warn on stderr if not 0600.
 * Symmetric to the vault-file permission check — a world-readable sidecar
 * leaks version-number side-channel (write frequency, rollback attempts) and
 * signals that filesystem permissions around the vault are broken.
 */
function checkSidecarPerms(path: string): void {
  if (!existsSync(path)) return;
  try {
    const st = statSync(path);
    const worldOrGroup = st.mode & 0o077;
    if (worldOrGroup !== 0) {
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${path} has permissive mode ` +
          `${(st.mode & 0o777).toString(8).padStart(3, "0")}; expected 600. ` +
          `Fix with: chmod 600 ${path}\n`,
      );
    }
  } catch {
    // Stat failure is handled by subsequent read attempts.
  }
}

function checkVaultPerms(path: string): void {
  if (!existsSync(path)) return;
  try {
    const st = statSync(path);
    const worldOrGroup = st.mode & 0o077;
    if (worldOrGroup !== 0) {
      process.stderr.write(
        `[secrets] WARNING: vault file ${path} has permissive mode ` +
          `${(st.mode & 0o777).toString(8).padStart(3, "0")}; expected 600. ` +
          `Fix with: chmod 600 ${path}\n`,
      );
    }
  } catch {
    // Stat failure is handled by subsequent read attempts.
  }
}

// =============================================================================
// openVault — factory
// =============================================================================

export async function openVault(opts: OpenVaultOptions = {}): Promise<SessionVault> {
  const vaultPath = pathResolve(opts.path ?? DEFAULT_VAULT_PATH);
  const sidecarPath = pathResolve(
    opts.sidecarPath ?? join(dirname(vaultPath), "vault.seen-version"),
  );
  const coherence: CoherenceStrategy = opts.coherence ?? "mtime-check";
  const ttlMs = opts.ttlMs;

  if (!existsSync(vaultPath)) {
    throw new VaultError(
      "VAULT_NOT_FOUND",
      `Vault file not found at ${vaultPath}. Initialize with \`centient secrets init\`.`,
    );
  }

  checkVaultPerms(vaultPath);
  checkSidecarPerms(sidecarPath);

  // --- Unlock via configured KeyProvider ---
  const providerResult = resolveKeyProvider();
  if (!providerResult.ok) {
    throw new VaultUnlockError(providerResult.error.message);
  }
  const provider = providerResult.provider;
  const key = provider.getKey();
  if (!key) {
    throw new VaultUnlockError(
      `KeyProvider ${provider.name} returned no key — master key not configured or access denied.`,
    );
  }

  const aad = deriveAad(vaultPath, VAULT_SCHEMA_VERSION);

  // --- Load initial snapshot ---
  let initialStat = statSync(vaultPath);
  const initialBytes = readFileSync(vaultPath);
  const decoded = decryptObject(initialBytes, key, aad);
  if (decoded === null) {
    key.fill(0);
    throw new VaultDecryptError(
      `Failed to decrypt vault at ${vaultPath} — wrong key, corrupted file, or AAD mismatch (schema version ${VAULT_SCHEMA_VERSION}).`,
    );
  }

  const payload = validatePayload(decoded);
  if (payload === null) {
    // Back-compat path: legacy vaults (pre-schema) contain a flat
    // `{ name: value }` map. Treat as schema 0 and upgrade on first write.
    const legacy: Record<string, string> = {};
    for (const [k, v] of Object.entries(decoded)) {
      if (typeof v === "string") legacy[k] = v;
    }
    return buildVault({
      vaultPath,
      sidecarPath,
      provider: provider.name as KeyProviderType,
      coherence,
      key,
      aad,
      currentSecrets: legacy,
      currentVersion: 0,
      mtimeMs: initialStat.mtimeMs,
      ttlMs,
    });
  }

  // --- Rollback check ---
  const sidecar = readSidecar(sidecarPath);
  if (sidecar === null) {
    if (opts.acceptMissingSidecar !== true) {
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${sidecarPath} is missing. ` +
          `Rollback protection is weakened until the sidecar is rebuilt. ` +
          `Auto-initializing seenVersion=${payload.vaultVersion}. ` +
          `Pass { acceptMissingSidecar: true } to suppress this warning.\n`,
      );
    }
    writeSidecar(sidecarPath, { highestSeenVersion: payload.vaultVersion });
  } else if (payload.vaultVersion < sidecar.highestSeenVersion) {
    if (opts.acceptRollback !== true) {
      key.fill(0);
      throw new VaultRollbackError(sidecar.highestSeenVersion, payload.vaultVersion);
    }
    process.stderr.write(
      `[secrets] WARNING: accepting intentional rollback from version ` +
        `${sidecar.highestSeenVersion} down to ${payload.vaultVersion}. ` +
        `This weakens rollback-detection protection. Sidecar will be ` +
        `updated to match.\n`,
    );
    writeSidecar(sidecarPath, { highestSeenVersion: payload.vaultVersion });
  } else if (payload.vaultVersion > sidecar.highestSeenVersion) {
    writeSidecar(sidecarPath, { highestSeenVersion: payload.vaultVersion });
  }

  return buildVault({
    vaultPath,
    sidecarPath,
    provider: provider.name as KeyProviderType,
    coherence,
    key,
    aad,
    currentSecrets: { ...payload.secrets },
    currentVersion: payload.vaultVersion,
    mtimeMs: initialStat.mtimeMs,
    ttlMs,
  });
}

// =============================================================================
// buildVault — private constructor
// =============================================================================

interface BuildVaultArgs {
  vaultPath: string;
  sidecarPath: string;
  provider: KeyProviderType;
  coherence: CoherenceStrategy;
  key: Buffer;
  aad: Buffer;
  currentSecrets: Record<string, string>;
  currentVersion: number;
  mtimeMs: number;
  ttlMs: number | undefined;
}

function buildVault(args: BuildVaultArgs): SessionVault {
  let key: Buffer | null = args.key;
  let secrets = args.currentSecrets;
  let vaultVersion = args.currentVersion;
  let mtimeMs = args.mtimeMs;
  let closed = false;

  let ttlTimer: NodeJS.Timeout | null = null;
  if (args.ttlMs !== undefined) {
    ttlTimer = setTimeout(() => {
      closeInternal();
    }, args.ttlMs);
    ttlTimer.unref();
  }

  const assertOpen = (): void => {
    if (closed || key === null) throw new VaultClosedError();
  };

  /**
   * Refresh in-memory state from disk if the coherence strategy says to and
   * mtime has advanced. Returns silently on a best-effort mismatch; throws
   * VaultDecryptError on any actual failure.
   */
  const maybeReload = (): void => {
    if (args.coherence === "best-effort") return;
    if (!existsSync(args.vaultPath)) {
      throw new VaultError(
        "VAULT_FILE_MISSING",
        `Vault file ${args.vaultPath} was removed while open.`,
      );
    }
    const st = statSync(args.vaultPath);
    if (st.mtimeMs === mtimeMs) return;
    if (args.coherence === "strict" && st.mtimeMs > mtimeMs) {
      // `strict` means the caller wants an explicit reload(); block reads.
      throw new VaultError(
        "VAULT_STALE_SNAPSHOT",
        `Vault file modified externally (mtime ${st.mtimeMs} vs session ${mtimeMs}); call reload() to continue.`,
      );
    }
    const bytes = readFileSync(args.vaultPath);
    const decoded = decryptObject(bytes, key!, args.aad);
    if (decoded === null) {
      throw new VaultDecryptError(
        "Failed to decrypt vault after external change — key may have rotated or file may be corrupted.",
      );
    }
    const payload = validatePayload(decoded);
    if (payload !== null) {
      secrets = { ...payload.secrets };
      vaultVersion = payload.vaultVersion;
      mtimeMs = st.mtimeMs;
      const sidecar = readSidecar(args.sidecarPath);
      if (sidecar === null || payload.vaultVersion > sidecar.highestSeenVersion) {
        writeSidecar(args.sidecarPath, { highestSeenVersion: payload.vaultVersion });
      }
    }
  };

  const writeOp = (mutator: (current: Record<string, string>) => void): void => {
    assertOpen();
    const release = acquireWriteLock(args.vaultPath);
    try {
      maybeReload();
      const next = { ...secrets };
      mutator(next);
      const nextVersion = vaultVersion + 1;
      const payload: VaultPayload = {
        schema: VAULT_SCHEMA_VERSION,
        vaultVersion: nextVersion,
        secrets: next,
      };
      const encrypted = encryptObject(payload as unknown as Record<string, unknown>, key!, args.aad);
      if (encrypted === null) {
        throw new VaultError("VAULT_ENCRYPT_FAILED", "Encryption returned null — corrupted state.");
      }
      // Atomic vault write: temp file (mode 0600) + rename.
      mkdirSync(dirname(args.vaultPath), { recursive: true, mode: 0o700 });
      const tmpVault = `${args.vaultPath}.${randomBytes(8).toString("hex")}.tmp`;
      writeFileSync(tmpVault, encrypted, { mode: 0o600 });
      renameSync(tmpVault, args.vaultPath);
      // Enforce mode on the committed file in case the FS didn't honor the
      // temp-file mode on rename across some filesystems.
      try {
        chmodSync(args.vaultPath, 0o600);
      } catch {
        // Non-fatal; continue.
      }
      // Sidecar update trails the vault write so a crash between them leaves
      // the sidecar lagging (graceful: catches up on next write) rather than
      // ahead (would false-positive rollback detection).
      const sidecar = readSidecar(args.sidecarPath);
      const newHighest = Math.max(sidecar?.highestSeenVersion ?? 0, nextVersion);
      writeSidecar(args.sidecarPath, { highestSeenVersion: newHighest });

      // Commit in-memory state only after both files land successfully.
      secrets = next;
      vaultVersion = nextVersion;
      mtimeMs = statSync(args.vaultPath).mtimeMs;
    } finally {
      release();
    }
  };

  const closeInternal = (): void => {
    if (closed) return;
    closed = true;
    if (ttlTimer !== null) {
      clearTimeout(ttlTimer);
      ttlTimer = null;
    }
    if (key !== null) {
      // Best-effort key zeroing. Note: `Buffer.fill(0)` zeroes the allocation,
      // but if the key ever transited through a string (accidental `String(buf)`,
      // `util.inspect`, `console.log`), those copies linger until V8 GC. This
      // API can't guarantee full memory wipe; callers concerned about residue
      // should also restrict inspector access and disable core dumps.
      key.fill(0);
      key = null;
    }
    // Wipe plaintext secret values too (best-effort, same caveats).
    for (const k of Object.keys(secrets)) {
      secrets[k] = "";
    }
    secrets = {};
  };

  return {
    async get(name: string): Promise<string | null> {
      assertOpen();
      await runBeforeHooks({ type: "read", key: name });
      const start = Date.now();
      try {
        maybeReload();
        const value = name in secrets ? secrets[name]! : null;
        runAfterHooks({
          type: value === null ? "credential_read_missing" : "credential_read",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          durationMs: Date.now() - start,
        });
        return value;
      } catch (err) {
        runAfterHooks({
          type: "credential_read_failed",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
        throw err;
      }
    },

    async list(prefix?: string): Promise<string[]> {
      assertOpen();
      await runBeforeHooks({ type: "enumerate", prefix });
      const start = Date.now();
      try {
        maybeReload();
        const names = Object.keys(secrets).sort();
        const filtered =
          prefix === undefined ? names : names.filter((n) => n.startsWith(prefix));
        runAfterHooks({
          type: "credential_enumerated",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          prefix,
          keyCount: filtered.length,
          durationMs: Date.now() - start,
        });
        return filtered;
      } catch (err) {
        runAfterHooks({
          type: "credential_enumerate_failed",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          prefix,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
        throw err;
      }
    },

    async set(name: string, value: string): Promise<void> {
      assertOpen();
      validateName(name);
      await runBeforeHooks({ type: "write", key: name });
      const start = Date.now();
      try {
        writeOp((current) => {
          current[name] = value;
        });
        runAfterHooks({
          type: "credential_written",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        runAfterHooks({
          type: "credential_write_failed",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
        throw err;
      }
    },

    async delete(name: string): Promise<boolean> {
      assertOpen();
      await runBeforeHooks({ type: "delete", key: name });
      const start = Date.now();
      try {
        if (!(name in secrets)) {
          runAfterHooks({
            type: "credential_delete_failed",
            timestamp: new Date(start).toISOString(),
            backend: "session-vault",
            key: name,
            error: "not found",
            durationMs: Date.now() - start,
          });
          return false;
        }
        writeOp((current) => {
          delete current[name];
        });
        runAfterHooks({
          type: "credential_deleted",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          durationMs: Date.now() - start,
        });
        return true;
      } catch (err) {
        runAfterHooks({
          type: "credential_delete_failed",
          timestamp: new Date(start).toISOString(),
          backend: "session-vault",
          key: name,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
        throw err;
      }
    },

    async reload(): Promise<void> {
      assertOpen();
      if (!existsSync(args.vaultPath)) {
        throw new VaultError(
          "VAULT_FILE_MISSING",
          `Vault file ${args.vaultPath} was removed while open.`,
        );
      }
      const st = statSync(args.vaultPath);
      const bytes = readFileSync(args.vaultPath);
      const decoded = decryptObject(bytes, key!, args.aad);
      if (decoded === null) {
        throw new VaultDecryptError(
          "Failed to decrypt vault during reload — key may have rotated or file may be corrupted.",
        );
      }
      const payload = validatePayload(decoded);
      if (payload !== null) {
        secrets = { ...payload.secrets };
        vaultVersion = payload.vaultVersion;
        mtimeMs = st.mtimeMs;
      }
    },

    close(): void {
      closeInternal();
    },

    get provider(): KeyProviderType {
      return args.provider;
    },
    get path(): string {
      return args.vaultPath;
    },
    get vaultVersion(): number {
      return vaultVersion;
    },
  };
}

// =============================================================================
// Validation helpers
// =============================================================================

function validatePayload(decoded: Record<string, unknown>): VaultPayload | null {
  if (
    typeof decoded["schema"] !== "number" ||
    typeof decoded["vaultVersion"] !== "number" ||
    typeof decoded["secrets"] !== "object" ||
    decoded["secrets"] === null ||
    Array.isArray(decoded["secrets"])
  ) {
    return null;
  }
  const secretsObj = decoded["secrets"] as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(secretsObj)) {
    if (typeof v !== "string") return null;
    secrets[k] = v;
  }
  return {
    schema: decoded["schema"] as number,
    vaultVersion: decoded["vaultVersion"] as number,
    secrets,
  };
}

/**
 * Reject names with control characters, path separators, or null bytes. The
 * CLI-facing library accepts anything historically; the public API is a good
 * place to constrain against callers that might route user-controlled input
 * through `set()`.
 */
function validateName(name: string): void {
  if (name.length === 0) {
    throw new VaultError("INVALID_NAME", "Secret name must be non-empty.");
  }
  if (name.length > 256) {
    throw new VaultError("INVALID_NAME", "Secret name must be 256 characters or fewer.");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f/\\]/.test(name)) {
    throw new VaultError(
      "INVALID_NAME",
      `Secret name contains invalid characters (control chars, slashes, or null bytes): ${JSON.stringify(name)}`,
    );
  }
}
