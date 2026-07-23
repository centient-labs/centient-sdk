/**
 * Auth Module — Shared Type Definitions
 */

// =============================================================================
// Token Validation
// =============================================================================

export interface TokenValidationResult {
  valid: boolean;
  status: "valid" | "expiring_soon" | "expired";
  expiresAt: Date | null;
  remainingMs: number;
  formattedRemaining: string;
}

// =============================================================================
// Device Flow
// =============================================================================

export interface DeviceFlowConfig {
  /** Base URL for the auth API (e.g. https://api.engram.ai) */
  baseUrl: string;
  /** OAuth client ID */
  clientId?: string;
  /** Poll timeout in seconds (default: 300) */
  timeoutSeconds?: number;
}

export interface DeviceFlowResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export type DeviceFlowErrorCode =
  | "access_denied"
  | "expired_token"
  | "network_error"
  | "timeout"
  | "unknown";

export class DeviceFlowError extends Error {
  constructor(
    public readonly code: DeviceFlowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

// =============================================================================
// Display
// =============================================================================

export interface SpinnerHandle {
  /** Update the spinner message */
  update(message: string): void;
  /** Stop the spinner and optionally print a final line */
  stop(finalMessage?: string): void;
}

export interface CountdownHandle {
  /** Cancel the countdown early */
  cancel(): void;
}

// =============================================================================
// Vault / Credential
// =============================================================================

export type VaultType =
  | "keychain"
  | "windows"
  | "libsecret"
  | "gpg"
  | "env"
  | "1password"
  | "session-vault"
  | "unknown";

export interface StoredCredentialMeta {
  source: "device-flow" | "api-key" | "env";
  storedAt: string; // ISO-8601
  refreshToken?: string;
}

/**
 * Common interface implemented by all vault backends.
 * Backends must implement store/retrieve/delete/listKeys plus a static detect() method.
 *
 * **Key contract (#168).** `key` must match the grammar in `vault-utils.ts`:
 * 2-64 characters of lowercase alphanumerics with `-` or `.` as separators,
 * beginning and ending with an alphanumeric. Implementations assert this with
 * `assertValidKey` and throw `InvalidCredentialKeyError` — a malformed key is
 * a caller-contract violation, not a storage outcome, so it must not be
 * reported through the `false`/`null` channel that means "the write failed" or
 * "no such credential". The cascade in `vault.ts` enforces the same rule
 * before dispatching; backends re-assert it because they are individually
 * constructible and several interpolate the key into a shell string or an
 * `op://` reference, where the grammar is also the injection guard.
 */
export interface VaultBackend {
  store(key: string, value: string): boolean;
  retrieve(key: string): string | null;
  delete(key: string): boolean;

  /**
   * Enumerate credential keys stored in this backend.
   *
   * @param prefix - if provided, only keys starting with this prefix are
   *                 returned. If omitted, returns every key the backend
   *                 can see.
   *
   * Returns keys in unspecified order; callers must not rely on sort order.
   *
   * Implementations that cannot enumerate (e.g. an env-var backend without
   * a naming convention they can filter) should return an empty array
   * rather than throwing. Transient failures from the underlying store
   * (keychain access denied, libsecret timeout, filesystem permission
   * error) should throw, so the caller can retry or surface the problem.
   *
   * Async to support backends (e.g. libsecret via D-Bus) that require
   * non-blocking I/O for enumeration. Backends whose enumeration is
   * naturally synchronous (Keychain, GPG, env-var) can simply mark the
   * method `async` — the sync return value is auto-wrapped in a resolved
   * promise.
   */
  listKeys(prefix?: string): Promise<string[]>;
}
