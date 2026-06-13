/**
 * Token-bucket rate limiter.
 *
 * A bucket holds up to `capacity` tokens and refills at `refillPerSecond`.
 * Acquiring `n` tokens succeeds when at least `n` are available; otherwise it
 * is denied with the time until enough tokens accrue. Refill is computed
 * lazily from the injected {@link Clock} on each operation — there is no
 * background timer and no `Date.now()` in the logic path, so the limiter is
 * fully deterministic under test.
 *
 * Denials are returned as a {@link Result} ({@link RateLimitError}) rather
 * than thrown: being rate-limited is an expected outcome the caller routes on.
 */

import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { Result } from "./result.js";
import { ok, err } from "./result.js";

/** Configuration for a token bucket. */
export interface TokenBucketConfig {
  /** Maximum tokens (burst capacity). Must be > 0. */
  capacity: number;
  /** Tokens added per second. Must be > 0. */
  refillPerSecond: number;
  /** Initial token count (default: `capacity`, a full bucket). */
  initialTokens?: number;
  /** Clock for time injection (default: {@link systemClock}). */
  clock?: Clock;
}

/** Error returned when a token acquisition is denied. */
export interface RateLimitError {
  /** Discriminator. */
  readonly kind: "rate-limited";
  /** Tokens requested. */
  readonly requested: number;
  /** Tokens currently available (fractional). */
  readonly available: number;
  /** Estimated ms until enough tokens accrue to satisfy the request. */
  readonly retryAfterMs: number;
}

/** A clock-injected token-bucket rate limiter. */
export interface TokenBucket {
  /**
   * Try to acquire `tokens` (default 1) without waiting. Returns `ok(remaining)`
   * on success or `err(RateLimitError)` if the bucket is short. Pure w.r.t. the
   * clock — the only state change on success is the token deduction.
   */
  tryAcquire(tokens?: number): Result<number, RateLimitError>;
  /**
   * Acquire `tokens` (default 1), waiting if necessary. Resolves once the
   * tokens are consumed. Uses the injected `sleep` (default `setTimeout`) so
   * the wait can be faked in tests. The wait is computed from the clock, not
   * polled.
   */
  acquire(tokens?: number): Promise<void>;
  /** Current available tokens (fractional), after lazy refill. */
  available(): number;
  /** The configured burst capacity. */
  readonly capacity: number;
  /**
   * Number of times the injected clock was observed moving backwards (a
   * regression) during refill. A non-zero count signals a misconfigured or
   * non-monotonic clock source, which degrades rate-limiting accuracy. Surfaced
   * rather than swallowed so callers can alert on it (observable architecture —
   * no silent degradation). The package takes no logger dependency, so the
   * signal is exposed as state for the caller to observe.
   */
  clockRegressions(): number;
  /** Reset the bucket to full (clears the regression counter too). */
  reset(): void;
}

/** Options for {@link createTokenBucket} (adds the test sleep seam). */
export interface TokenBucketOptions extends TokenBucketConfig {
  /** Sleep implementation for {@link TokenBucket.acquire} (default: `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a {@link TokenBucket}.
 *
 * @example
 * const bucket = createTokenBucket({ capacity: 10, refillPerSecond: 5 });
 * const r = bucket.tryAcquire(3);
 * if (r.ok) { /* 3 tokens consumed, r.value left *\/ }
 * else { /* denied; r.error.retryAfterMs *\/ }
 */
export function createTokenBucket(options: TokenBucketOptions): TokenBucket {
  const {
    capacity,
    refillPerSecond,
    initialTokens,
    clock = systemClock,
    sleep = defaultSleep,
  } = options;

  if (capacity <= 0) {
    throw new RangeError(`createTokenBucket: capacity must be > 0, got ${capacity}`);
  }
  if (refillPerSecond <= 0) {
    throw new RangeError(
      `createTokenBucket: refillPerSecond must be > 0, got ${refillPerSecond}`,
    );
  }
  if (initialTokens !== undefined && (initialTokens < 0 || initialTokens > capacity)) {
    throw new RangeError(
      `createTokenBucket: initialTokens must be in [0, capacity], got ${initialTokens}`,
    );
  }

  let tokens = initialTokens ?? capacity;
  let lastRefillMs = clock();
  let clockRegressionCount = 0;

  /** Lazily add tokens accrued since the last refill, capped at capacity. */
  function refill(): void {
    const nowMs = clock();
    const elapsedMs = nowMs - lastRefillMs;
    if (elapsedMs <= 0) {
      // Clock did not advance (elapsedMs === 0) or went backwards
      // (elapsedMs < 0). Anchor to the new reading without crediting tokens
      // (crediting on a backward jump would over-fill the bucket). A strict
      // regression is recorded so a non-monotonic clock source does not degrade
      // rate limiting silently — the caller can observe clockRegressions().
      if (elapsedMs < 0) clockRegressionCount += 1;
      lastRefillMs = nowMs;
      return;
    }
    const accrued = (elapsedMs / 1000) * refillPerSecond;
    tokens = Math.min(capacity, tokens + accrued);
    lastRefillMs = nowMs;
  }

  function tryAcquire(requested = 1): Result<number, RateLimitError> {
    if (requested <= 0) {
      throw new RangeError(`tryAcquire: tokens must be > 0, got ${requested}`);
    }
    if (requested > capacity) {
      throw new RangeError(
        `tryAcquire: cannot request ${requested} tokens from a bucket of capacity ${capacity}`,
      );
    }
    refill();
    if (tokens >= requested) {
      tokens -= requested;
      return ok(tokens);
    }
    const shortfall = requested - tokens;
    const retryAfterMs = Math.ceil((shortfall / refillPerSecond) * 1000);
    return err({ kind: "rate-limited", requested, available: tokens, retryAfterMs });
  }

  return {
    capacity,
    tryAcquire,
    async acquire(requested = 1): Promise<void> {
      // Loop because the clock may not advance exactly as predicted (e.g. a
      // faked clock the test controls); each pass recomputes the real wait.
      for (;;) {
        const result = tryAcquire(requested);
        if (result.ok) return;
        await sleep(result.error.retryAfterMs);
      }
    },
    available(): number {
      refill();
      return tokens;
    },
    clockRegressions(): number {
      return clockRegressionCount;
    },
    reset(): void {
      tokens = capacity;
      lastRefillMs = clock();
      clockRegressionCount = 0;
    },
  };
}
