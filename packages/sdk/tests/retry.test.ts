/**
 * Tests for the exported `isRetryableError` classification helper.
 *
 * Mirrors the SDK client's own retry policy: 5xx server errors and raw
 * transport failures are transient (retryable); timeouts, 4xx client errors,
 * and deterministic shape/parse failures are terminal (non-retryable).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createClientBackoff, isRetryableError } from "../src/retry.js";
import {
  EngramError,
  NetworkError,
  TimeoutError,
  NotFoundError,
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

    it("retries a raw transport Error (not yet wrapped by the SDK)", () => {
      // e.g. a fetch TypeError or an ECONNREFUSED before the client wraps it.
      expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
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

    it("does not retry non-Error throwables", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError("a string")).toBe(false);
      expect(isRetryableError({ message: "duck" })).toBe(false);
      expect(isRetryableError(500)).toBe(false);
    });
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
