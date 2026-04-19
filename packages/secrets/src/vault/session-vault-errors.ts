/**
 * SessionVault error classes — extracted so helper modules (file-lock,
 * sidecar) can throw them without creating an import cycle back into
 * session-vault.ts.
 *
 * Each subclass restores the prototype chain with `Object.setPrototypeOf`
 * so `instanceof VaultError` etc. remains robust when the class is consumed
 * across an ES transpile boundary (L2 — matches the EngramError pattern in
 * `packages/sdk/src/errors.ts`).
 */

/** Base class for SessionVault errors. */
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

/** Thrown when the write-path file lock can't be acquired within the timeout. */
export class VaultLockError extends VaultError {
  constructor(message: string) {
    super("VAULT_LOCK_FAILED", message);
    this.name = "VaultLockError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
