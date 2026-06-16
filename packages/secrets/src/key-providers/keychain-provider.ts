/**
 * Key Provider — macOS Keychain
 *
 * Wraps the existing getKeyFromKeychain / storeKeyInKeychain functions
 * from vault-common.ts as a KeyProvider implementation.
 *
 * Only available on macOS (darwin). Uses the `security` CLI to interact
 * with the system Keychain, which prompts for Touch ID or system password.
 */

import {
  getKeyFromKeychain,
  storeKeyInKeychain,
  deleteFromKeychain,
} from "../crypto/vault-common.js";
import type { KeyProvider, KeyProviderType } from "./types.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default Keychain item coordinates. These are the historical values every
 * consumer shared before per-consumer keys existed — keeping them as the
 * defaults guarantees existing vaults keep opening with no options passed.
 */
export const DEFAULT_KEYCHAIN_SERVICE = "centient-vault";
export const DEFAULT_KEYCHAIN_ACCOUNT = "vault-key";

// =============================================================================
// Options
// =============================================================================

/**
 * Per-consumer Keychain item coordinates.
 *
 * A consumer that wants its own master key (rather than sharing the global
 * `centient-vault`/`vault-key` item with every other consumer on the machine)
 * names its own Keychain item here — e.g. `{ service: "burnrate-vault" }`.
 * Omitted fields fall back to the historical defaults so behaviour is
 * byte-identical to before when no options are supplied.
 */
export interface KeychainProviderOptions {
  /** Keychain service name. Defaults to {@link DEFAULT_KEYCHAIN_SERVICE}. */
  service?: string;
  /** Keychain account name. Defaults to {@link DEFAULT_KEYCHAIN_ACCOUNT}. */
  account?: string;
}

// =============================================================================
// Implementation
// =============================================================================

export class KeychainProvider implements KeyProvider {
  readonly name: KeyProviderType = "keychain";

  private readonly service: string;
  private readonly account: string;

  /**
   * @param options - Optional per-consumer Keychain item coordinates. With no
   *   options the provider targets the historical `centient-vault`/`vault-key`
   *   item, so existing vaults keep opening unchanged.
   */
  constructor(options: KeychainProviderOptions = {}) {
    this.service = options.service ?? DEFAULT_KEYCHAIN_SERVICE;
    this.account = options.account ?? DEFAULT_KEYCHAIN_ACCOUNT;
  }

  /** Returns true if running on macOS. */
  static detect(): boolean {
    return process.platform === "darwin";
  }

  getKey(): Buffer | null {
    return getKeyFromKeychain(this.service, this.account);
  }

  storeKey(key: Buffer): boolean {
    return storeKeyInKeychain(this.service, this.account, key);
  }

  deleteKey(): boolean {
    return deleteFromKeychain(this.service, this.account);
  }
}
