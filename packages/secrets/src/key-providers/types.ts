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

/** Global secrets configuration from ~/.centient/config.json. */
export interface SecretsConfig {
  /** Explicit provider choice. Omit for auto-detection. */
  provider?: KeyProviderType;
  /** 1Password-specific settings. */
  onePassword?: OnePasswordConfig;
}

/** Top-level structure of ~/.centient/config.json. */
export interface CentientConfig {
  secrets?: SecretsConfig;
}
