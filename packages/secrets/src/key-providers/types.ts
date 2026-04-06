/**
 * Key Provider — Type Definitions
 *
 * Abstracts vault encryption key storage behind a provider interface.
 * Implementations retrieve/store the 32-byte AES-256-GCM key from
 * different backends (macOS Keychain, 1Password, etc.).
 *
 * All methods return null/false on failure — never throw (consistent
 * with vault-common.ts conventions).
 */

// =============================================================================
// Provider Types
// =============================================================================

/** Supported key provider backends. */
export type KeyProviderType = "keychain" | "1password";

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
   * Delete the stored vault encryption key.
   *
   * @returns true if deleted (or did not exist), false on unexpected failure.
   */
  deleteKey(): boolean;
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
