/**
 * Retry classification + backoff wiring for the Engram SDK client.
 *
 * This module is the SINGLE source of truth for two things the client's retry
 * loop depends on:
 *
 * 1. {@link isRetryableError} — the predicate that decides whether a caught
 *    error is worth re-issuing the request for. The client uses it internally,
 *    and it is re-exported from the package barrel so downstream consumers
 *    (centient, mbot, test-kit) can stop hand-rolling the same decision by
 *    string-matching error messages.
 * 2. {@link createClientBackoff} — the jittered retry schedule, delegated to
 *    `@centient/resilience`'s `createBackoff`. The `linear` strategy with
 *    `jitterRatio = 0.5` reproduces the client's historical schedule exactly
 *    (base `attempt * retryDelay` plus jitter in `[0, 0.5 * retryDelay)`), so
 *    adopting the shared primitive is behaviour-preserving.
 */

import { createBackoff, type Backoff } from "@centient/resilience";
import { EngramError, NetworkError, TimeoutError } from "./errors.js";

/**
 * Decide whether `err` represents a *transient* failure that is worth retrying.
 *
 * This encodes the exact policy the SDK client applies in its request loop, so
 * there is one authoritative classification rather than a copy per consumer:
 *
 * - **Retryable (`true`)**
 *   - A server error: an {@link EngramError} whose `statusCode >= 500`. The
 *     server failed in a way that may succeed on a fresh attempt.
 *   - A raw transport failure: any non-SDK `Error` (e.g. a `fetch`
 *     `TypeError`, a DNS/`ECONNREFUSED` error). The client wraps these into a
 *     {@link NetworkError} only *after* exhausting retries, so before wrapping
 *     they are retryable.
 *
 * - **Non-retryable (`false`)**
 *   - {@link TimeoutError} — an aborted request. Re-issuing risks compounding
 *     load on an already-slow server; the client surfaces it terminally.
 *   - {@link NetworkError} — a *deterministic* failure the client raises for a
 *     non-JSON / unparseable 2xx body (and similar). Re-issuing returns the
 *     same bad body, so it is terminal (the rule established for non-JSON 2xx
 *     bodies). This includes `ResponseShapeError` (a `NetworkError` subtype is
 *     not used, but it shares this deterministic-failure contract — see below).
 *   - A client error: an {@link EngramError} with `statusCode < 500` (4xx
 *     validation/auth/not-found) or no `statusCode` (deterministic shape/parse
 *     errors). Retrying cannot change the outcome.
 *   - Any non-`Error` value (`null`, a string, etc.).
 *
 * @param err - The caught error (typed as `unknown` so it composes with
 *   `catch` blocks without a cast).
 * @returns `true` if the SDK would retry this error, `false` otherwise.
 *
 * @example
 * try {
 *   await client.search(sessionId, { query });
 * } catch (err) {
 *   if (isRetryableError(err)) {
 *     // back off and try again at the application layer
 *   } else {
 *     throw err; // terminal — surface to the caller
 *   }
 * }
 */
export function isRetryableError(err: unknown): boolean {
  // TimeoutError and NetworkError are EngramError subclasses but are always
  // terminal — short-circuit them before the generic 5xx check. (TimeoutError
  // / NetworkError carry no >=500 statusCode, so they would already classify as
  // non-retryable, but listing them makes the contract explicit and robust to
  // future code changes.)
  if (err instanceof TimeoutError || err instanceof NetworkError) {
    return false;
  }

  // Server errors (5xx) are the only typed SDK errors the client retries.
  if (err instanceof EngramError) {
    return err.statusCode !== undefined && err.statusCode >= 500;
  }

  // A raw, not-yet-wrapped transport error (e.g. fetch TypeError, ECONNREFUSED)
  // is retryable — the client retries it before wrapping into a NetworkError on
  // exhaustion.
  if (err instanceof Error) {
    return true;
  }

  // Non-Error throwables are not retryable.
  return false;
}

/**
 * Build the client's retry backoff schedule from `@centient/resilience`.
 *
 * Uses the `linear` strategy with `jitterRatio = 0.5`, which reproduces the
 * client's historical `backoffDelay` exactly: the sleep before retry `attempt`
 * (1-based) is `attempt * retryDelay` plus a uniform jitter in
 * `[0, 0.5 * retryDelay)`.
 *
 * Randomness defaults to the resilience `systemRandom` source, which calls
 * `Math.random()` — so existing tests that stub `Math.random` continue to pin
 * the jitter deterministically.
 *
 * @param retryDelayMs - The base retry delay in ms.
 */
export function createClientBackoff(retryDelayMs: number): Backoff {
  return createBackoff({
    baseDelayMs: retryDelayMs,
    strategy: "linear",
    jitterRatio: 0.5,
  });
}
