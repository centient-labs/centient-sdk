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
 * ## Jitter models
 *
 * Two jitter models are available, selected by `jitter`:
 *
 * - `"additive"` (default, unchanged): `delay = base + random() * jitterSpan`,
 *   where `jitterSpan = jitterRatio * baseDelayMs`. The schedule value is a
 *   **floor** — the delay is never below `base`.
 * - `"full"`: `delay = random() * base` — uniform in `[0, base)` with **no
 *   floor**, so a delay CAN be 0. This is the AWS "Exponential Backoff And
 *   Jitter" *full* variant. It exists because a non-zero floor re-clusters a
 *   retrying fleet: when N workers all back off against the same degraded
 *   upstream, uniform-from-zero spreads them maximally, while a floor
 *   reconstitutes the thundering herd that caused the brownout. In `"full"`
 *   mode the schedule value is a **cap**, not a floor.
 *
 * ## Cumulative budget
 *
 * A retry chain's worst case is not one delay but the sum of them. Callers on
 * a tick budget (a poller that must finish well inside its interval) can
 * declare `attempts` + `maxTotalDelayMs`; the factory then validates the exact
 * worst-case cumulative sleep, `sum(maxFor(1..attempts-1))`, at construction
 * and throws if the schedule cannot fit. {@link Backoff.totalMaxFor} exposes
 * the same number for callers who want to check it themselves.
 *
 * Randomness is injected via {@link RandomSource} so the jittered output is
 * deterministic under test (no `Math.random()` in this logic path).
 */

import type { RandomSource } from "./random.js";
import { systemRandom } from "./random.js";

/** Backoff growth strategy. */
export type BackoffStrategy = "linear" | "exponential";

/**
 * Jitter model.
 *
 * - `"additive"` — `base + random() * jitterRatio * baseDelayMs`. The schedule
 *   value is a floor; the delay is always >= it. (Default; sdk-compatible.)
 * - `"full"` — `random() * base`, uniform `[0, base)`, no floor, can be 0. The
 *   schedule value is a cap. `jitterRatio` does not apply.
 */
export type BackoffJitter = "additive" | "full";

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
   * Jitter model (default: `"additive"`). Set to `"full"` for the no-floor,
   * uniform-`[0, base)` variant. See {@link BackoffJitter}.
   */
  jitter?: BackoffJitter;
  /**
   * Jitter as a fraction of `baseDelayMs`. The jitter added is a uniform
   * random value in `[0, jitterRatio * baseDelayMs)`. Default: 0.5 (the sdk
   * value). Set to 0 to disable jitter.
   *
   * Only meaningful for `jitter: "additive"` — full jitter derives its span
   * from the schedule value itself. Passing it alongside `jitter: "full"`
   * throws rather than being silently ignored.
   */
  jitterRatio?: number;
  /**
   * Total attempts (1 initial + `attempts - 1` retries) this schedule is
   * budgeted for. Only used to validate `maxTotalDelayMs` at construction —
   * the schedule itself is unbounded in `attempt`. Must be an integer >= 1.
   *
   * When set, {@link Backoff.budgetedAttempts} reports it, and `withRetry`
   * refuses to run more attempts than the schedule was budgeted for.
   */
  attempts?: number;
  /**
   * Upper bound, in ms, on the worst-case CUMULATIVE sleep across the whole
   * retry chain: `sum(maxFor(1..attempts-1))`. Requires `attempts`. Throws at
   * construction if the schedule cannot fit the budget — a schedule that
   * blows a tick budget is a programmer error, not a runtime outcome.
   */
  maxTotalDelayMs?: number;
  /** Randomness source for jitter (default: {@link systemRandom}). */
  random?: RandomSource;
}

/** A resolved backoff schedule. */
export interface Backoff {
  /**
   * Compute the sleep duration before retry `attempt` (1-based).
   *
   * - `additive` jitter: the strategy base (capped at `maxDelayMs` if set)
   *   plus jitter in `[0, jitterRatio * baseDelayMs)`.
   * - `full` jitter: uniform in `[0, baseFor(attempt))` — no floor, may be 0.
   *
   * The value is a float; callers wanting whole milliseconds should floor it.
   *
   * Throws {@link RangeError} if `attempt < 1`.
   */
  delayFor(attempt: number): number;
  /**
   * The schedule value for `attempt`, capped at `maxDelayMs`: the delay FLOOR
   * under `additive` jitter, the delay CAP under `full` jitter.
   */
  baseFor(attempt: number): number;
  /**
   * The exclusive upper bound on `delayFor(attempt)`: `base + jitterSpan` for
   * `additive`, `base` itself for `full`.
   */
  maxFor(attempt: number): number;
  /**
   * The worst-case CUMULATIVE sleep across a retry chain of `attempts` total
   * attempts — `sum(maxFor(1..attempts-1))`, since `attempts` attempts sleep
   * `attempts - 1` times. Returns 0 for `attempts === 1` (no retry, no sleep).
   *
   * This is the exact envelope, not the coarse `(attempts - 1) * maxDelayMs`
   * bound, which over-counts every attempt whose base has not yet reached the
   * cap.
   *
   * Throws {@link RangeError} if `attempts` is not an integer >= 1.
   */
  totalMaxFor(attempts: number): number;
  /**
   * The `attempts` this schedule was budgeted for, or `undefined` if no
   * budget was declared. `withRetry` honours it as a ceiling.
   */
  readonly budgetedAttempts: number | undefined;
}

const DEFAULT_STRATEGY: BackoffStrategy = "linear";
const DEFAULT_FACTOR = 2;
const DEFAULT_JITTER: BackoffJitter = "additive";
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
 *
 * @example Full jitter on a cumulative budget
 * const b = createBackoff({
 *   baseDelayMs: 500, strategy: "exponential", factor: 2, maxDelayMs: 5000,
 *   jitter: "full", attempts: 3, maxTotalDelayMs: 15_000,
 * });
 * b.delayFor(1);      // ∈ [0, 500)  — can be 0
 * b.totalMaxFor(3);   // 1500 (500 + 1000)
 */
export function createBackoff(config: BackoffConfig): Backoff {
  const {
    baseDelayMs,
    strategy = DEFAULT_STRATEGY,
    factor = DEFAULT_FACTOR,
    maxDelayMs,
    jitter = DEFAULT_JITTER,
    jitterRatio = DEFAULT_JITTER_RATIO,
    attempts,
    maxTotalDelayMs,
    random = systemRandom,
  } = config;

  if (baseDelayMs < 0) {
    throw new RangeError(`createBackoff: baseDelayMs must be >= 0, got ${baseDelayMs}`);
  }
  if (factor <= 0) {
    throw new RangeError(`createBackoff: factor must be > 0, got ${factor}`);
  }
  // The mode is selected by an equality test against "full", so an unrecognised
  // value would fall through to additive — silently giving a caller who asked
  // for full jitter the very floor they were trying to remove. TypeScript stops
  // this at compile time; a JS caller or a parsed config file does not go
  // through TypeScript. Checked BEFORE the jitterRatio pairing rule below so a
  // typo reports the typo rather than a confusing secondary error.
  if (jitter !== "additive" && jitter !== "full") {
    throw new RangeError(
      `createBackoff: jitter must be "additive" or "full", got ${JSON.stringify(jitter)}`,
    );
  }
  if (jitterRatio < 0) {
    throw new RangeError(`createBackoff: jitterRatio must be >= 0, got ${jitterRatio}`);
  }
  if (maxDelayMs !== undefined && maxDelayMs < 0) {
    throw new RangeError(`createBackoff: maxDelayMs must be >= 0, got ${maxDelayMs}`);
  }
  // Full jitter derives its span from the schedule value, so a jitterRatio
  // cannot be honoured. Refuse rather than silently ignore the caller's
  // stated intent (P2: no silent degradation).
  if (jitter === "full" && config.jitterRatio !== undefined) {
    throw new RangeError(
      "createBackoff: jitterRatio does not apply to jitter: \"full\" " +
        "(full jitter is uniform in [0, base)); remove one of the two",
    );
  }
  if (attempts !== undefined && (!Number.isInteger(attempts) || attempts < 1)) {
    throw new RangeError(`createBackoff: attempts must be an integer >= 1, got ${attempts}`);
  }
  if (maxTotalDelayMs !== undefined) {
    if (maxTotalDelayMs < 0) {
      throw new RangeError(
        `createBackoff: maxTotalDelayMs must be >= 0, got ${maxTotalDelayMs}`,
      );
    }
    if (attempts === undefined) {
      throw new RangeError(
        "createBackoff: maxTotalDelayMs requires attempts (the chain length the budget covers)",
      );
    }
  }

  const jitterSpan = jitter === "full" ? 0 : jitterRatio * baseDelayMs;

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

  function maxFor(attempt: number): number {
    const base = baseFor(attempt);
    return jitter === "full" ? base : base + jitterSpan;
  }

  function totalMaxFor(chainAttempts: number): number {
    if (!Number.isInteger(chainAttempts) || chainAttempts < 1) {
      throw new RangeError(
        `Backoff: totalMaxFor attempts must be an integer >= 1, got ${chainAttempts}`,
      );
    }
    let total = 0;
    for (let n = 1; n <= chainAttempts - 1; n++) {
      total += maxFor(n);
    }
    return total;
  }

  if (maxTotalDelayMs !== undefined && attempts !== undefined) {
    const worstCase = totalMaxFor(attempts);
    if (worstCase > maxTotalDelayMs) {
      throw new RangeError(
        `createBackoff: worst-case cumulative backoff for ${attempts} attempts is ` +
          `${worstCase}ms, which exceeds maxTotalDelayMs ${maxTotalDelayMs}ms`,
      );
    }
  }

  return {
    baseFor,
    maxFor,
    totalMaxFor,
    budgetedAttempts: attempts,
    delayFor(attempt: number): number {
      const base = baseFor(attempt);
      // Full jitter: uniform [0, base), no floor — a delay of 0 is a valid,
      // intentional outcome (maximal de-correlation across a retrying fleet).
      return jitter === "full" ? random() * base : base + random() * jitterSpan;
    },
  };
}
