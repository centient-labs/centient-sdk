/**
 * Tests for the exported `isRetryableError` classification helper.
 *
 * Mirrors the SDK client's own retry policy: 5xx server errors and raw
 * transport failures are transient (retryable); timeouts, 4xx client errors,
 * and deterministic shape/parse failures are terminal (non-retryable).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createClientBackoff,
  isBrownoutTransientError,
  isRetryableError,
} from "../src/retry.js";
import {
  CrystalVersionConflictError,
  EngramError,
  NetworkError,
  TimeoutError,
  NotFoundError,
  ShimmerDisabledError,
  UnauthorizedError,
  ValidationFailedError,
  InternalError,
  ResponseShapeError,
} from "../src/errors.js";

describe("isRetryableError", () => {
  describe("retryable — transient failures", () => {
    it("retries a 5xx EngramError (InternalError, 500)", () => {
      expect(isRetryableError(new InternalError("boom"))).toBe(true);
    });

    it("retries any EngramError with statusCode >= 500", () => {
      expect(
        isRetryableError(new EngramError("upstream", "INTERNAL_ERROR", 502)),
      ).toBe(true);
      expect(
        isRetryableError(new EngramError("unavailable", "INTERNAL_ERROR", 503)),
      ).toBe(true);
    });

    it("retries a TypeError (fetch network failure shape)", () => {
      // `fetch` surfaces ALL transport failures (DNS, connection refused, TLS,
      // resets) as a bare TypeError, so it MUST stay retryable.
      expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
      expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    });

    it("retries a plain Error (e.g. ECONNREFUSED before the SDK wraps it)", () => {
      const econnrefused = new Error("connect ECONNREFUSED 127.0.0.1:3100");
      expect(isRetryableError(econnrefused)).toBe(true);
    });
  });

  describe("non-retryable — terminal failures", () => {
    it("does not retry a TimeoutError (aborted request)", () => {
      expect(isRetryableError(new TimeoutError(5000))).toBe(false);
    });

    it("does not retry a NetworkError (deterministic non-JSON body / parse failure)", () => {
      expect(
        isRetryableError(new NetworkError("Failed to parse JSON response")),
      ).toBe(false);
    });

    it("does not retry a ResponseShapeError (deterministic malformed 2xx body)", () => {
      expect(
        isRetryableError(
          new ResponseShapeError("bad shape", "/v1/sync/status", "sync"),
        ),
      ).toBe(false);
    });

    it("does not retry 4xx client errors", () => {
      expect(isRetryableError(new NotFoundError("missing"))).toBe(false);
      expect(isRetryableError(new UnauthorizedError())).toBe(false);
      expect(
        isRetryableError(
          new ValidationFailedError({
            name: "ZodError",
            issues: [{ code: "x", message: "bad", path: ["field"] }],
          }),
        ),
      ).toBe(false);
      expect(
        isRetryableError(new EngramError("conflict", "SESSION_EXISTS", 409)),
      ).toBe(false);
    });

    it("does not retry an EngramError with no statusCode", () => {
      expect(
        isRetryableError(new EngramError("opaque", "INTERNAL_ERROR")),
      ).toBe(false);
    });

    it("does not retry programming-error constructors (bugs, not transient)", () => {
      // `fetch` never surfaces network failures through these, so they are
      // unambiguous programming bugs and must not be retried.
      expect(isRetryableError(new ReferenceError("x is not defined"))).toBe(
        false,
      );
      expect(isRetryableError(new SyntaxError("Unexpected token"))).toBe(false);
      expect(isRetryableError(new RangeError("out of range"))).toBe(false);
      expect(isRetryableError(new EvalError("eval bug"))).toBe(false);
    });

    it("does not retry non-Error throwables", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError("a string")).toBe(false);
      expect(isRetryableError({ message: "duck" })).toBe(false);
      expect(isRetryableError(500)).toBe(false);
    });
  });
});

/**
 * The opt-in brownout taxonomy from issue #116 §2 / #173. Every assertion here
 * that DIFFERS from `isRetryableError` above is the point of the predicate —
 * the two disagree on exactly two classes (timeouts, unknown errors), and the
 * final contrast block pins that.
 */
describe("isBrownoutTransientError", () => {
  describe("retryable — brownout transients", () => {
    it("retries a TimeoutError (the #1 brownout transient — the default does NOT)", () => {
      expect(isBrownoutTransientError(new TimeoutError(30_000))).toBe(true);
      expect(isRetryableError(new TimeoutError(30_000))).toBe(false);
    });

    it("retries a foreign AbortError / TimeoutError by name", () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      expect(isBrownoutTransientError(abort)).toBe(true);

      const timeout = new Error("timed out");
      timeout.name = "TimeoutError";
      expect(isBrownoutTransientError(timeout)).toBe(true);
    });

    it("retries 5xx server errors", () => {
      expect(isBrownoutTransientError(new InternalError("boom"))).toBe(true);
      expect(
        isBrownoutTransientError(new EngramError("upstream", "INTERNAL_ERROR", 502)),
      ).toBe(true);
    });

    it("retries a bare fetch TypeError (every transport failure arrives as one)", () => {
      expect(isBrownoutTransientError(new TypeError("fetch failed"))).toBe(true);
    });

    it("retries a transport code, on the error and on its cause", () => {
      const direct = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
      expect(isBrownoutTransientError(direct)).toBe(true);

      // Node's fetch buries the real code on `cause` under a bare TypeError.
      const nested = new TypeError("fetch failed");
      (nested as { cause?: unknown }).cause = { code: "ECONNRESET" };
      expect(isBrownoutTransientError(nested)).toBe(true);

      // …and a non-TypeError carrier is classified by the cause alone.
      const wrapped = new Error("request failed");
      (wrapped as { cause?: unknown }).cause = { code: "ETIMEDOUT" };
      expect(isBrownoutTransientError(wrapped)).toBe(true);
    });

    it("retries a NetworkError that wraps a transport failure", () => {
      expect(
        isBrownoutTransientError(
          new NetworkError("Failed to GET /v1/health: fetch failed", new TypeError("fetch failed")),
        ),
      ).toBe(true);
    });
  });

  describe("non-retryable — deterministic or unclassifiable failures", () => {
    it("does NOT retry an unknown/generic Error (the default DOES)", () => {
      // The conservative half of the flip: an unclassifiable failure may be a
      // non-idempotent partial success, and replaying it duplicates a write.
      expect(isBrownoutTransientError(new Error("something went wrong"))).toBe(false);
      expect(isRetryableError(new Error("something went wrong"))).toBe(true);
    });

    it("does not retry a NetworkError with no originalError (deterministic body failure)", () => {
      expect(
        isBrownoutTransientError(
          new NetworkError("Failed to parse JSON response from GET /v1/x: <html>"),
        ),
      ).toBe(false);
    });

    it("does not retry a ResponseShapeError (deterministic malformed 2xx body)", () => {
      expect(
        isBrownoutTransientError(
          new ResponseShapeError("bad shape", "/v1/sync/status", "sync"),
        ),
      ).toBe(false);
    });

    it("does not retry 4xx client errors, including a 409 CAS conflict", () => {
      expect(isBrownoutTransientError(new NotFoundError("nope"))).toBe(false);
      expect(isBrownoutTransientError(new UnauthorizedError())).toBe(false);
      expect(
        isBrownoutTransientError(
          new ValidationFailedError({
            name: "ZodError",
            issues: [{ code: "x", message: "bad", path: ["field"] }],
          }),
        ),
      ).toBe(false);
      expect(
        isBrownoutTransientError(new CrystalVersionConflictError("stale", 7)),
      ).toBe(false);
    });

    it("honours the EngramError.retryable opt-out on a permanent 5xx gate", () => {
      // SHIMMER_DISABLED is a 503 that never clears on retry (Codex #112 P2).
      expect(isBrownoutTransientError(new ShimmerDisabledError())).toBe(false);
    });

    it("does not retry programming-error constructors", () => {
      expect(isBrownoutTransientError(new ReferenceError("x is not defined"))).toBe(false);
      expect(isBrownoutTransientError(new SyntaxError("Unexpected token"))).toBe(false);
      expect(isBrownoutTransientError(new RangeError("out of range"))).toBe(false);
      expect(isBrownoutTransientError(new EvalError("eval"))).toBe(false);
    });

    it("does not retry non-Error throwables", () => {
      expect(isBrownoutTransientError(null)).toBe(false);
      expect(isBrownoutTransientError(undefined)).toBe(false);
      expect(isBrownoutTransientError("a string")).toBe(false);
      expect(isBrownoutTransientError({ message: "duck" })).toBe(false);
      expect(isBrownoutTransientError(500)).toBe(false);
    });
  });

  it("differs from the default on exactly the two classes issue #116 names", () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["5xx", new InternalError("boom")],
      ["4xx", new NotFoundError("nope")],
      ["shape", new ResponseShapeError("bad shape", "/v1/sync/status", "sync")],
      ["fetch TypeError", new TypeError("fetch failed")],
      ["programming error", new SyntaxError("Unexpected token")],
      ["non-Error", "a string"],
      // The two that flip:
      ["timeout", new TimeoutError(30_000)],
      ["unknown Error", new Error("???")],
    ];

    const disagreements = cases
      .filter(([, err]) => isRetryableError(err) !== isBrownoutTransientError(err))
      .map(([label]) => label);

    expect(disagreements).toEqual(["timeout", "unknown Error"]);
  });
});

describe("createClientBackoff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reproduces the historical linear schedule with no jitter (random = 0)", () => {
    // With Math.random() pinned to 0, jitter is 0 so delayFor(attempt) is the
    // exact historical base: attempt * retryDelay.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const retryDelayMs = 1000;
    const backoff = createClientBackoff(retryDelayMs);

    expect(backoff.delayFor(1)).toBe(1000);
    expect(backoff.delayFor(2)).toBe(2000);
    expect(backoff.delayFor(3)).toBe(3000);
  });

  it("adds jitter in [0, 0.5 * retryDelay) using the 0.5 jitter ratio", () => {
    // Math.random() just below 1 yields the largest jitter the schedule
    // permits: base + r * (0.5 * retryDelay), r -> ~1.
    const r = 0.999999;
    vi.spyOn(Math, "random").mockReturnValue(r);
    const retryDelayMs = 1000;
    const backoff = createClientBackoff(retryDelayMs);

    // jitter span is 0.5 * 1000 = 500; for attempt N the value is
    // N*1000 + r*500, strictly within [N*1000, N*1000 + 500).
    expect(backoff.delayFor(1)).toBeCloseTo(1000 + r * 500, 6);
    expect(backoff.delayFor(1)).toBeGreaterThanOrEqual(1000);
    expect(backoff.delayFor(1)).toBeLessThan(1500);
    expect(backoff.delayFor(2)).toBeGreaterThanOrEqual(2000);
    expect(backoff.delayFor(2)).toBeLessThan(2500);
  });

  it("scales the base and jitter span with retryDelayMs", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const backoff = createClientBackoff(200);
    // attempt 1: 200 + 0.5 * (0.5 * 200) = 200 + 50 = 250
    expect(backoff.delayFor(1)).toBeCloseTo(250, 6);
  });
});
