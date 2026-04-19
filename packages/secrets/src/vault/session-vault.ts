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
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

import { encryptObject, decryptObject } from "../crypto/vault-common.js";
import { resolveKeyProvider } from "../key-providers/resolve.js";
import type { KeyProviderType } from "../key-providers/types.js";
import {
  runBeforeHooks,
  runAfterHooks,
  type SecretsEventType,
  type SecretsOperation,
} from "./policy.js";
import { acquireWriteLock } from "./file-lock.js";
import {
  readSidecar,
  writeSidecar,
  checkSidecarPerms,
  VAULT_FILE_MODE,
  VAULT_DIR_MODE,
} from "./sidecar.js";
import {
  VaultError,
  VaultUnlockError,
  VaultDecryptError,
  VaultRollbackError,
  VaultClosedError,
  VaultLockError,
} from "./session-vault-errors.js";

// Re-export errors so the public surface (index.ts) stays stable.
export {
  VaultError,
  VaultUnlockError,
  VaultDecryptError,
  VaultRollbackError,
  VaultClosedError,
  VaultLockError,
};

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

/** Maximum allowed secret-name length. */
const MAX_NAME_LENGTH = 256;

/**
 * AAD prefix — static byte header mixed into the vault ciphertext's
 * Additional Authenticated Data. Binding this prefix into AAD means a
 * ciphertext from some other AES-GCM user with the same key cannot be
 * substituted into the vault. Exported so test fixtures can produce AAD
 * consistent with the real implementation without duplicating the constant.
 */
export const VAULT_AAD_PREFIX = "centient-secrets-vault";

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

/**
 * Coherence strategy governs how the open vault reconciles in-memory state
 * with concurrent external writes to the vault file.
 */
export type CoherenceStrategy = "mtime-check" | "strict" | "best-effort";

/** Options for {@link openVault}. All fields are optional. */
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
   * Opt-in acceptance of a missing sidecar. Default behaviour (`false`) is to
   * **refuse** to open the vault when the sidecar is absent — this enforces
   * the security invariant that rollback protection is always in effect.
   * Pass `true` for legitimate first-use contexts (fresh install, test
   * fixtures, post-migration) to auto-initialize `seenVersion = vaultVersion`
   * with a stderr warning. See docs/session-vault.md §Missing sidecar.
   */
  acceptMissingSidecar?: boolean;
  /**
   * Optional auto-close TTL in milliseconds. Not set by default — daemons run
   * forever; forced re-auth undoes the point of a session vault. Useful for
   * short-lived script consumers that want defense-in-depth.
   */
  ttlMs?: number;
}

/**
 * A long-lived handle to an unlocked vault. Construct with {@link openVault};
 * close with {@link SessionVault.close}. Operations are async so policy
 * `before` hooks can await (e.g. remote attestation).
 */
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
// Path resolution (C2 — symlink-aware)
// =============================================================================

/**
 * Resolve a vault path to its canonical real path so the AAD binds to the
 * actual file identity rather than any one alias. Symlinks (`~/.centient`
 * → `/home/user/.centient`, bind mounts, etc.) would otherwise produce
 * distinct AADs for the same underlying file and fail decrypt.
 *
 * Intentional consequence: moving the vault to a new real path permanently
 * invalidates the ciphertext (the attacker-moves-vault attack is the same
 * as the rename-it attack — we prefer an honest decrypt failure to silent
 * acceptance). See C2 in PR #41 review.
 */
function resolveVaultPath(rawPath: string): string {
  const resolved = pathResolve(rawPath);
  try {
    return realpathSync(resolved);
  } catch (err) {
    // ENOENT is expected when the vault hasn't been created yet; fall back
    // to the lexical path so openVault can produce its own "vault not found"
    // error with a clean message.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return resolved;
    throw err;
  }
}

// =============================================================================
// AAD derivation
// =============================================================================

/**
 * Derive Additional Authenticated Data binding ciphertext to its vault
 * identity. A payload encrypted for vault A cannot be substituted into
 * vault B (different path) without failing auth-tag verification.
 *
 * AAD binds to the **resolved real path** (symlinks followed) so that a vault
 * reachable via multiple aliases (symlinks, bind mounts) still produces a
 * single canonical AAD. Moving the vault to a new real path permanently
 * invalidates the ciphertext — intentional (see {@link resolveVaultPath}).
 */
function deriveAad(absoluteRealVaultPath: string, schema: number): Buffer {
  return createHash("sha256")
    .update(`${VAULT_AAD_PREFIX}:v${schema}:${absoluteRealVaultPath}`)
    .digest();
}

// =============================================================================
// Vault permission check
// =============================================================================

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

/**
 * Open an encrypted session vault.
 *
 * Resolves the configured {@link KeyProvider} to obtain the master key,
 * decrypts the vault file bound to its resolved real path (symlink-aware),
 * checks rollback detection via the sidecar, and returns a long-lived
 * {@link SessionVault} handle that serves reads from memory.
 *
 * @param opts - {@link OpenVaultOptions}. All fields are optional; defaults
 *   use the same paths the `centient secrets` CLI uses.
 * @returns An open {@link SessionVault}. Call `close()` when done.
 * @throws {@link VaultError} `VAULT_NOT_FOUND` when the vault file is absent.
 * @throws {@link VaultUnlockError} when the KeyProvider cannot return a key.
 * @throws {@link VaultDecryptError} when decryption fails (wrong key, AAD
 *   mismatch, corrupted payload).
 * @throws {@link VaultRollbackError} when the sidecar indicates a rollback
 *   and `acceptRollback` is not set.
 *
 * @example
 * ```ts
 * const vault = await openVault({ ttlMs: 60_000 });
 * const apiKey = await vault.get("openai-api-key");
 * vault.close();
 * ```
 */
export async function openVault(opts: OpenVaultOptions = {}): Promise<SessionVault> {
  const vaultPath = resolveVaultPath(opts.path ?? DEFAULT_VAULT_PATH);
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
  //
  // Compatibility layer for CLI-written (AAD-less) vaults:
  //   1. Try to decrypt with AAD (the v1 format written by openVault).
  //   2. If that fails, try to decrypt WITHOUT AAD. If this succeeds, the
  //      vault was written by a pre-openVault CLI and is in the "legacy flat
  //      format" (`{ name: value, ... }` at the top level). The payload will
  //      be upgraded to v1 (with AAD) on the next successful write.
  //   3. If both fail, it's a genuine decrypt error (wrong key / corruption).
  //
  // This is a bounded migration window — after consumers have all migrated,
  // the legacy path can be removed in a subsequent major release. It is NOT
  // a silent downgrade: legacy-opened vaults remain AAD-less until the next
  // write, at which point they're upgraded automatically and become
  // AAD-bound going forward.
  const initialBytes = readFileSync(vaultPath);
  let decoded = decryptObject(initialBytes, key, aad);
  let openedAsLegacy = false;
  if (decoded === null) {
    const legacy = decryptObject(initialBytes, key);
    if (legacy !== null) {
      decoded = legacy;
      openedAsLegacy = true;
    } else {
      key.fill(0);
      throw new VaultDecryptError(
        `Failed to decrypt vault at ${vaultPath} — wrong key, corrupted file, or AAD mismatch (schema version ${VAULT_SCHEMA_VERSION}; also tried legacy no-AAD format).`,
      );
    }
  }

  let payload = validatePayload(decoded);
  if (payload === null) {
    // Legacy flat-format detection: a pre-openVault CLI vault is a flat
    // `{ name: value, ... }` map at the top level. If every value is a string
    // and there's no `schema` field, accept as legacy schema-0.
    if (openedAsLegacy && !("schema" in decoded)) {
      const secrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(decoded)) {
        if (typeof v !== "string") {
          key.fill(0);
          throw new VaultDecryptError(
            `Vault decrypted without AAD but contained a non-string value at key "${k}" — not a legacy CLI vault; possible corruption.`,
          );
        }
        secrets[k] = v;
      }
      payload = { schema: 0, vaultVersion: 0, secrets };
      process.stderr.write(
        `[secrets] Opened legacy (pre-schema, AAD-less) vault at ${vaultPath}; ` +
          `will auto-upgrade to schema ${VAULT_SCHEMA_VERSION} with AAD binding on next write.\n`,
      );
    } else {
      key.fill(0);
      throw new VaultDecryptError(
        "Decrypted payload has invalid shape — possible corruption or format mismatch.",
      );
    }
  }

  // --- Rollback check ---
  const sidecar = readSidecar(sidecarPath);
  if (sidecar === null) {
    // Default is REFUSE when sidecar is missing (security invariant:
    // rollback protection must be in effect at all times). Callers with
    // legitimate first-use contexts (fresh install, post-migration, test
    // fixtures) must explicitly opt in via `acceptMissingSidecar: true`.
    //
    // Exception: legacy vaults (pre-openVault CLI-written, AAD-less) never
    // had a sidecar by construction — refusing them would brick the CLI
    // migration path. Legacy detection implicitly permits sidecar auto-init.
    if (opts.acceptMissingSidecar !== true && !openedAsLegacy) {
      key.fill(0);
      throw new VaultError(
        "VAULT_SIDECAR_MISSING",
        `Sidecar file ${sidecarPath} is missing. Rollback protection requires ` +
          `the sidecar to exist. If this is a legitimate first-use context ` +
          `(fresh install, post-migration), pass { acceptMissingSidecar: true } ` +
          `to openVault(); the sidecar will be initialized automatically. ` +
          `If the sidecar was unexpectedly deleted, investigate before opening.`,
      );
    }
    const reason = openedAsLegacy ? "legacy vault migration" : "acceptMissingSidecar: true";
    process.stderr.write(
      `[secrets] WARNING: sidecar file ${sidecarPath} is missing; ` +
        `auto-initializing seenVersion=${payload.vaultVersion} per ${reason}.\n`,
    );
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
  ttlMs: number | undefined;
}

function buildVault(args: BuildVaultArgs): SessionVault {
  let key: Buffer | null = args.key;
  let secrets = args.currentSecrets;
  let vaultVersion = args.currentVersion;
  // Capture mtime here (L9) — openVault already confirmed the file exists and
  // decrypted it, so a follow-up stat races the narrowest possible window and
  // avoids duplicating the mtime in the BuildVaultArgs contract.
  let mtimeMs = statSync(args.vaultPath).mtimeMs;
  let closed = false;

  let ttlTimer: NodeJS.Timeout | null = null;
  if (args.ttlMs !== undefined) {
    ttlTimer = setTimeout(() => {
      doClose();
    }, args.ttlMs);
    ttlTimer.unref();
  }

  const assertOpen = (): void => {
    if (closed || key === null) throw new VaultClosedError();
  };

  /**
   * Refresh in-memory state from disk if the coherence strategy says to and
   * mtime has advanced. Throws VaultError on a missing vault file (M4) and
   * VaultDecryptError on decrypt failure.
   */
  const maybeReload = (): void => {
    if (args.coherence === "best-effort") return;
    // Drop existsSync — statSync already throws ENOENT. Translating the error
    // gives us one clean code path and one fewer syscall (M4).
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(args.vaultPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new VaultError(
          "VAULT_FILE_MISSING",
          `Vault file ${args.vaultPath} was removed while open.`,
        );
      }
      throw err;
    }
    if (st.mtimeMs === mtimeMs) return;
    if (args.coherence === "strict" && st.mtimeMs > mtimeMs) {
      // `strict` means the caller wants an explicit reload(); block reads.
      throw new VaultError(
        "VAULT_STALE_SNAPSHOT",
        `Vault file modified externally (mtime ${st.mtimeMs} vs session ${mtimeMs}); call reload() to continue.`,
      );
    }
    const bytes = readFileSync(args.vaultPath);
    // Try AAD first (v1 format); fall back to no-AAD (legacy CLI format) —
    // same layered decrypt as openVault so a legacy vault remains readable
    // across mtime-check reloads until the first write upgrades it.
    let decoded = decryptObject(bytes, key!, args.aad);
    if (decoded === null) {
      decoded = decryptObject(bytes, key!);
      if (decoded === null) {
        throw new VaultDecryptError(
          "Failed to decrypt vault after external change — key may have rotated or file may be corrupted.",
        );
      }
    }
    let payload = validatePayload(decoded);
    if (payload === null) {
      // Legacy flat-format (no schema field); reconstruct a schema-0 view.
      if (!("schema" in decoded)) {
        const legacySecrets: Record<string, string> = {};
        let ok = true;
        for (const [k, v] of Object.entries(decoded)) {
          if (typeof v !== "string") { ok = false; break; }
          legacySecrets[k] = v;
        }
        if (!ok) {
          throw new VaultDecryptError(
            "Decrypted payload has invalid shape after external change — possible corruption.",
          );
        }
        payload = { schema: 0, vaultVersion: 0, secrets: legacySecrets };
      } else {
        throw new VaultDecryptError(
          "Decrypted payload has invalid shape after external change — possible corruption.",
        );
      }
    }
    secrets = { ...payload.secrets };
    vaultVersion = payload.vaultVersion;
    mtimeMs = st.mtimeMs;
    const sidecar = readSidecar(args.sidecarPath);
    if (sidecar === null || payload.vaultVersion > sidecar.highestSeenVersion) {
      writeSidecar(args.sidecarPath, { highestSeenVersion: payload.vaultVersion });
    }
  };

  /**
   * Perform a vault mutation. The lock-acquire step yields the event loop
   * (C1); the critical section between acquire and release runs
   * synchronously so we never deadlock against another async task in this
   * process waiting on the same lock.
   */
  const writeOp = async (
    mutator: (current: Record<string, string>) => void,
  ): Promise<void> => {
    assertOpen();
    const release = await acquireWriteLock(args.vaultPath);
    try {
      // Re-check open after awaiting the lock — TTL or a sibling close()
      // could have fired while we were queued (H2).
      assertOpen();
      maybeReload();
      const next = { ...secrets };
      mutator(next);
      const nextVersion = vaultVersion + 1;
      const payload: VaultPayload = {
        schema: VAULT_SCHEMA_VERSION,
        vaultVersion: nextVersion,
        secrets: next,
      };
      const encrypted = encryptObject(
        payload as unknown as Record<string, unknown>,
        key!,
        args.aad,
      );
      if (encrypted === null) {
        throw new VaultError("VAULT_ENCRYPT_FAILED", "Encryption returned null — corrupted state.");
      }
      // Atomic vault write: temp file (mode 0600) + rename. POSIX `rename`
      // preserves mode, and `writeFileSync` honours the `mode` option on the
      // initial create, so we deliberately do NOT chmod the committed file
      // afterwards (M5). If a hostile umask or exotic filesystem produced a
      // too-permissive file, the permission check on the next open will
      // warn.
      mkdirSync(dirname(args.vaultPath), { recursive: true, mode: VAULT_DIR_MODE });
      const tmpVault = `${args.vaultPath}.${randomBytes(8).toString("hex")}.tmp`;
      writeFileSync(tmpVault, encrypted, { mode: VAULT_FILE_MODE });
      renameSync(tmpVault, args.vaultPath);
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

  const doClose = (): void => {
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

  /**
   * Audit-scaffolding wrapper — extracted from per-method boilerplate (M1).
   *
   * Every vault operation shares the same shape: `assertOpen`, run before
   * hooks, time the work, fire an after hook (success/missing/failure). Re-
   * checks `assertOpen` after the before-hook await so a TTL expiry or a
   * sibling `close()` can't drop us into `fn()` with `key === null` (H2).
   *
   * `missingType` is distinct from `successType` because reads can return
   * null/false without being a failure (credential not present, delete of
   * absent key) — audit logs must distinguish those from a successful hit.
   *
   * `extras(value)` lets callers mix additional event fields derived from
   * the operation result (e.g. `keyCount` for list) without forcing every
   * call site to build its own success event.
   */
  const withAudit = async <T>(
    op: SecretsOperation,
    successType: SecretsEventType,
    missingType: SecretsEventType | null,
    failType: SecretsEventType,
    fn: () => Promise<T> | T,
    extras?: (value: T) => Partial<{ keyCount: number }>,
  ): Promise<T> => {
    assertOpen();
    await runBeforeHooks(op);
    // Re-check after the await — TTL or sibling close() could have fired
    // while before-hooks awaited (H2).
    assertOpen();
    const start = Date.now();
    try {
      const value = await fn();
      const isMissing =
        missingType !== null && (value === null || value === false);
      runAfterHooks({
        type: isMissing ? missingType : successType,
        timestamp: new Date(start).toISOString(),
        backend: "session-vault",
        key: op.key,
        prefix: op.prefix,
        ...(extras !== undefined ? extras(value) : {}),
        durationMs: Date.now() - start,
      });
      return value;
    } catch (err) {
      runAfterHooks({
        type: failType,
        timestamp: new Date(start).toISOString(),
        backend: "session-vault",
        key: op.key,
        prefix: op.prefix,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
      throw err;
    }
  };

  return {
    get(name: string): Promise<string | null> {
      return withAudit<string | null>(
        { type: "read", key: name },
        "credential_read",
        "credential_read_missing",
        "credential_read_failed",
        () => {
          maybeReload();
          return name in secrets ? secrets[name]! : null;
        },
      );
    },

    list(prefix?: string): Promise<string[]> {
      return withAudit<string[]>(
        { type: "enumerate", prefix },
        "credential_enumerated",
        null,
        "credential_enumerate_failed",
        () => {
          maybeReload();
          const names = Object.keys(secrets).sort();
          return prefix === undefined
            ? names
            : names.filter((n) => n.startsWith(prefix));
        },
        (value) => ({ keyCount: value.length }),
      );
    },

    async set(name: string, value: string): Promise<void> {
      // `async` keyword ensures a sync throw from validateName surfaces as a
      // promise rejection, matching the declared `Promise<void>` contract.
      validateName(name);
      return withAudit<void>(
        { type: "write", key: name },
        "credential_written",
        null,
        "credential_write_failed",
        () => writeOp((current) => {
          current[name] = value;
        }),
      );
    },

    delete(name: string): Promise<boolean> {
      return withAudit<boolean>(
        { type: "delete", key: name },
        "credential_deleted",
        "credential_delete_failed",
        "credential_delete_failed",
        async () => {
          if (!(name in secrets)) return false;
          await writeOp((current) => {
            delete current[name];
          });
          return true;
        },
      );
    },

    async reload(): Promise<void> {
      assertOpen();
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(args.vaultPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new VaultError(
            "VAULT_FILE_MISSING",
            `Vault file ${args.vaultPath} was removed while open.`,
          );
        }
        throw err;
      }
      const bytes = readFileSync(args.vaultPath);
      // Re-check open across the IO boundary (H2).
      assertOpen();
      // Layered decrypt: v1 (AAD) → legacy (no AAD). Mirrors openVault and
      // maybeReload so legacy vaults remain usable across explicit reload().
      let decoded = decryptObject(bytes, key!, args.aad);
      if (decoded === null) decoded = decryptObject(bytes, key!);
      if (decoded === null) {
        throw new VaultDecryptError(
          "Failed to decrypt vault during reload — key may have rotated or file may be corrupted.",
        );
      }
      let payload = validatePayload(decoded);
      if (payload === null) {
        if (!("schema" in decoded)) {
          const legacySecrets: Record<string, string> = {};
          let ok = true;
          for (const [k, v] of Object.entries(decoded)) {
            if (typeof v !== "string") { ok = false; break; }
            legacySecrets[k] = v;
          }
          if (!ok) {
            throw new VaultDecryptError(
              "Decrypted payload has invalid shape during reload — possible corruption.",
            );
          }
          payload = { schema: 0, vaultVersion: 0, secrets: legacySecrets };
        } else {
          throw new VaultDecryptError(
            "Decrypted payload has invalid shape during reload — possible corruption.",
          );
        }
      }
      secrets = { ...payload.secrets };
      vaultVersion = payload.vaultVersion;
      mtimeMs = st.mtimeMs;
    },

    close: doClose,

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

/**
 * Validate a decoded vault payload. Rejects NaN, Infinity, non-integer, and
 * out-of-range numeric fields — the payload is untrusted input post-decrypt
 * (a corrupted-but-authenticated payload could still carry garbage integers)
 * so we fail closed (H1). Only `schema === VAULT_SCHEMA_VERSION` is accepted;
 * unknown future schemas must be handled by a future migration, not silently
 * let through as v1.
 */
function validatePayload(decoded: Record<string, unknown>): VaultPayload | null {
  const schemaRaw = decoded["schema"];
  const vvRaw = decoded["vaultVersion"];
  const secretsRaw = decoded["secrets"];

  if (
    typeof schemaRaw !== "number" ||
    !Number.isInteger(schemaRaw) ||
    schemaRaw < 0 ||
    schemaRaw > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  // Only v1 is valid in this build. Reject unknowns explicitly rather than
  // coercing them into v1 handling.
  if (schemaRaw !== VAULT_SCHEMA_VERSION) {
    return null;
  }
  if (
    typeof vvRaw !== "number" ||
    !Number.isInteger(vvRaw) ||
    vvRaw < 0 ||
    vvRaw > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  if (
    typeof secretsRaw !== "object" ||
    secretsRaw === null ||
    Array.isArray(secretsRaw)
  ) {
    return null;
  }

  const secretsObj = secretsRaw as Record<string, unknown>;
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(secretsObj)) {
    if (typeof v !== "string") return null;
    secrets[k] = v;
  }
  return {
    schema: schemaRaw,
    vaultVersion: vvRaw,
    secrets,
  };
}

/**
 * Reject names with control characters, path separators, null bytes, or
 * Unicode oddities that can confuse log scrapers, terminals, and path
 * libraries (L4). The CLI-facing library accepts anything historically;
 * the public API is a good place to constrain against callers that might
 * route user-controlled input through `set()`.
 */
function validateName(name: string): void {
  if (name.length === 0) {
    throw new VaultError("INVALID_NAME", "Secret name must be non-empty.");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new VaultError(
      "INVALID_NAME",
      `Secret name must be ${MAX_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (name !== name.trim()) {
    throw new VaultError(
      "INVALID_NAME",
      `Secret name must not have leading or trailing whitespace: ${JSON.stringify(name)}`,
    );
  }
  // Denylist: ASCII control (0x00–0x1f, 0x7f), path separators, plus explicit
  // Unicode directional overrides and line/paragraph separators that can
  // disguise names in logs and terminals.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f/\\\u202E\u2028\u2029]/.test(name)) {
    throw new VaultError(
      "INVALID_NAME",
      `Secret name contains invalid characters (control chars, slashes, null bytes, or Unicode separators): ${JSON.stringify(name)}`,
    );
  }
}
