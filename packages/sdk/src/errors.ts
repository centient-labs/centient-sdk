/**
 * Custom error classes for Engram SDK
 */

import type { ApiError, ErrorCode, ValidationError } from "./types.js";

/**
 * Base error class for all Engram SDK errors
 */
export class EngramError extends Error {
  /** Raw error details from the API response, if any. */
  public readonly details?: unknown;

  constructor(
    message: string,
    public readonly code: ErrorCode | "NETWORK_ERROR" | "TIMEOUT",
    public readonly statusCode?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "EngramError";
    this.details = details;
    Object.setPrototypeOf(this, EngramError.prototype);
  }
}

/**
 * Error thrown when a resource is not found (404)
 */
export class NotFoundError extends EngramError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when a session already exists (409)
 */
export class SessionExistsError extends EngramError {
  constructor(sessionId: string) {
    super(`Session ${sessionId} already exists`, "SESSION_EXISTS", 409);
    this.name = "SessionExistsError";
    Object.setPrototypeOf(this, SessionExistsError.prototype);
  }
}

/**
 * Error thrown when an optimistic-concurrency (CAS) update fails because the
 * crystal's current server-side `version` does not match the caller's
 * `expectedVersion` (409).
 *
 * The server-reported `currentVersion` is exposed so callers can re-fetch,
 * merge, and retry without a second round trip. Typical retry pattern:
 *
 * ```typescript
 * try {
 *   await client.crystals.update(id, { title: "...", expectedVersion: local.version });
 * } catch (err) {
 *   if (err instanceof CrystalVersionConflictError) {
 *     const fresh = await client.crystals.get(id);
 *     // merge local edits onto `fresh`, then retry with expectedVersion: err.currentVersion
 *   }
 * }
 * ```
 */
export class CrystalVersionConflictError extends EngramError {
  /** The server's current `version` for the crystal — use for re-fetching and retrying. */
  public readonly currentVersion: number;

  constructor(message: string, currentVersion: number, details?: unknown) {
    super(message, "OPERATION_VERSION_CONFLICT", 409, details);
    this.name = "CrystalVersionConflictError";
    this.currentVersion = currentVersion;
    Object.setPrototypeOf(this, CrystalVersionConflictError.prototype);
  }
}

/**
 * Error thrown when a shimmer lock acquire/renew, or an ipc post-once, fails its
 * compare-and-swap (409 `SHIMMER_CAS_CONFLICT`).
 *
 * Causes:
 *  - `acquireLock`: the key is already held by another live owner.
 *  - `renewLock`: the supplied `expectedRevision`/`ownerToken` did not match the
 *    live holder.
 *  - `emitIpc`: a live message already occupies the key (ipc is write-once).
 *
 * **Security:** the 409 body uses the REDACTED projection — the current holder's
 * `ownerToken` is NEVER exposed to a losing caller (engram-server #933 P1). The
 * server may include the conflicting record under `details.current` with its
 * `ownerToken` already null; re-read or back off and retry. This error is
 * retryable in the application sense (the contended resource may free up), not
 * by the transport — re-issuing the identical request immediately will conflict
 * again until the holder releases or fades.
 */
export class ShimmerCasConflictError extends EngramError {
  constructor(message: string, details?: unknown) {
    super(message, "SHIMMER_CAS_CONFLICT", 409, details);
    this.name = "ShimmerCasConflictError";
    Object.setPrototypeOf(this, ShimmerCasConflictError.prototype);
  }
}

/**
 * Error thrown when the `/v1/shimmers` surface is not enabled on the connected
 * deployment (503 `SHIMMER_DISABLED`).
 *
 * Shimmers are gated behind `ENGRAM_SHIMMER_ENABLED` (default OFF) — the same
 * flag that starts the reaper. When off, every shimmer route answers a typed 503
 * rather than silently no-op'ing (transparent gating). This is a deployment
 * configuration state, not a transient outage: it will not clear on retry until
 * the operator enables the surface, so it is NOT retried by the client.
 */
export class ShimmerDisabledError extends EngramError {
  constructor(message = "Shimmers are not enabled on this deployment (set ENGRAM_SHIMMER_ENABLED=true)") {
    super(message, "SHIMMER_DISABLED", 503);
    this.name = "ShimmerDisabledError";
    Object.setPrototypeOf(this, ShimmerDisabledError.prototype);
  }
}

/**
 * Error thrown when request validation fails (400)
 */
export class ValidationFailedError extends EngramError {
  public readonly issues: Array<{
    code: string;
    message: string;
    path: string[];
  }>;

  constructor(validationError: ValidationError["error"]) {
    const message = validationError.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationFailedError";
    this.issues = validationError.issues;
    Object.setPrototypeOf(this, ValidationFailedError.prototype);
  }
}

/**
 * Error thrown when authentication fails (401)
 */
export class UnauthorizedError extends EngramError {
  constructor(message = "Unauthorized - invalid or missing API key") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends EngramError {
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message, "NETWORK_ERROR");
    this.name = "NetworkError";
    this.originalError = originalError;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends EngramError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, "TIMEOUT");
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Error thrown for internal server errors (500)
 */
export class InternalError extends EngramError {
  constructor(message: string) {
    super(message, "INTERNAL_ERROR", 500);
    this.name = "InternalError";
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Error thrown when a 2xx response body does not match the expected wire shape
 * for the resource that produced it — a truncated, `null`, or wrong-typed
 * field that would otherwise surface as a downstream `TypeError` at the call
 * site (e.g. reading `.data.id` off `{ data: null }`).
 *
 * Carries the failing request `path` and `resource` name so callers and logs
 * can pinpoint which read path drifted. Distinguish this from a `NetworkError`
 * (transport / non-JSON body) and from an `EngramError` carrying a server error
 * `code` (a 4xx/5xx the server reported): a `ResponseShapeError` means the HTTP
 * call SUCCEEDED (2xx, valid JSON) but the JSON structure violated the
 * contract.
 *
 * **Non-retryable / terminal.** A malformed body is a *deterministic* failure
 * — re-issuing the identical request returns the same malformed body — so this
 * error is NOT retried by the client (same rule the non-JSON-2xx fix in #76
 * established). It is terminal for that call; callers recover the way they
 * recover from any thrown SDK error (catch, log, decide). The request layer
 * makes exactly one `fetch` call before throwing it.
 *
 * The `code` is the legacy `"INTERNAL_ERROR"` (no `statusCode`), matching the
 * hand-rolled sync/maintenance guards this generalizes; the distinguishing
 * signal is `instanceof ResponseShapeError` plus the `name`, not the code.
 */
export class ResponseShapeError extends EngramError {
  /** The request path whose response failed validation (e.g. `GET /v1/sync/status`). */
  public readonly path: string;
  /** The resource family that produced the response (e.g. `sync`, `maintenance`). */
  public readonly resource: string;

  constructor(message: string, path: string, resource: string, details?: unknown) {
    super(message, "INTERNAL_ERROR", undefined, details);
    this.name = "ResponseShapeError";
    this.path = path;
    this.resource = resource;
    Object.setPrototypeOf(this, ResponseShapeError.prototype);
  }
}

/**
 * Error thrown when the deprecated, structurally-broken `events.subscribe()`
 * (EventSource) path is invoked without the explicit
 * `{ allowInsecureEventSource: true }` opt-in.
 *
 * The `EventSource` API cannot send custom request headers, so the API key is
 * computed but never transmitted — authentication silently fails (P2: No
 * Silent Degradation). Reaching this path by default is therefore a defect,
 * not a feature, so it is gated behind an explicit acknowledgement. Use
 * {@link import("./resources/events.js").EventsResource.subscribeWithFetch}
 * (callback) or
 * {@link import("./resources/events.js").EventsResource.subscribeIter}
 * (AsyncIterable) instead — both send the `X-API-Key` header correctly.
 *
 * Reserved for removal in 3.0.
 */
export class InsecureEventSourceError extends EngramError {
  constructor() {
    super(
      "events.subscribe() uses the EventSource API, which cannot send the " +
        "X-API-Key header — the API key is silently dropped and authentication " +
        "fails. Use subscribeWithFetch() or subscribeIter() instead, which send " +
        "auth headers correctly. To opt in to the legacy (unauthenticated-only) " +
        "behaviour anyway, pass { allowInsecureEventSource: true }.",
      "VALIDATION_INPUT_INVALID",
    );
    this.name = "InsecureEventSourceError";
    Object.setPrototypeOf(this, InsecureEventSourceError.prototype);
  }
}

/**
 * Error thrown on the `subscribeIter()` iterator when the internal buffer of
 * undelivered events exceeds its high-water mark — i.e. the server is pushing
 * events faster than the `for await` consumer drains them.
 *
 * The overflow is surfaced explicitly rather than silently dropping events
 * (P2: No Silent Degradation). The iterator is terminated; callers that expect
 * bursty streams should either consume faster, raise `highWaterMark`, or fall
 * back to the callback API ({@link import("./resources/events.js").EventsResource.subscribeWithFetch}).
 *
 * This error is terminal for the iterator and non-retryable in place — the
 * subscription is already torn down; re-subscribe to resume.
 */
export class EventStreamOverflowError extends EngramError {
  /** The high-water mark that was exceeded. */
  public readonly highWaterMark: number;

  constructor(highWaterMark: number) {
    super(
      `Event stream overflowed: more than ${highWaterMark} undelivered events ` +
        "buffered while the consumer fell behind. Consume faster, raise " +
        "highWaterMark, or use the callback API (subscribeWithFetch).",
      "OPERATION_QUERY_FAILED",
    );
    this.name = "EventStreamOverflowError";
    this.highWaterMark = highWaterMark;
    Object.setPrototypeOf(this, EventStreamOverflowError.prototype);
  }
}

/**
 * Parse an API error response and throw the appropriate error
 */
export function parseApiError(
  statusCode: number,
  body: ApiError | ValidationError | unknown,
): never {
  // Handle validation errors with { success: false, error: { name: "ZodError", ... } }
  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    body.success === false &&
    "error" in body
  ) {
    const validationBody = body as ValidationError;
    if (validationBody.error.name === "ZodError") {
      throw new ValidationFailedError(validationBody.error);
    }
  }

  // Handle nested error format: { error: { code, message, details? } }
  // This is returned by Hono's zod-validator for query/body validation errors
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "object" &&
    (body as { error: { code?: string } }).error !== null
  ) {
    const nestedError = (body as { error: { code?: string; message?: string; details?: unknown } }).error;
    if (nestedError.code && nestedError.message) {
      // Extract validation details if present
      const details = nestedError.details;
      let message = nestedError.message;
      if (details && typeof details === "object" && "issues" in details) {
        const issues = (details as { issues: Array<{ path: string[]; message: string }> }).issues;
        if (Array.isArray(issues) && issues.length > 0) {
          message = issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        }
      }
      // Route typed shimmer errors before the generic throw so callers can catch
      // them by class. Both arrive in this nested `{ error: { code, ... } }`
      // shape (engram's Hono error envelope).
      if (nestedError.code === "SHIMMER_CAS_CONFLICT") {
        throw new ShimmerCasConflictError(message, nestedError.details);
      }
      if (nestedError.code === "SHIMMER_DISABLED") {
        throw new ShimmerDisabledError(message);
      }
      throw new EngramError(message, nestedError.code as ErrorCode, statusCode, nestedError.details);
    }
  }

  // Handle standard API errors: { code, message }
  if (typeof body === "object" && body !== null && "code" in body && "message" in body) {
    const apiError = body as ApiError;

    // Route CAS mismatch to the typed error before the generic 409 branch,
    // so callers can catch `CrystalVersionConflictError` specifically. The
    // server's 409 body includes `currentVersion` per engram-server#60;
    // older servers that omit it surface as NaN so callers can detect it.
    if (statusCode === 409 && apiError.code === "OPERATION_VERSION_CONFLICT") {
      const raw = (body as Record<string, unknown>).currentVersion;
      const currentVersion = typeof raw === "number" ? raw : NaN;
      throw new CrystalVersionConflictError(apiError.message, currentVersion, body);
    }

    // Typed shimmer errors (also handled in the nested-error branch above for the
    // Hono envelope shape; this covers a bare `{ code, message }` body).
    if (apiError.code === "SHIMMER_CAS_CONFLICT") {
      throw new ShimmerCasConflictError(apiError.message, body);
    }
    if (apiError.code === "SHIMMER_DISABLED") {
      throw new ShimmerDisabledError(apiError.message);
    }

    switch (statusCode) {
      case 401:
        throw new UnauthorizedError(apiError.message);
      case 404:
        throw new NotFoundError(apiError.message);
      case 409:
        throw new SessionExistsError(apiError.message);
      case 500:
        throw new InternalError(apiError.message);
      default:
        throw new EngramError(apiError.message, apiError.code, statusCode);
    }
  }

  // Fallback for unknown error format
  throw new EngramError(
    typeof body === "string" ? body : "Unknown error",
    "INTERNAL_ERROR",
    statusCode,
  );
}
