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
 * **Explicit selection (ADR-004) sits in front of that cascade.** `secrets.backend`
 * (or `CENTIENT_SECRETS_BACKEND`) names a backend directly and fails closed if it
 * is unusable — it is never silently substituted. `OnePasswordVault` is reachable
 * *only* this way: having `op` installed is not consent to route credentials into
 * someone's 1Password vault.
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
import { OnePasswordVault } from "./vault-onepassword.js";
import type { VaultBackend, VaultType } from "./types.js";
import { loadConfig } from "../key-providers/resolve.js";
import type {
  OnePasswordBackendConfig,
  SecretsBackendType,
} from "../key-providers/types.js";
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
 * Read the explicitly-selected backend, env taking precedence over config —
 * the same env > config order the key layer uses (ADR-001).
 *
 * Returns null when nothing is explicitly selected, which is the signal to run
 * the auto-cascade unchanged.
 */
function resolveExplicitBackend(): {
  type: SecretsBackendType;
  onePasswordBackend: OnePasswordBackendConfig;
} | null {
  const envBackend = process.env.CENTIENT_SECRETS_BACKEND?.trim();
  const config = loadConfig().secrets ?? {};
  const selected = envBackend || config.backend;
  if (!selected) return null;

  if (selected !== "1password") {
    throw new Error(
      `Unknown secrets backend "${selected}". Supported explicit backends: 1password.`,
    );
  }

  const envVault = process.env.CENTIENT_OP_VAULT?.trim();
  const onePasswordBackend: OnePasswordBackendConfig = {
    ...config.onePasswordBackend,
    ...(envVault ? { vault: envVault } : {}),
  };
  return { type: selected, onePasswordBackend };
}

/**
 * Selects the credential-storage backend.
 *
 * **Explicit selection wins and fails closed** (ADR-004 §1): if config or env
 * names a backend that then turns out to be unusable — no vault configured, `op`
 * missing or unauthenticated — this throws rather than quietly continuing down
 * the auto-cascade. Falling through would silently store credentials somewhere
 * other than where the operator said, which is the whole class of surprise the
 * opt-in model exists to prevent (P2).
 *
 * With no explicit selection, the historical auto-cascade runs unchanged:
 *   Keychain -> Windows -> Libsecret -> GPG -> Env
 * 1Password is **never** auto-selected — `op` being installed is not consent to
 * route credentials into it.
 */
function initVaultBackend(): { backend: VaultBackend; type: VaultType } {
  const explicit = resolveExplicitBackend();
  if (explicit !== null) {
    // Constructor throws on a missing vault name — the fail-closed half of §1.
    const backend = new OnePasswordVault(explicit.onePasswordBackend);
    if (!OnePasswordVault.detect(true)) {
      throw new Error(
        'secrets backend "1password" was explicitly selected, but the 1Password CLI ' +
          "(`op`) is unavailable or not authenticated. Install `op` and sign in, or set " +
          "OP_SERVICE_ACCOUNT_TOKEN. Refusing to fall back to another backend — an " +
          "explicit backend choice is never silently substituted.",
      );
    }
    return { backend, type: "1password" };
  }

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
// Policy-rejected operations are audited: when a `before` hook throws,
// the rejection propagates to the caller AND the `after` hooks of the
// already-entered policies fire with a `*_rejected` event (see
// `runBeforeHooks` in policy.ts), so a denied operation is never
// invisible to the audit trail. ADR-002 §1.0.0.
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
  await runBeforeHooks({ type: "write", key }, (error) => ({
    type: "credential_write_rejected",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    error,
    durationMs: performance.now() - start,
  }));
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
  await runBeforeHooks({ type: "read", key }, (error) => ({
    type: "credential_read_rejected",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    error,
    durationMs: performance.now() - start,
  }));
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
  await runBeforeHooks({ type: "delete", key }, (error) => ({
    type: "credential_delete_rejected",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    key,
    error,
    durationMs: performance.now() - start,
  }));
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
  await runBeforeHooks({ type: "enumerate", prefix }, (error) => ({
    type: "credential_enumerate_rejected",
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    prefix,
    error,
    durationMs: performance.now() - start,
  }));
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
