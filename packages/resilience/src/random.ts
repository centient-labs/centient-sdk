/**
 * Randomness injection — the single source of jitter entropy.
 *
 * Backoff jitter needs randomness, but the observable-architecture principle
 * forbids reading `Math.random()` from a logic path where it cannot be
 * controlled in a test. So jitter takes a {@link RandomSource}: a
 * zero-argument function returning a float in `[0, 1)`, exactly like
 * `Math.random`. Production passes {@link systemRandom}; tests pass a fixed or
 * sequenced source to pin the output.
 */

/** A source of uniform randomness in `[0, 1)` (same contract as `Math.random`). */
export type RandomSource = () => number;

/**
 * The default production randomness source. This is the ONLY place in the
 * package that calls `Math.random()`, isolating it to a single injectable
 * seam so jitter stays deterministic under test.
 */
export const systemRandom: RandomSource = () => Math.random();

/**
 * A {@link RandomSource} that always returns the same value. Useful in tests
 * to pin jitter to a known fraction of its range.
 *
 * @param value - A float in `[0, 1)`. Throws if out of range.
 */
export function fixedRandom(value: number): RandomSource {
  if (value < 0 || value >= 1) {
    throw new RangeError(`fixedRandom: value must be in [0, 1), got ${value}`);
  }
  return () => value;
}

/**
 * A {@link RandomSource} that yields a fixed sequence, cycling once exhausted.
 * Useful for property-style tests that probe several points of the jitter
 * range deterministically.
 *
 * @param values - One or more floats in `[0, 1)`.
 */
export function sequenceRandom(values: readonly number[]): RandomSource {
  if (values.length === 0) {
    throw new RangeError("sequenceRandom: values must be non-empty");
  }
  for (const v of values) {
    if (v < 0 || v >= 1) {
      throw new RangeError(`sequenceRandom: every value must be in [0, 1), got ${v}`);
    }
  }
  let index = 0;
  return () => {
    const v = values[index % values.length] as number;
    index += 1;
    return v;
  };
}
