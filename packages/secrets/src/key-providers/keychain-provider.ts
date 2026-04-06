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

const KEYCHAIN_SERVICE = "centient-vault";
const KEYCHAIN_ACCOUNT = "vault-key";

// =============================================================================
// Implementation
// =============================================================================

export class KeychainProvider implements KeyProvider {
  readonly name: KeyProviderType = "keychain";

  /** Returns true if running on macOS. */
  static detect(): boolean {
    return process.platform === "darwin";
  }

  getKey(): Buffer | null {
    return getKeyFromKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  }

  storeKey(key: Buffer): boolean {
    return storeKeyInKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key);
  }

  deleteKey(): boolean {
    return deleteFromKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  }
}
