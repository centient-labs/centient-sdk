/**
 * Result type for @centient/path-security.
 *
 * Mirrors the monorepo's Result convention
 * (`.agent/patterns/error-handling.md`): every operation returns a
 * discriminated union rather than throwing, so callers must handle the
 * failure path explicitly. Security checks especially must never fail
 * silently — a rejected path returns a machine-readable `code` so callers
 * can branch on the specific attack class that was detected.
 */

/** Machine-readable rejection reason for a path-security check. */
export type PathErrorCode =
  | "EMPTY"
  | "NULL_BYTE"
  | "CONTROL_CHAR"
  | "PATH_SEPARATOR"
  | "DOT_SEGMENT"
  | "TRAVERSAL"
  | "PERCENT_ENCODED"
  | "UNICODE_TRICK"
  | "RESERVED_DEVICE_NAME"
  | "WINDOWS_DRIVE"
  | "UNC_PATH"
  | "TRAILING_DOT_OR_SPACE"
  | "TOO_LONG"
  | "NOT_ABSOLUTE"
  | "OUTSIDE_ROOTS"
  | "NO_ALLOWED_ROOTS";

/** Structured error returned on the failure path. */
export interface PathError {
  /** Machine-readable identifier for the rejection. */
  code: PathErrorCode;
  /** Human-readable description (does not echo the raw untrusted input). */
  message: string;
}

/** Discriminated-union result: success carries a value, failure an error. */
export type Result<T, E = PathError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Construct a success result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct a failure result with a structured {@link PathError}. */
export function error<E = PathError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Convenience constructor for a {@link PathError} failure result. */
export function fail(code: PathErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
