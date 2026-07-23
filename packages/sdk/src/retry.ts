/**
 * Retry classification + backoff wiring for the Engram SDK client.
 *
 * This module is the SINGLE source of truth for three things the client's retry
 * loop depends on:
 *
 * 1. {@link isRetryableError} — the DEFAULT predicate that decides whether a
 *    caught error is worth re-issuing the request for. The client uses it
 *    internally, and it is re-exported from the package barrel so downstream
 *    consumers (centient, mbot, test-kit) can stop hand-rolling the same
 *    decision by string-matching error messages.
 * 2. {@link isBrownoutTransientError} — the OPT-IN predicate implementing the
 *    brownout-tolerant taxonomy (issue #116 / #173): timeouts and transport
 *    failures are retried, unknown errors are not. Pass it as
 *    `createEngramClient({ shouldRetry: isBrownoutTransientError })`.
 * 3. {@link createClientBackoff} — the jittered retry schedule, delegated to
 *    `@centient/resilience`'s `createBackoff`. The `linear` strategy with
 *    `jitterRatio = 0.5` reproduces the client's historical schedule exactly
 *    (base `attempt * retryDelay` plus jitter in `[0, 0.5 * retryDelay)`), so
 *    adopting the shared primitive is behaviour-preserving.
 *
 * ## Why the classifier is a seam, and why the default did not change
 *
 * "Which failures are worth re-issuing" is a property of the CALLER's failure
 * domain, not of the transport. A client riding out an engram brownout wants
 * request timeouts retried (they are the brownout's dominant transient) and
 * unknown errors NOT retried (an unclassifiable failure may be a non-idempotent
 * partial success, and replaying it duplicates a write). A client fronting pure
 * idempotent reads may want the opposite.
 *
 * {@link isRetryableError} makes the opposite call on both classes. Flipping it
 * would change the on-the-wire behaviour of every existing `@centient/sdk`
 * caller in a minor — including making blind replays of non-idempotent POSTs
 * the new default, which is exactly the hazard the conservative taxonomy exists
 * to prevent. So the default is unchanged at 2.x and the taxonomy is opt-in;
 * the flip is deferred to the next major (#173).
 */

import { createBackoff, type Backoff } from "@centient/resilience";
import {
  EngramError,
  NetworkError,
  ResponseShapeError,
  TimeoutError,
} from "./errors.js";

/**
 * Classifies a caught failure as worth retrying (`true`) or terminal
 * (`false`).
 *
 * Called with the raw thrown value, which may be anything — an implementation
 * must tolerate non-`Error` throws. Structurally identical to
 * `@centient/resilience`'s `ShouldRetry`, so a predicate built there
 * (`isTransientError`, `createTransientErrorPredicate(...)`) assigns directly;
 * declared here so the SDK's public type surface stays self-contained.
 *
 * @see {@link isRetryableError} — the client's default.
 * @see {@link isBrownoutTransientError} — the brownout-tolerant opt-in.
 */
export type RetryPredicate = (error: unknown) => boolean;

/**
 * Decide whether `err` represents a *transient* failure that is worth retrying.
 *
 * This encodes the exact policy the SDK client applies in its request loop, so
 * there is one authoritative classification rather than a copy per consumer:
 *
 * - **Retryable (`true`)**
 *   - A server error: an {@link EngramError} whose `statusCode >= 500`. The
 *     server failed in a way that may succeed on a fresh attempt.
 *   - A raw transport failure: a `fetch` `TypeError` or a plain/other `Error`
 *     (e.g. a DNS/`ECONNREFUSED` error). The client wraps these into a
 *     {@link NetworkError} only *after* exhausting retries, so before wrapping
 *     they are retryable.
 *
 * **`TypeError` stays retryable — this is load-bearing.** The WHATWG `fetch`
 * standard surfaces *all* transport failures (DNS, connection refused, TLS,
 * abort-less resets) as a bare `TypeError` with message `"Failed to fetch"` /
 * `"fetch failed"`. Excluding `TypeError` would therefore silently break
 * retries for real network outages — the common, transient case — so it is
 * deliberately kept retryable along with plain/other `Error` instances.
 *
 * **Unambiguous programming-error constructors are excluded.** A
 * `ReferenceError`, `SyntaxError`, `RangeError`, or `EvalError` is never a
 * transient transport failure — it is a bug (an undefined symbol, malformed
 * source/JSON, an out-of-range argument). `fetch` does not surface network
 * failures through any of these, so classifying them as non-retryable narrows
 * the predicate to exclude genuine programming errors without dropping a single
 * real network retry.
 *
 * - **Non-retryable (`false`)**
 *   - A programming error: a {@link ReferenceError}, {@link SyntaxError},
 *     {@link RangeError}, or {@link EvalError}. These are bugs, not transient
 *     failures, and re-issuing the request cannot fix them.
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
 *   - A permanent 5xx gate: an {@link EngramError} whose `statusCode >= 500` but
 *     which opts out via `retryable === false` — e.g. `ShimmerDisabledError`
 *     (503 `SHIMMER_DISABLED`), a deployment-configuration state that will not
 *     clear on retry until the operator enables the surface (Codex #112 P2).
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

  // Server errors (5xx) are the only typed SDK errors the client retries —
  // UNLESS the error opts out via `EngramError.retryable === false`. A permanent
  // 5xx deployment gate such as `ShimmerDisabledError` (503 `SHIMMER_DISABLED`)
  // carries a >=500 status but is DETERMINISTIC: re-issuing the identical
  // request returns the identical failure until the operator enables the
  // surface, so it is surfaced immediately rather than burning the retry budget
  // (Codex #112 P2). `retryable` defaults to `true` for every other 5xx, so the
  // historical transient-5xx behaviour is unchanged. This module is the single
  // source of truth for retryability, so the opt-out lives here rather than as
  // an inline `.retryable` check in the client's request loop.
  if (err instanceof EngramError) {
    return err.statusCode !== undefined && err.statusCode >= 500 && err.retryable;
  }

  // Unambiguous programming-error constructors are never transient transport
  // failures — they are bugs (undefined symbol, malformed source/JSON,
  // out-of-range argument). `fetch` does not surface network failures through
  // any of these, so excluding them narrows the predicate without dropping any
  // real network retry. NOTE: `TypeError` is intentionally NOT in this set —
  // `fetch` reports every transport failure as a bare `TypeError`, so it must
  // stay retryable (see the JSDoc above).
  const PROGRAMMING_ERRORS = [
    ReferenceError,
    SyntaxError,
    RangeError,
    EvalError,
  ] as const;
  if (
    err instanceof Error &&
    PROGRAMMING_ERRORS.some(
      (Ctor) => err.constructor === Ctor || err instanceof Ctor,
    )
  ) {
    return false;
  }

  // A raw, not-yet-wrapped transport error (e.g. fetch TypeError, ECONNREFUSED)
  // is retryable — the client retries it before wrapping into a NetworkError on
  // exhaustion. `TypeError` and plain/other `Error` instances are kept
  // retryable because `fetch` reports every transport failure as a bare
  // `TypeError`. See the JSDoc above.
  if (err instanceof Error) {
    return true;
  }

  // Non-Error throwables are not retryable.
  return false;
}

/**
 * Transport-level `error.code` values that always mean "the connection failed",
 * not "the request was rejected". Node surfaces these on the `cause` of the
 * bare `TypeError` `fetch` throws, and directly on the error for non-`fetch`
 * transports.
 */
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/** Read a string `code` off an arbitrary thrown value. */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : undefined;
}

/**
 * The **opt-in** brownout-tolerant classifier (issue #116 §2, #173).
 *
 * Pass it to `createEngramClient({ shouldRetry: isBrownoutTransientError })`
 * when the client fronts an engram deployment that browns out under load and
 * every call the client makes is safe to re-issue on a timeout.
 *
 * | Class | Retried | Why |
 * |---|---|---|
 * | {@link TimeoutError} / `AbortError` / `TimeoutError` by name | **yes** | the dominant brownout transient — the request may never have reached the server |
 * | 5xx {@link EngramError} (unless `retryable === false`) | yes | the server's own transient; the `retryable` opt-out still wins (`SHIMMER_DISABLED`) |
 * | Transport failure: `fetch`'s bare `TypeError`, or an `ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`-class `code` | **yes** | the connection failed; no request was serviced |
 * | {@link NetworkError} *carrying an `originalError`* | yes | the client's post-exhaustion wrapper around a transport failure |
 * | 4xx {@link EngramError}, including 409 CAS conflicts | no | deterministic — a replay re-fails identically, and conflict policy is the caller's |
 * | {@link ResponseShapeError}, and a {@link NetworkError} with no `originalError` | no | a malformed/unparseable body is deterministic — re-issuing returns the same bad body |
 * | Programming errors (`ReferenceError`/`SyntaxError`/`RangeError`/`EvalError`) | no | bugs, not transients |
 * | **Anything else, including a generic `Error`** | **no** | an unclassifiable failure may be a non-idempotent partial success; replaying it risks a duplicate write |
 *
 * ## Two carve-outs worth knowing before you adopt it
 *
 * 1. **A bare `TypeError` stays retryable.** The WHATWG `fetch` standard
 *    surfaces *every* transport failure (DNS, connection refused, TLS, reset)
 *    as a `TypeError` with message `"fetch failed"` and the real code buried on
 *    `cause`. Classifying `TypeError` as "unknown" would silently disable
 *    retries for real network outages — the exact failure this predicate exists
 *    to ride out. This is the one deliberate exception to "unknown ⇒ terminal".
 * 2. **Prefer it over `@centient/resilience`'s `isTransientError` for THIS
 *    client.** The resilience preset is shape-based and does not know the SDK's
 *    error classes: it reads `fetch`'s bare `TypeError` as unknown (terminal),
 *    so wiring it in as `shouldRetry` would stop retrying real network failures
 *    that the SDK retries today. `isTransientError` remains the right default
 *    for `withRetry()` around SDK calls at the APPLICATION layer, where the
 *    errors it sees are already the SDK's typed ones.
 *
 * @example Opt in at construction
 * const client = createEngramClient({
 *   baseUrl,
 *   apiKey,
 *   shouldRetry: isBrownoutTransientError,
 * });
 *
 * @example Opt in, but keep CAS conflicts and one extra code the caller owns
 * const client = createEngramClient({
 *   baseUrl,
 *   shouldRetry: (err) =>
 *     isBrownoutTransientError(err) || (err as { code?: string }).code === "EBUSY",
 * });
 */
export const isBrownoutTransientError: RetryPredicate = function isBrownoutTransientError(
  err: unknown,
): boolean {
  // Deterministic shape failures first: both are EngramError subclasses, and a
  // malformed body returns identically malformed on a replay.
  if (err instanceof ResponseShapeError) return false;

  // The brownout transient. Retried here, terminal under the default.
  if (err instanceof TimeoutError) return true;

  // NetworkError is raised for TWO different things. The post-exhaustion
  // transport wrapper carries the underlying error; the deterministic
  // non-JSON-body failure does not. Split on that structural difference rather
  // than on the message, and let the ambiguous case fall to terminal.
  if (err instanceof NetworkError) return err.originalError !== undefined;

  if (err instanceof EngramError) {
    if (err.statusCode !== undefined) {
      // 5xx is the server's transient (minus the `retryable` opt-out); every
      // other status — 4xx, including a 409 CAS conflict — is deterministic.
      return err.statusCode >= 500 && err.retryable;
    }
    // A status-less EngramError carrying the transport codes the SDK mints.
    return err.code === "TIMEOUT" || err.code === "NETWORK_ERROR";
  }

  if (typeof err !== "object" || err === null) return false;

  // A non-SDK abort/timeout (e.g. an AbortSignal fired by the caller's own
  // wrapper, or undici's DOMException).
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;

  // Transport codes, read from the error itself and from the `cause` chain —
  // Node's `fetch` puts the real code on `cause`, not on the TypeError.
  if (TRANSPORT_ERROR_CODES.has(errorCode(err) ?? "")) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (TRANSPORT_ERROR_CODES.has(errorCode(cause) ?? "")) return true;

  // See carve-out 1 above: `fetch` reports every transport failure as a bare
  // TypeError, so it must stay retryable even though it is otherwise
  // indistinguishable from a programming bug.
  if (err instanceof TypeError) return true;

  // Everything else — programming errors, generic `Error`, anything unknown —
  // is terminal. An unclassifiable failure may be a non-idempotent partial
  // success, and replaying it risks a duplicate write.
  return false;
};

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
