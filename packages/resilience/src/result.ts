/**
 * Result type — explicit success/failure without exceptions.
 *
 * Mirrors the `{ ok: true } | { ok: false }` discriminated-union convention
 * used across the @centient packages, giving callers a typed error channel
 * for the operations where failure is an ordinary, expected outcome (a rate
 * limiter denying a call, a cache miss promoted to an error, a pool refusing
 * work). Throwing is reserved for programmer error (invalid configuration).
 */

/** A successful result carrying a value. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** A failed result carrying a typed error. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Discriminated union of success or failure. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Construct a successful {@link Result}. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct a failed {@link Result}. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrow a {@link Result} to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Narrow a {@link Result} to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
