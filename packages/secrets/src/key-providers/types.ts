/**
 * Key Provider — Type Definitions
 *
 * Abstracts vault encryption key storage behind a provider interface.
 * Implementations retrieve/store the 32-byte AES-256-GCM key from
 * different backends (macOS Keychain, 1Password, passphrase KDF, etc.).
 *
 * All methods return null/false on failure — never throw (consistent
 * with vault-common.ts conventions).
 */

// =============================================================================
// Provider Types
// =============================================================================

/** Supported key provider backends. */
export type KeyProviderType = "keychain" | "1password" | "passphrase";

/** Optional diagnostic exposed after a provider returns null/false. */
export interface KeyProviderError {
  code: string;
  message: string;
}

/**
 * Interface for vault encryption key storage providers.
 *
 * Each provider encapsulates its own storage details (keychain service names,
 * 1Password vault/item paths, etc.). Callers interact only through getKey/storeKey.
 */
export interface KeyProvider {
  /** Provider identifier for display and config. */
  readonly name: KeyProviderType;

  /**
   * Retrieve the vault encryption key.
   *
   * @returns 32-byte key as Buffer, or null if not found / auth fails.
   */
  getKey(): Buffer | null;

  /**
   * Store the vault encryption key.
   *
   * Overwrites any existing key in the provider's storage.
   *
   * @param key - 32-byte encryption key
   * @returns true on success, false on failure.
   */
  storeKey(key: Buffer): boolean;

  /**
   * Optional provider-specific setup that returns the key to use for vault
   * bootstrap encryption. Providers that derive keys rather than store
   * caller-supplied random keys should implement this instead of storing key.
   */
  setupKey?(): Buffer | null;

  /**
   * Delete the stored vault encryption key.
   *
   * @returns true if deleted (or did not exist), false on unexpected failure.
   */
  deleteKey(): boolean;

  /**
   * Optional diagnostic for the most recent null/false result.
   *
   * This preserves the non-throwing provider contract while allowing callers
   * to surface clear auth failures such as wrong passphrase or non-TTY prompt.
   */
  getLastError?(): KeyProviderError | null;
}

// =============================================================================
// Configuration Types
// =============================================================================

/** 1Password-specific configuration. */
export interface OnePasswordConfig {
  /** 1Password vault name (default: "Private"). */
  vault?: string;
  /** 1Password item name (default: "centient-vault-key"). */
  item?: string;
}

/**
 * 1Password configuration for the **credential-value** backend (ADR-004).
 *
 * Deliberately separate from {@link OnePasswordConfig}, which names the item
 * holding the vault *encryption key* (ADR-001). The two are independent layers:
 * an operator may keep the key in `Private` while credentials live in a shared
 * vault, or use 1Password for one and the Keychain for the other. Overloading a
 * single `vault` field would conflate them.
 */
export interface OnePasswordBackendConfig {
  /**
   * 1Password vault holding credential values. **Required — no default.**
   *
   * Unlike the key block (which defaults to `"Private"`), guessing here could
   * write credentials into a personal vault the operator never intended, so an
   * unset value under an explicit `backend: "1password"` fails closed.
   */
  vault?: string;
  /** Tag applied to items, and filtered on when listing. Default `"centient"`. */
  tag?: string;
}

/** Explicit credential-storage backend selection. */
export type SecretsBackendType = "1password";

/** Global secrets configuration from ~/.centient/config.json. */
export interface SecretsConfig {
  /** Explicit provider choice. Omit for auto-detection. */
  provider?: KeyProviderType;
  /** 1Password-specific settings for the vault-encryption KEY (ADR-001). */
  onePassword?: OnePasswordConfig;
  /**
   * Explicit credential-storage backend (ADR-004). Omit for the auto-cascade;
   * 1Password is never auto-selected.
   */
  backend?: SecretsBackendType;
  /** Settings for the 1Password credential-VALUE backend (ADR-004). */
  onePasswordBackend?: OnePasswordBackendConfig;
}

/** Top-level structure of ~/.centient/config.json. */
export interface CentientConfig {
  secrets?: SecretsConfig;
}
