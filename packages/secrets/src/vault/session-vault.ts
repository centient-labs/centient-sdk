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
import type { ResolveKeyProviderOptions } from "../key-providers/resolve.js";
import type { KeychainProviderOptions } from "../key-providers/keychain-provider.js";
import type { KeyProvider, KeyProviderType } from "../key-providers/types.js";
import {
  runBeforeHooks,
  runAfterHooks,
  rejectedEventType,
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
  VaultRestoreError,
  InvalidCredentialKeyError,
} from "./session-vault-errors.js";

// Re-export errors so the public surface (index.ts) stays stable.
export {
  VaultError,
  VaultUnlockError,
  VaultDecryptError,
  VaultRollbackError,
  VaultClosedError,
  VaultLockError,
  VaultRestoreError,
  // Raised by the credential cascade, not by SessionVault — re-exported here
  // because this module is index.ts's single door onto the VaultError family.
  InvalidCredentialKeyError,
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
  /**
   * Explicitly inject the {@link KeyProvider} that unlocks the vault. When
   * provided, openVault() uses it directly and skips internal resolution
   * (config file + auto-detection) entirely.
   *
   * Two use cases:
   *   1. Headless testability — pass a throwaway in-memory/stub provider so
   *      openVault() can be exercised without touching the real Keychain.
   *   2. Full control — a consumer that constructs its own provider (e.g. a
   *      `KeychainProvider({ service: "burnrate-vault" })`, a remote KMS
   *      adapter) injects it wholesale instead of going through config.
   *
   * For the common "I just want my own Keychain item" case, prefer the
   * lighter-weight {@link OpenVaultOptions.keychain} field, which names the
   * Keychain item without requiring a whole provider.
   */
  keyProvider?: KeyProvider;
  /**
   * Per-consumer Keychain item coordinates, threaded into internal provider
   * resolution. Lets a consumer name its own Keychain item (e.g.
   * `{ service: "burnrate-vault" }`) so it gets its own master key instead of
   * sharing the global `centient-vault`/`vault-key` item with every other
   * consumer on the machine — without injecting a whole {@link KeyProvider}.
   *
   * Ignored when {@link OpenVaultOptions.keyProvider} is supplied (the injected
   * provider owns its own storage coordinates). Omitted fields fall back to the
   * historical defaults, so the no-options path is unchanged.
   */
  keychain?: KeychainProviderOptions;
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

  // --- Unlock via injected or configured KeyProvider ---
  //
  // An explicitly injected provider (opts.keyProvider) wins and bypasses
  // internal resolution entirely — this is the headless-testability and
  // full-control path. Otherwise resolve from config + auto-detection,
  // threading per-consumer Keychain coordinates (opts.keychain) through so a
  // consumer can name its own Keychain item without injecting a whole provider.
  let provider: KeyProvider;
  if (opts.keyProvider !== undefined) {
    provider = opts.keyProvider;
  } else {
    const resolveOpts: ResolveKeyProviderOptions = { vaultPath };
    if (opts.keychain !== undefined) resolveOpts.keychain = opts.keychain;
    const providerResult = resolveKeyProvider(resolveOpts);
    if (!providerResult.ok) {
      throw new VaultUnlockError(providerResult.error.message);
    }
    provider = providerResult.provider;
  }
  const key = provider.getKey();
  if (!key) {
    const providerError = provider.getLastError?.();
    throw new VaultUnlockError(
      providerError?.message ??
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
  let decodeResult: DecodedVault;
  try {
    decodeResult = decodeVaultBytes(initialBytes, key, aad, vaultPath);
  } catch (err) {
    key.fill(0);
    throw err;
  }
  const payload = decodeResult.payload;
  const openedAsLegacy = decodeResult.openedAsLegacy;
  if (decodeResult.payload.schema === 0) {
    process.stderr.write(
      `[secrets] Opened legacy (pre-schema, AAD-less) vault at ${vaultPath}; ` +
        `will auto-upgrade to schema ${VAULT_SCHEMA_VERSION} with AAD binding on next write.\n`,
    );
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
// rekeyVault — re-encrypt an existing vault under a new master key
// =============================================================================

/** Options for {@link rekeyVault}. */
export interface RekeyVaultOptions {
  /** Vault file path. Defaults to the same path the CLI uses. */
  path?: string;
  /** Sidecar path. Defaults to vault directory + `vault.seen-version`. */
  sidecarPath?: string;
  /** The key the vault is currently encrypted under. */
  currentKey: Buffer;
  /** The key the vault should be re-encrypted under. */
  nextKey: Buffer;
  /**
   * Opt-in acceptance of a detected rollback (sidecar version > vault
   * version), mirroring {@link OpenVaultOptions.acceptRollback}. Unlike
   * `openVault`, the sidecar is never lowered to match — the rekeyed vault
   * lands above the recorded high-water mark either way, so accepting a
   * rollback here does not also discard the mark.
   */
  acceptRollback?: boolean;
  /**
   * Opt-in acceptance of a missing sidecar, mirroring
   * {@link OpenVaultOptions.acceptMissingSidecar}. Legacy (pre-`openVault`,
   * AAD-less) vaults never had a sidecar by construction and are exempt.
   */
  acceptMissingSidecar?: boolean;
  /**
   * Invoked once the re-encrypted vault has landed on disk, while the write
   * lock is still held and before the sidecar high-water mark is published.
   *
   * This is the seam that makes an *external* commitment part of the same
   * all-or-nothing step. `migrate --to passphrase` uses it to write
   * `secrets.provider` — a config that names a provider which cannot open the
   * vault (or a vault no configured provider can open) is exactly the
   * half-migrated state this exists to prevent. Throwing restores the prior
   * ciphertext byte-for-byte and rethrows; the sidecar is never advanced on
   * that path, so the restored vault opens cleanly.
   */
  commit?: () => void | Promise<void>;
}

/** Outcome of a successful {@link rekeyVault}. */
export interface RekeyVaultResult {
  /** Number of secrets carried across to the new ciphertext. */
  secretCount: number;
  /** The vault version after the rekey. */
  vaultVersion: number;
  /** True when the source vault was in the pre-`openVault` AAD-less shape. */
  upgradedFromLegacy: boolean;
  /**
   * False when the rekey committed but the sidecar version bump could not be
   * written (warned on stderr). The rekey still succeeded — see the note on
   * the sidecar write in {@link rekeyVault} — but rollback protection is
   * degraded until the next successful vault write catches the sidecar up.
   */
  sidecarPublished: boolean;
}

/**
 * Re-encrypt a vault in place under a different master key.
 *
 * Needed whenever the new key cannot be *chosen* — a `PassphraseProvider`
 * derives its key from what the operator types and cannot store a
 * caller-supplied one, so moving a vault to it means rewriting the ciphertext
 * rather than copying the key to a new home. Provider-to-provider moves that
 * only relocate the same key do not need this.
 *
 * The AAD binds the vault's resolved real path and schema, not the key, so the
 * rekeyed ciphertext stays bound to the same file identity. Legacy AAD-less
 * vaults are upgraded to schema 1 in the same step. The new version is one
 * above both the payload's version and the sidecar's high-water mark, so a
 * rekeyed vault can never land below a version already seen.
 *
 * Any process holding this vault open under the old key will fail its next
 * decrypt with {@link VaultDecryptError} — an honest failure, by design: the
 * old key genuinely no longer opens this vault.
 *
 * **Post-commit guarantee.** With one named exception, a throw means `commit`
 * did not succeed and the prior ciphertext is back in place — nothing after a
 * successful `commit` can throw, because the only step that follows it (the
 * sidecar bump) is reported via {@link RekeyVaultResult.sidecarPublished}
 * rather than thrown. Callers may therefore treat a throw as "nothing was
 * committed" and clean up accordingly; that is what makes it safe for the CLI
 * to delete freshly written passphrase metadata on failure.
 *
 * **The exception: {@link VaultRestoreError}.** If `commit` throws *and* the
 * rollback write then fails, the file on disk may still be the new ciphertext.
 * That state is neither committed nor undone, so it gets its own error type —
 * callers MUST special-case it and must NOT discard key material for either
 * key. Every other throw keeps the plain guarantee.
 *
 * @param opts - {@link RekeyVaultOptions}. `currentKey`/`nextKey` are required;
 *   both remain owned by the caller and are never zeroed here.
 * @returns {@link RekeyVaultResult}.
 * @throws {@link VaultError} `VAULT_NOT_FOUND` when the vault file is absent.
 * @throws {@link VaultDecryptError} when `currentKey` does not open the vault.
 * @throws {@link VaultError} `VAULT_SIDECAR_MISSING` when the sidecar is absent
 *   and neither `acceptMissingSidecar` nor the legacy exemption applies.
 * @throws {@link VaultRollbackError} when the vault version trails the sidecar
 *   and `acceptRollback` is not set.
 * @throws {@link VaultError} `VAULT_ENCRYPT_FAILED` when re-encryption fails.
 * @throws Whatever `commit` throws, after restoring the prior ciphertext.
 */
export async function rekeyVault(
  opts: RekeyVaultOptions,
): Promise<RekeyVaultResult> {
  const vaultPath = resolveVaultPath(opts.path ?? DEFAULT_VAULT_PATH);
  const sidecarPath = pathResolve(
    opts.sidecarPath ?? join(dirname(vaultPath), "vault.seen-version"),
  );

  if (!existsSync(vaultPath)) {
    throw new VaultError(
      "VAULT_NOT_FOUND",
      `Vault file not found at ${vaultPath}. Initialize with \`centient secrets init\`.`,
    );
  }

  checkVaultPerms(vaultPath);
  checkSidecarPerms(sidecarPath);

  const aad = deriveAad(vaultPath, VAULT_SCHEMA_VERSION);

  const release = await acquireWriteLock(vaultPath);
  try {
    const originalBytes = readFileSync(vaultPath);
    const { payload, openedAsLegacy } = decodeVaultBytes(
      originalBytes,
      opts.currentKey,
      aad,
      vaultPath,
    );

    // Rollback protection, same invariant openVault enforces. A rekey that
    // accepted a rolled-back vault would be strictly worse than an open: it
    // would re-publish the stale secrets at a fresh version and launder the
    // rollback past every later check.
    const sidecar = readSidecar(sidecarPath);
    if (sidecar === null) {
      if (opts.acceptMissingSidecar !== true && !openedAsLegacy) {
        throw new VaultError(
          "VAULT_SIDECAR_MISSING",
          `Sidecar file ${sidecarPath} is missing. Rollback protection requires ` +
            `the sidecar to exist. If this is a legitimate first-use context, ` +
            `pass { acceptMissingSidecar: true } to rekeyVault(). If the sidecar ` +
            `was unexpectedly deleted, investigate before re-encrypting.`,
        );
      }
      process.stderr.write(
        `[secrets] WARNING: sidecar file ${sidecarPath} is missing; ` +
          `re-encrypting anyway per ` +
          `${openedAsLegacy ? "legacy vault migration" : "acceptMissingSidecar: true"}.\n`,
      );
    } else if (payload.vaultVersion < sidecar.highestSeenVersion) {
      if (opts.acceptRollback !== true) {
        throw new VaultRollbackError(
          sidecar.highestSeenVersion,
          payload.vaultVersion,
        );
      }
      process.stderr.write(
        `[secrets] WARNING: re-encrypting a vault at version ` +
          `${payload.vaultVersion} below the highest seen version ` +
          `${sidecar.highestSeenVersion} per acceptRollback: true.\n`,
      );
    }

    // Stay above the sidecar high-water mark as well as the payload's own
    // version — an accepted rollback must still not land below a version the
    // sidecar has already recorded.
    const nextVersion =
      Math.max(payload.vaultVersion, sidecar?.highestSeenVersion ?? 0) + 1;

    const nextPayload: VaultPayload = {
      schema: VAULT_SCHEMA_VERSION,
      vaultVersion: nextVersion,
      secrets: payload.secrets,
    };
    const encrypted = encryptObject(
      nextPayload as unknown as Record<string, unknown>,
      opts.nextKey,
      aad,
    );
    if (encrypted === null) {
      throw new VaultError(
        "VAULT_ENCRYPT_FAILED",
        "Re-encryption returned null — corrupted state; vault left unchanged.",
      );
    }

    // Atomic swap, same temp-then-rename discipline as writeOp.
    mkdirSync(dirname(vaultPath), { recursive: true, mode: VAULT_DIR_MODE });
    const writeAtomically = (bytes: Buffer): void => {
      const tmp = `${vaultPath}.${randomBytes(8).toString("hex")}.tmp`;
      writeFileSync(tmp, bytes, { mode: VAULT_FILE_MODE });
      renameSync(tmp, vaultPath);
    };
    writeAtomically(encrypted);

    if (opts.commit !== undefined) {
      try {
        await opts.commit();
      } catch (err) {
        // Put the original ciphertext back. The sidecar has not moved, so the
        // restored (lower) version is still at or above its high-water mark.
        try {
          writeAtomically(originalBytes);
        } catch (restoreErr) {
          // Both halves failed: the commit did not land AND the prior
          // ciphertext is not reliably back. Whatever is on disk may be the
          // NEW ciphertext, so this is NOT the ordinary "nothing committed"
          // failure and must not be reported as one — a caller that cleans up
          // on failure would discard key material the vault might now depend
          // on. Distinct error type, distinct handling.
          throw new VaultRestoreError(vaultPath, nextVersion, err, restoreErr);
        }
        throw err;
      }
    }

    // Publish the version bump only once the whole step has committed.
    //
    // Past this line the rekey IS committed — the ciphertext landed and the
    // caller's external commitment succeeded — so a sidecar failure here must
    // NOT throw. Unwinding would report a committed rekey as a failed one, and
    // a caller that cleans up on failure would then destroy key material the
    // vault now depends on (for `migrate --to passphrase`, the metadata holding
    // the salt: the vault would be permanently unopenable). A lagging sidecar
    // is the benign direction — the next open sees `vaultVersion >
    // highestSeenVersion` and catches it up — which is the same asymmetry
    // `writeOp` relies on for a crash between the two writes.
    let sidecarPublished = true;
    try {
      writeSidecar(sidecarPath, {
        highestSeenVersion: Math.max(sidecar?.highestSeenVersion ?? 0, nextVersion),
      });
    } catch (err) {
      sidecarPublished = false;
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[secrets] WARNING: vault re-encrypted successfully at version ` +
          `${nextVersion}, but the sidecar ${sidecarPath} could not be ` +
          `updated: ${message}. The rekey is committed and the vault is ` +
          `usable; the sidecar catches up on the next successful write. ` +
          `Rollback protection is degraded until it does.\n`,
      );
    }

    return {
      secretCount: Object.keys(payload.secrets).length,
      vaultVersion: nextVersion,
      upgradedFromLegacy: openedAsLegacy,
      sidecarPublished,
    };
  } finally {
    release();
  }
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
    const beforeStart = Date.now();
    await runBeforeHooks(op, (error) => ({
      type: rejectedEventType(op),
      timestamp: new Date(beforeStart).toISOString(),
      backend: "session-vault",
      key: op.key,
      prefix: op.prefix,
      error,
      durationMs: Date.now() - beforeStart,
    }));
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

/** Outcome of {@link decodeVaultBytes}. */
interface DecodedVault {
  /** The decoded payload; `schema: 0` marks the legacy flat shape. */
  payload: VaultPayload;
  /** True when the ciphertext only decrypted with no AAD (pre-openVault CLI). */
  openedAsLegacy: boolean;
}

/**
 * Decrypt and validate raw vault bytes.
 *
 * Layered decrypt: AAD-bound v1 first, then the pre-`openVault` AAD-less CLI
 * shape. A v1 decrypt that yields an unrecognized payload is a hard failure;
 * only an AAD-less decrypt may fall through to the legacy flat
 * `{ name: value }` reconstruction, which is surfaced as `schema: 0`.
 *
 * Shared by {@link openVault} and {@link rekeyVault} so the two entry points
 * that must agree on "what is on disk" cannot drift. The in-session reload
 * paths keep their own copies deliberately — their failure messages name the
 * reload context, and their legacy handling is intentionally looser (a vault
 * already opened as v1 can still be reloaded from a legacy write).
 *
 * @throws {@link VaultDecryptError} when neither decrypt succeeds, or when the
 *   decrypted payload has no recognizable shape.
 */
function decodeVaultBytes(
  bytes: Buffer,
  key: Buffer,
  aad: Buffer,
  vaultPath: string,
): DecodedVault {
  let decoded = decryptObject(bytes, key, aad);
  let openedAsLegacy = false;
  if (decoded === null) {
    const legacy = decryptObject(bytes, key);
    if (legacy === null) {
      throw new VaultDecryptError(
        `Failed to decrypt vault at ${vaultPath} — wrong key, corrupted file, or AAD mismatch (schema version ${VAULT_SCHEMA_VERSION}; also tried legacy no-AAD format).`,
      );
    }
    decoded = legacy;
    openedAsLegacy = true;
  }

  const payload = validatePayload(decoded);
  if (payload !== null) return { payload, openedAsLegacy };

  // Legacy flat-shape detection: a pre-openVault CLI vault is a flat
  // `{ name: value, ... }` map at the top level. If every value is a string
  // and there's no `schema` field, accept as legacy schema-0.
  if (!openedAsLegacy || "schema" in decoded) {
    throw new VaultDecryptError(
      "Decrypted payload has invalid shape — possible corruption or format mismatch.",
    );
  }
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(decoded)) {
    if (typeof v !== "string") {
      throw new VaultDecryptError(
        `Vault decrypted without AAD but contained a non-string value at key "${k}" — not a legacy CLI vault; possible corruption.`,
      );
    }
    secrets[k] = v;
  }
  return { payload: { schema: 0, vaultVersion: 0, secrets }, openedAsLegacy };
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
