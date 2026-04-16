/**
 * Auth Vault — Environment Variable Fallback Backend
 *
 * Last-resort vault backend that reads credentials from environment variables.
 * Reads/writes nothing to disk. Suitable for CI/headless environments where no
 * secure credential store (libsecret, GPG, macOS Keychain) is available.
 *
 * Implements the VaultBackend interface:
 *   store(key, value): boolean  — always returns false (env vars are read-only)
 *   retrieve(key): string|null  — returns ENGRAM_API_KEY for 'auth-token', null otherwise
 *   delete(key): boolean        — always returns true (no-op; nothing to delete)
 *   static detect(): boolean    — always returns true (last-resort fallback)
 */

import { AUTH_MESSAGES } from "../cli/messages.js";
import type { VaultBackend } from "./types.js";

// =============================================================================
// EnvVault implementation
// =============================================================================

/**
 * Environment-variable-only vault backend.
 *
 * This is the last-resort fallback when no OS-level secure credential store is
 * available. It surfaces `ENGRAM_API_KEY` as the `auth-token` credential and
 * rejects all write attempts with a warning on stderr.
 */
export class EnvVault implements VaultBackend {
  /**
   * Detection probe — always returns true so that EnvVault is always
   * available as a last-resort fallback.
   */
  static detect(): boolean {
    return true;
  }

  /**
   * Attempt to store a credential.
   *
   * Environment variables cannot be written from within a process, so this
   * always fails. A warning is emitted to stderr explaining how to configure
   * persistent storage.
   *
   * @returns false — storage is never performed
   */
  store(_key: string, _value: string): boolean {
    process.stderr.write(AUTH_MESSAGES.warning.envVaultNoStorage + "\n");
    return false;
  }

  /**
   * Retrieve a credential from the environment.
   *
   * - `'auth-token'`    -> `process.env["ENGRAM_API_KEY"] ?? null`
   * - `'refresh-token'` -> `null` (refresh tokens are not available in env mode)
   * - any other key     -> `null`
   *
   * @param key - Logical credential key
   * @returns The credential value, or null if unavailable
   */
  retrieve(key: string): string | null {
    if (key === "auth-token") {
      return process.env["ENGRAM_API_KEY"] ?? null;
    }
    return null;
  }

  /**
   * Delete a credential.
   *
   * No-op: there is nothing stored in this backend to delete.
   *
   * @returns true — always succeeds (nothing to remove)
   */
  delete(_key: string): boolean {
    return true;
  }

  /**
   * Enumerate logical keys served by this backend.
   *
   * EnvVault only surfaces a single hardcoded mapping (`auth-token` ->
   * `ENGRAM_API_KEY`), so enumeration returns `["auth-token"]` when the
   * underlying env var is set, otherwise `[]`.
   *
   * There is no user-defined naming convention over `process.env`, so
   * arbitrary prefixes that don't match `auth-token` always produce `[]`.
   */
  async listKeys(prefix?: string): Promise<string[]> {
    if (process.env["ENGRAM_API_KEY"] === undefined) return [];
    if (prefix !== undefined && !"auth-token".startsWith(prefix)) return [];
    return ["auth-token"];
  }
}
