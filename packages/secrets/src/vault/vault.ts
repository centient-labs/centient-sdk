/**
 * Auth Vault — Credential Storage (Cascade: Keychain -> Windows -> Libsecret -> GPG -> Env)
 *
 * Provides secure storage for auth tokens using a cascade of backends:
 *   1. KeychainVault  — macOS Keychain via `security` CLI (macOS only)
 *   2. WindowsVault   — Windows Credential Manager via powershell.exe (WSL)
 *   3. LibsecretVault — GNOME libsecret via `secret-tool` (Linux)
 *   4. GpgVault       — GPG-encrypted files (Linux / WSL)
 *   5. EnvVault       — Environment variable fallback (always available)
 *
 * The active backend is selected once at module load by calling each backend's
 * static `detect()` method in order and choosing the first one that returns true.
 *
 * Session TTL: 4 hours from the last successful read/write.
 *
 * Error handling: all functions return null/false on failure — never throw.
 */

import {
  storeStringInKeychain,
  getStringFromKeychain,
  deleteFromKeychain,
  listAccountsInKeychain,
} from "../crypto/vault-common.js";
import { WindowsVault } from "./vault-windows.js";
import { LibsecretVault } from "./vault-libsecret.js";
import { GpgVault } from "./vault-gpg.js";
import { EnvVault } from "./vault-env.js";
import type { VaultBackend, VaultType } from "./types.js";
import { runBeforeHooks, runAfterHooks } from "./policy.js";

// =============================================================================
// Constants
// =============================================================================

const AUTH_KEYCHAIN_SERVICE = "centient-auth";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// =============================================================================
// KeychainVault wrapper
// =============================================================================

/**
 * Wraps the existing macOS Keychain helper functions as a VaultBackend.
 * Only available on macOS (darwin).
 */
class KeychainVault implements VaultBackend {
  static detect(): boolean {
    return process.platform === "darwin";
  }

  store(key: string, value: string): boolean {
    return storeStringInKeychain(AUTH_KEYCHAIN_SERVICE, key, value);
  }

  retrieve(key: string): string | null {
    return getStringFromKeychain(AUTH_KEYCHAIN_SERVICE, key);
  }

  delete(key: string): boolean {
    return deleteFromKeychain(AUTH_KEYCHAIN_SERVICE, key);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    return listAccountsInKeychain(AUTH_KEYCHAIN_SERVICE, prefix);
  }
}

// =============================================================================
// Cascade initialization
// =============================================================================

/**
 * Selects the first available vault backend in priority order:
 *   Keychain -> Windows -> Libsecret -> GPG -> Env
 */
function initVaultBackend(): { backend: VaultBackend; type: VaultType } {
  if (KeychainVault.detect()) return { backend: new KeychainVault(), type: "keychain" };
  if (WindowsVault.detect()) return { backend: new WindowsVault(), type: "windows" };
  if (LibsecretVault.detect()) return { backend: new LibsecretVault(), type: "libsecret" };
  if (GpgVault.detect()) return { backend: new GpgVault(), type: "gpg" };
  return { backend: new EnvVault(), type: "env" };
}

const { backend: activeBackend, type: activeVaultType } = initVaultBackend();

// =============================================================================
// Session State
// =============================================================================

/** Last successful vault access timestamp (epoch ms). */
let lastAccessAt: number | null = null;

/**
 * Returns true if the in-process session is still within the TTL window.
 * This does NOT validate the token itself — use validateToken() for that.
 */
export function isSessionValid(): boolean {
  if (lastAccessAt === null) return false;
  return Date.now() - lastAccessAt < SESSION_TTL_MS;
}

/** Update session timestamp on successful access. */
function touchSession(): void {
  lastAccessAt = Date.now();
}

// =============================================================================
// Public API
//
// Known limitation (0.5.0): when a `before` policy hook rejects an
// operation by throwing, the rejection propagates to the caller but no
// `after` event is emitted. This means policy-rejected operations are
// invisible to the audit trail. The full onion model — where `after`
// hooks on already-entered policies still fire on abort — ships in 1.0
// as part of `createSecretsClient`. See ADR-002 §1.0.0.
// =============================================================================

/**
 * Returns the type identifier for the active vault backend.
 *
 * Useful for diagnostics and health checks to know which backend was selected
 * at startup (e.g. "keychain", "libsecret", "gpg", "env").
 */
export function getActiveVaultType(): VaultType {
  return activeVaultType;
}

/**
 * Store a credential in the active vault backend.
 *
 * @param key     - Logical key name (e.g. 'auth-token', 'refresh-token')
 * @param value   - The credential value to store
 * @returns true on success, false if the backend write fails
 */
export async function storeCredential(
  key: string,
  value: string,
): Promise<boolean> {
  const start = performance.now();
  await runBeforeHooks({ type: "write", key });
  const success = activeBackend.store(key, value);
  if (success) touchSession();
  runAfterHooks({
    type: success ? "credential_written" : "credential_write_failed",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    durationMs: performance.now() - start,
  });
  return success;
}

/**
 * Retrieve a credential from the active vault backend.
 *
 * @param key - Logical key name (e.g. 'auth-token')
 * @returns The stored value, or null if not found / backend unavailable
 */
export async function getCredential(key: string): Promise<string | null> {
  const start = performance.now();
  await runBeforeHooks({ type: "read", key });
  let value: string | null;
  try {
    value = activeBackend.retrieve(key);
  } catch (err) {
    runAfterHooks({
      type: "credential_read_failed",
      timestamp: new Date().toISOString(),
      backend: activeVaultType,
      key,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
    });
    throw err;
  }
  if (value !== null) touchSession();
  runAfterHooks({
    type: value !== null ? "credential_read" : "credential_read_missing",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    durationMs: performance.now() - start,
  });
  return value;
}

/**
 * Delete a credential from the active vault backend.
 *
 * @param key - Logical key name (e.g. 'auth-token')
 * @returns true on success (including "already deleted"), false on unexpected error
 */
export async function deleteCredential(key: string): Promise<boolean> {
  const start = performance.now();
  await runBeforeHooks({ type: "delete", key });
  const success = activeBackend.delete(key);
  runAfterHooks({
    type: success ? "credential_deleted" : "credential_delete_failed",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    durationMs: performance.now() - start,
  });
  return success;
}

/**
 * Enumerate credential keys in the active vault backend, optionally
 * filtered by a key prefix.
 *
 * Returns only the keys — credential values are retrieved via
 * `getCredential(key)` on demand. This keeps listing cheap and avoids
 * pulling secret material into memory.
 *
 * @param prefix - optional key prefix filter. When omitted, all keys are
 *                 returned.
 *
 * Note: credential keys must match `isValidKey` — lowercase alphanumeric
 * plus hyphen and dot, first and last character alphanumeric, <=64 chars.
 * Both `-` and `.` work as namespace separators; pick whichever convention
 * reads best.
 *
 * @example
 *   // Enumerate all soma-owned Anthropic credentials
 *   const keys = await listCredentials("soma.anthropic.");
 *   for (const key of keys) {
 *     const value = await getCredential(key);
 *     // ... round-robin rotation, etc.
 *   }
 */
export async function listCredentials(prefix?: string): Promise<string[]> {
  const start = performance.now();
  await runBeforeHooks({ type: "enumerate", prefix });
  let keys: string[];
  try {
    keys = await activeBackend.listKeys(prefix);
  } catch (err) {
    runAfterHooks({
      type: "credential_enumerate_failed",
      timestamp: new Date().toISOString(),
      backend: activeVaultType,
      prefix,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
    });
    throw err;
  }
  if (keys.length > 0) touchSession();
  runAfterHooks({
    type: "credential_enumerated",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    prefix,
    keyCount: keys.length,
    durationMs: performance.now() - start,
  });
  return keys;
}
