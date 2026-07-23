/**
 * Vault error taxonomy — the package's one `VaultError` hierarchy, extracted
 * so helper modules (file-lock, sidecar, vault-utils) can throw these without
 * creating an import cycle back into session-vault.ts.
 *
 * Most members are SessionVault-specific; `InvalidCredentialKeyError` is
 * raised by the credential cascade (`vault.ts`) and its backends. They share a
 * base class deliberately — a caller wrapping vault work in
 * `catch (e) { if (e instanceof VaultError) … }` should not have to know which
 * storage path produced the failure.
 *
 * This module has no imports on purpose; keep it that way so any vault module
 * can depend on it.
 *
 * Each subclass restores the prototype chain with `Object.setPrototypeOf`
 * so `instanceof VaultError` etc. remains robust when the class is consumed
 * across an ES transpile boundary (L2 — matches the EngramError pattern in
 * `packages/sdk/src/errors.ts`).
 */

/** Base class for vault errors. */
export class VaultError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "VaultError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the master key can't be retrieved from the configured provider. */
export class VaultUnlockError extends VaultError {
  constructor(message: string) {
    super("VAULT_UNLOCK_FAILED", message);
    this.name = "VaultUnlockError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when decryption fails — wrong key, corrupted file, or AAD mismatch. */
export class VaultDecryptError extends VaultError {
  constructor(message: string) {
    super("VAULT_DECRYPT_FAILED", message);
    this.name = "VaultDecryptError";
    Object.setPrototypeOf(this, new.target.prototype);
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
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when operations are attempted on a closed vault. */
export class VaultClosedError extends VaultError {
  constructor() {
    super("VAULT_CLOSED", "Vault has been closed; reopen with openVault() to continue.");
    this.name = "VaultClosedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a rekey's external commit failed AND restoring the prior
 * ciphertext then failed too.
 *
 * This is the one indeterminate state the rekey path can reach: the vault file
 * may still hold the ciphertext written under the NEW key, so neither key can
 * be assumed to be the right one — and, critically, **no key material for
 * either may be discarded**. Callers that clean up on failure (e.g. deleting
 * freshly written passphrase metadata) must special-case this error; deleting
 * the new key's material here can leave the vault permanently unopenable.
 */
export class VaultRestoreError extends VaultError {
  constructor(
    /** Absolute path of the vault whose state is indeterminate. */
    public readonly path: string,
    /** Version the new ciphertext carries, if it is the one on disk. */
    public readonly attemptedVersion: number,
    /** The `commit` failure that triggered the rollback attempt. */
    public readonly commitCause: unknown,
    /** The failure of the rollback write itself. */
    public readonly restoreCause: unknown,
  ) {
    super(
      "VAULT_RESTORE_FAILED",
      `Rekey of ${path} could not be completed OR undone. The caller's commit ` +
        `failed (${describeCause(commitCause)}) and restoring the prior ` +
        `ciphertext then failed (${describeCause(restoreCause)}). The vault ` +
        `file may still hold the ciphertext written under the NEW key at ` +
        `version ${attemptedVersion}. Do NOT discard either key: try the new ` +
        `key first, then the old one. If neither opens it, restore a backup of ` +
        `the vault file and its sidecar.`,
    );
    this.name = "VaultRestoreError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Thrown when a credential key (or a `listCredentials` prefix) does not match
 * the key grammar every vault backend is required to accept.
 *
 * **Why this throws rather than returning a falsy value (#168).** The backends
 * disagree about non-conforming keys: macOS Keychain and the env fallback
 * store anything, while the 1Password, GPG, libsecret and Windows backends
 * cannot address such a key at all. A key that violates the grammar therefore
 * writes successfully on a Mac and is unreadable everywhere else — a silent
 * write/read asymmetry (P2). Returning `false`/`null` would express that as
 * "the write failed" or, worse on the read path, as "no such credential",
 * which is indistinguishable from a genuine miss. The key is malformed, not
 * missing, and only a distinguishable failure says so.
 */
export class InvalidCredentialKeyError extends VaultError {
  constructor(
    /** The offending key or prefix. A key name, never credential material. */
    public readonly key: string,
    /** The operation that was refused — "read", "write", "delete", "enumerate". */
    public readonly operation: string,
    /** Whether `key` was supplied as a full key or as a `listCredentials` prefix. */
    public readonly kind: "key" | "prefix" = "key",
  ) {
    super(
      "VAULT_INVALID_CREDENTIAL_KEY",
      `Vault ${operation} refused: credential ${kind} ${JSON.stringify(key)} ` +
        `does not match the required key grammar. Keys must be 2-64 characters ` +
        `of lowercase alphanumerics with '-' or '.' as separators, beginning ` +
        `and ending with an alphanumeric` +
        (kind === "prefix" ? " (a prefix may end with a separator)" : "") +
        `. Non-conforming keys store on some backends and are unaddressable on ` +
        `others, so the value would be written and never read back.`,
    );
    this.name = "InvalidCredentialKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the write-path file lock can't be acquired within the timeout. */
export class VaultLockError extends VaultError {
  constructor(message: string) {
    super("VAULT_LOCK_FAILED", message);
    this.name = "VaultLockError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
