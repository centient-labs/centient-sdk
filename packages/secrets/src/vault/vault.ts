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
 * Error handling: a *storage* failure is reported as `null`/`false` — the
 * backend contract is non-throwing. Three things do throw, because they are
 * not storage outcomes: a policy `before` hook rejecting the operation
 * (ADR-002 §1.0.0), a backend surfacing an unexpected transport failure from
 * `retrieve`/`listKeys`, and a malformed credential key
 * (`InvalidCredentialKeyError`, see the key-validation section below).
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
import { runBeforeHooks, runAfterHooks, rejectedEventType } from "./policy.js";
import type { SecretsOperation } from "./policy.js";
import { isValidKey, isValidKeyPrefix } from "./vault-utils.js";
import { InvalidCredentialKeyError } from "./session-vault-errors.js";

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
// Key validation (#168)
//
// The key grammar is enforced HERE, once, for every backend — not per backend.
// Before #168 it was documented on `listCredentials` and enforced nowhere on
// the shared path: `KeychainVault` (cascade position 1, and therefore the
// active backend on every Mac) and `EnvVault` (position 5, the always-available
// fallback) accepted anything, while GPG/libsecret/Windows/1Password refused
// it. A key such as `Auth_Token` consequently stored fine on darwin and was
// unreadable on every other backend — the silent write/read asymmetry the
// invariant exists to prevent. One rule enforced once at the boundary is the
// only shape in which that stays true as backends are added (P6/P2).
//
// Validation runs BEFORE the policy `before` hooks. A malformed key is a
// caller-contract violation, not a policy decision — there is no well-formed
// operation for a policy to allow or deny, and an access-control hook should
// never be handed a key the storage layer has already ruled out. The rejection
// is still audited: the `after` hooks fire with the same `*_rejected` event a
// policy denial produces, so a refused operation is never invisible to the
// audit trail. Unlike a policy denial, every policy's `after` hook fires —
// none was entered, so there is no partially-entered stack to respect.
// =============================================================================

/**
 * Audit the rejection of `op` and hand `err` back for the caller to throw.
 *
 * Split out so the four public functions reject identically. It returns the
 * error rather than throwing it so the call site reads `throw rejectKey(...)`
 * — the `throw` stays visible where control flow actually leaves.
 */
function rejectKey(
  op: SecretsOperation,
  err: InvalidCredentialKeyError,
  start: number,
): InvalidCredentialKeyError {
  runAfterHooks({
    type: rejectedEventType(op),
    timestamp: new Date().toISOString(),
    backend: activeVaultType,
    ...(op.key !== undefined ? { key: op.key } : {}),
    ...(op.prefix !== undefined ? { prefix: op.prefix } : {}),
    error: err.message,
    durationMs: performance.now() - start,
  });
  return err;
}

/** Reject a malformed key for a keyed operation, auditing the rejection. */
function guardKey(
  key: string,
  type: "read" | "write" | "delete",
  start: number,
): void {
  if (isValidKey(key)) return;
  throw rejectKey({ type, key }, new InvalidCredentialKeyError(key, type, "key"), start);
}

/** Reject a malformed enumeration prefix, auditing the rejection. */
function guardPrefix(prefix: string | undefined, start: number): void {
  if (prefix === undefined || isValidKeyPrefix(prefix)) return;
  throw rejectKey(
    { type: "enumerate", prefix },
    new InvalidCredentialKeyError(prefix, "enumerate", "prefix"),
    start,
  );
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
 * @param key     - Logical key name (e.g. 'auth-token', 'refresh-token').
 *                  Must match the key grammar — see "Key validation" above.
 * @param value   - The credential value to store
 * @returns true on success, false if the backend write fails
 * @throws {InvalidCredentialKeyError} if `key` does not match the grammar.
 *   Nothing is written and no backend is contacted.
 */
export async function storeCredential(
  key: string,
  value: string,
): Promise<boolean> {
  const start = performance.now();
  guardKey(key, "write", start);
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
 * @throws {InvalidCredentialKeyError} if `key` does not match the grammar.
 *   Deliberately not `null`: "malformed" and "not stored" are different
 *   answers, and returning the not-found shape for the first is the silent
 *   degradation this path used to have.
 */
export async function getCredential(key: string): Promise<string | null> {
  const start = performance.now();
  guardKey(key, "read", start);
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
 * @throws {InvalidCredentialKeyError} if `key` does not match the grammar.
 *   Not reported as an idempotent success: such a key was never storable, so
 *   "already deleted" would be a claim the vault cannot make.
 */
export async function deleteCredential(key: string): Promise<boolean> {
  const start = performance.now();
  guardKey(key, "delete", start);
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
 * reads best. **This is enforced, not merely documented** (#168): every
 * function on this path rejects a non-conforming key before dispatching.
 *
 * A `prefix` is checked against `isValidKeyPrefix` rather than `isValidKey`,
 * so it may end on a separator — `"soma.anthropic."` is the intended way to
 * scope an enumeration to a namespace, and is not itself a valid key.
 *
 * @throws {InvalidCredentialKeyError} if `prefix` could not be the leading
 *   substring of any valid key.
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
  guardPrefix(prefix, start);
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
