/**
 * Auth Vault — Shared Utilities
 *
 * Shared validation and helper functions used across all vault backends.
 *
 * The key grammar is a **package-wide invariant**, not a per-backend
 * preference: `vault.ts` enforces it once at the cascade before any backend
 * is dispatched to (#168), and each backend re-asserts it so that a directly
 * constructed backend cannot bypass the rule — several of them interpolate
 * the key into a shell string or an `op://` reference path, where the grammar
 * is also the injection guard.
 */

import { InvalidCredentialKeyError } from "./session-vault-errors.js";

/**
 * Allowed key name pattern — lowercase alphanumeric plus hyphen and dot,
 * 2-64 characters. The inner class permits hyphens and dots so that
 * callers can use either `-` or `.` as a namespace separator (e.g.
 * `soma-anthropic-token1` or `soma.anthropic.token1`). First and last
 * characters must be alphanumeric so keys cannot start or end with a
 * separator.
 */
const VALID_KEY_RE = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

/**
 * Returns true if the given credential key name is valid.
 *
 * Keys must:
 * - match `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/` (lowercase alphanumeric plus
 *   hyphen and dot, starting and ending with an alphanumeric character),
 * - be at most 64 characters long.
 *
 * Hyphens and dots are both permitted as namespace separators so callers
 * can choose whichever convention reads best (`soma-anthropic-token1`,
 * `soma.anthropic.token1`). Underscores, uppercase, whitespace, and
 * shell metacharacters are deliberately rejected so keys can safely be
 * interpolated into subprocess argv positions without additional
 * escaping.
 */
export function isValidKey(key: string): boolean {
  return VALID_KEY_RE.test(key) && key.length <= 64;
}

/**
 * Allowed key-*prefix* pattern — every proper prefix of a valid key, plus the
 * valid keys themselves.
 *
 * `listCredentials(prefix)` filters by string prefix, so the natural way to
 * scope an enumeration to a namespace is to pass the separator too:
 * `listCredentials("soma.anthropic.")`. That is not a valid *key* (it ends in
 * a separator), so validating a prefix with `isValidKey` would reject the
 * documented usage. A prefix therefore relaxes exactly one rule — the trailing
 * character may be a separator — and keeps the rest, since a prefix reaches
 * the same argv / shell / `op://` positions a key does.
 */
const VALID_KEY_PREFIX_RE = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * Returns true if `prefix` could be the leading substring of a valid key.
 *
 * The empty string is accepted: `listCredentials("")` selects everything,
 * exactly as omitting the argument does.
 */
export function isValidKeyPrefix(prefix: string): boolean {
  if (prefix === "") return true;
  return VALID_KEY_PREFIX_RE.test(prefix) && prefix.length <= 64;
}

/** Operations a key can be rejected for — mirrors `SecretsOperation["type"]`. */
export type KeyOperation = "read" | "write" | "delete" | "enumerate";

/**
 * Throw `InvalidCredentialKeyError` unless `key` matches the key grammar.
 *
 * Backends call this instead of returning `false`/`null`, so a malformed key
 * is never mistaken for a failed write or an absent credential (#168, P2).
 */
export function assertValidKey(key: string, operation: KeyOperation): void {
  if (isValidKey(key)) return;
  throw new InvalidCredentialKeyError(key, operation, "key");
}

/** Throw `InvalidCredentialKeyError` unless `prefix` is a valid key prefix. */
export function assertValidKeyPrefix(prefix: string, operation: KeyOperation): void {
  if (isValidKeyPrefix(prefix)) return;
  throw new InvalidCredentialKeyError(prefix, operation, "prefix");
}
