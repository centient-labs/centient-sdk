/**
 * Auth Vault — Shared Utilities
 *
 * Shared validation and helper functions used across all vault backends.
 */

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
