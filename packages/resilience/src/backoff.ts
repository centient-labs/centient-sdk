/**
 * Backoff with jitter.
 *
 * The `linear` strategy reproduces the @centient/sdk client's retry schedule
 * exactly — base `attempt * baseDelayMs` plus a random jitter in
 * `[0, jitterRatio * baseDelayMs)` (sdk uses jitterRatio = 0.5) — so the sdk
 * can later adopt this as a drop-in replacement for its private
 * `backoffDelay`. The `exponential` strategy is the standard
 * `baseDelayMs * factor^(attempt-1)` schedule, capped at `maxDelayMs`, with
 * the same additive jitter model.
 *
 * Randomness is injected via {@link RandomSource} so the jittered output is
 * deterministic under test (no `Math.random()` in this logic path).
 */

import type { RandomSource } from "./random.js";
import { systemRandom } from "./random.js";

/** Backoff growth strategy. */
export type BackoffStrategy = "linear" | "exponential";

/** Configuration for a backoff schedule. */
export interface BackoffConfig {
  /**
   * Base delay in ms. For `linear`, attempt `n` has base `n * baseDelayMs`.
   * For `exponential`, attempt `n` has base `baseDelayMs * factor^(n-1)`.
   */
  baseDelayMs: number;
  /** Growth strategy (default: `"linear"`, matching the sdk). */
  strategy?: BackoffStrategy;
  /** Multiplier for `exponential` growth (default: 2). Ignored for `linear`. */
  factor?: number;
  /** Upper bound on the (pre-jitter) base delay, in ms. Default: no cap. */
  maxDelayMs?: number;
  /**
   * Jitter as a fraction of `baseDelayMs`. The jitter added is a uniform
   * random value in `[0, jitterRatio * baseDelayMs)`. Default: 0.5 (the sdk
   * value). Set to 0 to disable jitter.
   */
  jitterRatio?: number;
  /** Randomness source for jitter (default: {@link systemRandom}). */
  random?: RandomSource;
}

/** A resolved backoff schedule. */
export interface Backoff {
  /**
   * Compute the sleep duration before retry `attempt` (1-based): the strategy
   * base (capped at `maxDelayMs` if set) plus jitter in
   * `[0, jitterRatio * baseDelayMs)`.
   *
   * Throws {@link RangeError} if `attempt < 1`.
   */
  delayFor(attempt: number): number;
  /** The (pre-jitter) base delay for `attempt`, capped at `maxDelayMs`. */
  baseFor(attempt: number): number;
  /** The maximum possible delay for `attempt` (base + full jitter span). */
  maxFor(attempt: number): number;
}

const DEFAULT_STRATEGY: BackoffStrategy = "linear";
const DEFAULT_FACTOR = 2;
const DEFAULT_JITTER_RATIO = 0.5;

/**
 * Create a {@link Backoff} schedule.
 *
 * @example Linear, sdk-compatible (base = attempt * 1000, jitter ⊂ [0, 500))
 * const b = createBackoff({ baseDelayMs: 1000 });
 * b.delayFor(1); // ∈ [1000, 1500)
 * b.delayFor(2); // ∈ [2000, 2500)
 *
 * @example Exponential with cap
 * const b = createBackoff({
 *   baseDelayMs: 100, strategy: "exponential", factor: 2, maxDelayMs: 1000,
 * });
 * b.baseFor(1); // 100
 * b.baseFor(5); // 1000 (1600 capped)
 */
export function createBackoff(config: BackoffConfig): Backoff {
  const {
    baseDelayMs,
    strategy = DEFAULT_STRATEGY,
    factor = DEFAULT_FACTOR,
    maxDelayMs,
    jitterRatio = DEFAULT_JITTER_RATIO,
    random = systemRandom,
  } = config;

  if (baseDelayMs < 0) {
    throw new RangeError(`createBackoff: baseDelayMs must be >= 0, got ${baseDelayMs}`);
  }
  if (factor <= 0) {
    throw new RangeError(`createBackoff: factor must be > 0, got ${factor}`);
  }
  if (jitterRatio < 0) {
    throw new RangeError(`createBackoff: jitterRatio must be >= 0, got ${jitterRatio}`);
  }
  if (maxDelayMs !== undefined && maxDelayMs < 0) {
    throw new RangeError(`createBackoff: maxDelayMs must be >= 0, got ${maxDelayMs}`);
  }

  const jitterSpan = jitterRatio * baseDelayMs;

  function baseFor(attempt: number): number {
    if (attempt < 1) {
      throw new RangeError(`Backoff: attempt must be >= 1, got ${attempt}`);
    }
    const raw =
      strategy === "linear"
        ? baseDelayMs * attempt
        : baseDelayMs * Math.pow(factor, attempt - 1);
    return maxDelayMs === undefined ? raw : Math.min(raw, maxDelayMs);
  }

  return {
    baseFor,
    delayFor(attempt: number): number {
      return baseFor(attempt) + random() * jitterSpan;
    },
    maxFor(attempt: number): number {
      return baseFor(attempt) + jitterSpan;
    },
  };
}
