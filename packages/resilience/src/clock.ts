/**
 * Clock injection — the single source of "now" for every primitive in this
 * package.
 *
 * Per the observable-architecture principle, no logic path in this package
 * reads `Date.now()` directly. Every primitive that needs the current time
 * takes a {@link Clock}: a zero-argument function returning epoch
 * milliseconds. Production code passes {@link systemClock}; tests pass a
 * {@link createManualClock} they advance by hand, which makes every
 * time-dependent behaviour deterministic.
 */

/**
 * A source of the current time, in epoch milliseconds.
 *
 * Returning a number (rather than a `Date`) keeps arithmetic cheap and
 * allocation-free on the hot paths (token refill, TTL checks, backoff).
 */
export type Clock = () => number;

/**
 * The default production clock. This is the ONLY place in the package that
 * reads the wall clock, so the "no `Date.now()` in logic paths" rule is
 * enforced by isolating the call to a single, injectable seam.
 */
export const systemClock: Clock = () => Date.now();

/** A manually-advanced clock, for deterministic tests. */
export interface ManualClock {
  /** The {@link Clock} function to inject into a primitive. */
  readonly clock: Clock;
  /** Advance the clock by `ms` milliseconds. */
  advance(ms: number): void;
  /** Set the clock to an absolute epoch-millisecond value. */
  set(epochMs: number): void;
  /** Read the current value without advancing. */
  now(): number;
}

/**
 * Create a {@link ManualClock} starting at `startMs` (default 0).
 *
 * @example
 * const t = createManualClock(1_000);
 * const limiter = createTokenBucket({ capacity: 10, refillPerSecond: 1, clock: t.clock });
 * t.advance(5_000); // 5 seconds pass — 5 tokens refill
 */
export function createManualClock(startMs = 0): ManualClock {
  let current = startMs;
  return {
    clock: () => current,
    advance(ms: number): void {
      if (ms < 0) {
        throw new RangeError(`createManualClock: cannot advance by negative ms (${ms})`);
      }
      current += ms;
    },
    set(epochMs: number): void {
      current = epochMs;
    },
    now(): number {
      return current;
    },
  };
}
