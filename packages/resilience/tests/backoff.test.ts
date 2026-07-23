/**
 * Backoff tests — property-style bounds (every sampled delay stays within
 * [base, base + jitterSpan)) and sdk-parity (linear base + jitter ⊂
 * [0, 0.5 * baseDelayMs)), mirroring the @centient/sdk client's jitter tests.
 */

import { describe, it, expect } from "vitest";
import { createBackoff } from "../src/backoff.js";
import { fixedRandom, sequenceRandom, systemRandom } from "../src/random.js";

describe("createBackoff — linear (sdk-compatible)", () => {
  const BASE = 1_000;

  it("returns base + random * 0.5 * baseDelay with a pinned random source", () => {
    for (const attempt of [1, 2, 3, 5]) {
      const base = BASE * attempt;

      // random = 0 -> exactly the linear base (budget unchanged)
      expect(createBackoff({ baseDelayMs: BASE, random: fixedRandom(0) }).delayFor(attempt)).toBe(base);

      // random = 0.5 -> base + 0.25 * baseDelay
      expect(
        createBackoff({ baseDelayMs: BASE, random: fixedRandom(0.5) }).delayFor(attempt),
      ).toBe(base + 0.5 * BASE * 0.5);

      // random -> ~1 stays strictly under base + 0.5 * baseDelay
      const nearMax = createBackoff({
        baseDelayMs: BASE,
        random: fixedRandom(0.999999),
      }).delayFor(attempt);
      expect(nearMax).toBeLessThan(base + 0.5 * BASE);
      expect(nearMax).toBeCloseTo(base + 0.999999 * 0.5 * BASE, 6);
    }
  });

  it("property: stays within [base, base + 0.5 * baseDelay) under real randomness", () => {
    const backoff = createBackoff({ baseDelayMs: BASE, random: systemRandom });
    for (const attempt of [1, 2, 3, 10]) {
      const base = BASE * attempt;
      for (let i = 0; i < 200; i++) {
        const delay = backoff.delayFor(attempt);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThan(base + 0.5 * BASE);
      }
    }
  });

  it("disables jitter when jitterRatio is 0", () => {
    const backoff = createBackoff({ baseDelayMs: BASE, jitterRatio: 0, random: fixedRandom(0.9) });
    expect(backoff.delayFor(1)).toBe(BASE);
    expect(backoff.delayFor(4)).toBe(BASE * 4);
  });

  it("baseFor and maxFor describe the jitter envelope", () => {
    const backoff = createBackoff({ baseDelayMs: BASE });
    expect(backoff.baseFor(3)).toBe(3_000);
    expect(backoff.maxFor(3)).toBe(3_000 + 0.5 * BASE);
  });

  it("jitterRatio = 1.0 spans the full [base, base + baseDelay) envelope", () => {
    // jitterRatio = 1.0 is the maximum sensible value: jitter ⊂ [0, baseDelay),
    // so a delay can approach but never reach 2 * baseDelay at attempt 1.
    const at0 = createBackoff({ baseDelayMs: BASE, jitterRatio: 1, random: fixedRandom(0) });
    const atMax = createBackoff({ baseDelayMs: BASE, jitterRatio: 1, random: fixedRandom(0.999999) });
    for (const attempt of [1, 2, 5]) {
      const base = BASE * attempt;
      expect(at0.delayFor(attempt)).toBe(base); // random 0 -> exactly base
      const near = atMax.delayFor(attempt);
      expect(near).toBeLessThan(base + BASE); // strictly under base + full span
      expect(near).toBeCloseTo(base + 0.999999 * BASE, 6);
    }
    // The advertised envelope reflects the full jitter span at ratio 1.0.
    expect(createBackoff({ baseDelayMs: BASE, jitterRatio: 1 }).maxFor(1)).toBe(BASE + BASE);
  });

  it("jitterRatio just below 1.0 stays within its envelope under real randomness", () => {
    const ratio = 0.999;
    const backoff = createBackoff({ baseDelayMs: BASE, jitterRatio: ratio, random: systemRandom });
    for (const attempt of [1, 3, 7]) {
      const base = BASE * attempt;
      for (let i = 0; i < 200; i++) {
        const delay = backoff.delayFor(attempt);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThan(base + ratio * BASE);
      }
    }
  });

  it("accepts jitterRatio above 1.0 (no upper bound on the ratio)", () => {
    // Only a negative ratio is rejected; ratios >= 1 are valid (wider jitter).
    const backoff = createBackoff({ baseDelayMs: BASE, jitterRatio: 2, random: fixedRandom(0.5) });
    expect(backoff.delayFor(1)).toBe(BASE + 0.5 * 2 * BASE);
    expect(backoff.maxFor(1)).toBe(BASE + 2 * BASE);
  });
});

describe("createBackoff — exponential", () => {
  it("grows by factor^(attempt-1) and caps at maxDelayMs", () => {
    const backoff = createBackoff({
      baseDelayMs: 100,
      strategy: "exponential",
      factor: 2,
      maxDelayMs: 1_000,
      jitterRatio: 0,
    });
    expect(backoff.baseFor(1)).toBe(100);
    expect(backoff.baseFor(2)).toBe(200);
    expect(backoff.baseFor(3)).toBe(400);
    expect(backoff.baseFor(4)).toBe(800);
    expect(backoff.baseFor(5)).toBe(1_000); // 1600 capped
    expect(backoff.baseFor(6)).toBe(1_000);
  });

  it("property: exponential delay stays within the jitter envelope", () => {
    const backoff = createBackoff({
      baseDelayMs: 50,
      strategy: "exponential",
      factor: 3,
      maxDelayMs: 5_000,
      jitterRatio: 0.5,
      random: sequenceRandom([0, 0.25, 0.5, 0.75, 0.999]),
    });
    const jitterSpan = 0.5 * 50;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const base = backoff.baseFor(attempt);
      for (let i = 0; i < 5; i++) {
        const delay = backoff.delayFor(attempt);
        expect(delay).toBeGreaterThanOrEqual(base);
        expect(delay).toBeLessThan(base + jitterSpan);
      }
    }
  });
});

describe("createBackoff — full jitter (no floor)", () => {
  const BASE = 500;

  /** The mbot/AWS full-jitter shape: exponential cap, uniform [0, cap). */
  function fullJitter(random?: ReturnType<typeof fixedRandom>) {
    return createBackoff({
      baseDelayMs: BASE,
      strategy: "exponential",
      factor: 2,
      maxDelayMs: 5_000,
      jitter: "full",
      ...(random ? { random } : {}),
    });
  }

  it("returns exactly 0 when the random source yields 0 (no non-zero floor)", () => {
    const backoff = fullJitter(fixedRandom(0));
    for (const attempt of [1, 2, 3, 8]) {
      expect(backoff.delayFor(attempt)).toBe(0);
    }
  });

  it("computes random() * min(maxDelayMs, base * 2^(attempt-1))", () => {
    const backoff = fullJitter(fixedRandom(0.5));
    expect(backoff.delayFor(1)).toBe(0.5 * 500); // cap 500
    expect(backoff.delayFor(2)).toBe(0.5 * 1_000); // cap 1000
    expect(backoff.delayFor(3)).toBe(0.5 * 2_000); // cap 2000
    expect(backoff.delayFor(5)).toBe(0.5 * 5_000); // 8000 capped to 5000
  });

  it("property: never reaches the cap and never goes below 0, under real randomness", () => {
    const backoff = fullJitter();
    for (const attempt of [1, 2, 3, 4, 10]) {
      const cap = backoff.baseFor(attempt);
      for (let i = 0; i < 500; i++) {
        const delay = backoff.delayFor(attempt);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(cap);
      }
    }
  });

  it("samples the whole [0, cap) range rather than clustering above a floor", () => {
    // A pinned sequence proves the mapping is the identity on [0,1) scaled by
    // the cap — the lowest sample lands well under the additive model's floor.
    const backoff = createBackoff({
      baseDelayMs: BASE,
      strategy: "exponential",
      jitter: "full",
      random: sequenceRandom([0, 0.001, 0.25, 0.75, 0.999]),
    });
    expect([0, 1, 2, 3, 4].map(() => backoff.delayFor(1))).toEqual([
      0, 0.5, 125, 375, 499.5,
    ]);
  });

  it("baseFor is the cap and maxFor equals it (the exclusive upper bound)", () => {
    const backoff = fullJitter();
    for (const attempt of [1, 2, 6]) {
      expect(backoff.maxFor(attempt)).toBe(backoff.baseFor(attempt));
    }
    expect(backoff.baseFor(1)).toBe(500);
    expect(backoff.baseFor(6)).toBe(5_000); // 16000 capped
  });

  it("works with the linear strategy too (cap = attempt * baseDelayMs)", () => {
    const backoff = createBackoff({
      baseDelayMs: 1_000,
      jitter: "full",
      random: fixedRandom(0.5),
    });
    expect(backoff.delayFor(1)).toBe(500);
    expect(backoff.delayFor(3)).toBe(1_500);
  });

  it("rejects jitterRatio alongside jitter: \"full\" instead of ignoring it", () => {
    expect(() =>
      createBackoff({ baseDelayMs: BASE, jitter: "full", jitterRatio: 0.5 }),
    ).toThrow(RangeError);
    // ...including the explicit-but-equal-to-default case.
    expect(() =>
      createBackoff({ baseDelayMs: BASE, jitter: "full", jitterRatio: 0 }),
    ).toThrow(/jitterRatio does not apply/);
  });
});

describe("createBackoff — default mode is unchanged", () => {
  it("omitting `jitter` is byte-identical to jitter: \"additive\"", () => {
    const shared = {
      baseDelayMs: 1_000,
      strategy: "exponential" as const,
      factor: 2,
      maxDelayMs: 10_000,
      jitterRatio: 0.5,
    };
    const seq = [0, 0.1, 0.5, 0.9, 0.999];
    const legacy = createBackoff({ ...shared, random: sequenceRandom(seq) });
    const explicit = createBackoff({
      ...shared,
      jitter: "additive",
      random: sequenceRandom(seq),
    });
    for (let attempt = 1; attempt <= 6; attempt++) {
      for (let i = 0; i < seq.length; i++) {
        expect(legacy.delayFor(attempt)).toBe(explicit.delayFor(attempt));
      }
      expect(legacy.baseFor(attempt)).toBe(explicit.baseFor(attempt));
      expect(legacy.maxFor(attempt)).toBe(explicit.maxFor(attempt));
    }
  });

  it("the sdk-compatible default still has a non-zero floor at random = 0", () => {
    // The regression this guards: full jitter must not leak into the default.
    const backoff = createBackoff({ baseDelayMs: 1_000, random: fixedRandom(0) });
    expect(backoff.delayFor(1)).toBe(1_000);
    expect(backoff.delayFor(2)).toBe(2_000);
  });

  it("leaves budgetedAttempts undefined when no budget is declared", () => {
    expect(createBackoff({ baseDelayMs: 100 }).budgetedAttempts).toBeUndefined();
  });
});

describe("createBackoff — cumulative delay budget", () => {
  it("totalMaxFor sums the per-attempt envelopes of the chain's sleeps", () => {
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      factor: 2,
      maxDelayMs: 5_000,
      jitter: "full",
    });
    expect(backoff.totalMaxFor(1)).toBe(0); // one attempt sleeps zero times
    expect(backoff.totalMaxFor(2)).toBe(500);
    expect(backoff.totalMaxFor(3)).toBe(1_500); // 500 + 1000
    expect(backoff.totalMaxFor(4)).toBe(3_500); // + 2000
  });

  it("counts the additive jitter span in the envelope", () => {
    const backoff = createBackoff({ baseDelayMs: 1_000, jitterRatio: 0.5 });
    // maxFor(1) = 1500, maxFor(2) = 2500
    expect(backoff.totalMaxFor(3)).toBe(4_000);
  });

  it("is tighter than the coarse (attempts-1) * maxDelayMs bound", () => {
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      maxDelayMs: 5_000,
      jitter: "full",
      attempts: 3,
      maxTotalDelayMs: 15_000,
    });
    expect(backoff.totalMaxFor(3)).toBe(1_500);
    expect(backoff.totalMaxFor(3)).toBeLessThan((3 - 1) * 5_000);
    expect(backoff.budgetedAttempts).toBe(3);
  });

  it("throws when the schedule cannot fit the declared budget", () => {
    expect(() =>
      createBackoff({
        baseDelayMs: 5_000,
        strategy: "exponential",
        factor: 2,
        jitter: "full",
        attempts: 4, // 5000 + 10000 + 20000 = 35000
        maxTotalDelayMs: 15_000,
      }),
    ).toThrow(/exceeds maxTotalDelayMs 15000ms/);
  });

  it("requires attempts alongside maxTotalDelayMs", () => {
    expect(() => createBackoff({ baseDelayMs: 100, maxTotalDelayMs: 1_000 })).toThrow(
      /requires attempts/,
    );
  });

  it("rejects a non-integer or sub-1 attempts / negative budget", () => {
    expect(() => createBackoff({ baseDelayMs: 100, attempts: 0 })).toThrow(RangeError);
    expect(() => createBackoff({ baseDelayMs: 100, attempts: 2.5 })).toThrow(RangeError);
    expect(() =>
      createBackoff({ baseDelayMs: 100, attempts: 2, maxTotalDelayMs: -1 }),
    ).toThrow(RangeError);
    expect(() => createBackoff({ baseDelayMs: 100 }).totalMaxFor(0)).toThrow(RangeError);
  });
});

describe("createBackoff — validation", () => {
  it("rejects attempt < 1", () => {
    const backoff = createBackoff({ baseDelayMs: 100 });
    expect(() => backoff.delayFor(0)).toThrow(RangeError);
    expect(() => backoff.baseFor(-1)).toThrow(RangeError);
  });

  it("rejects invalid config", () => {
    expect(() => createBackoff({ baseDelayMs: -1 })).toThrow(RangeError);
    expect(() => createBackoff({ baseDelayMs: 1, factor: 0 })).toThrow(RangeError);
    expect(() => createBackoff({ baseDelayMs: 1, jitterRatio: -1 })).toThrow(RangeError);
    expect(() => createBackoff({ baseDelayMs: 1, maxDelayMs: -1 })).toThrow(RangeError);
  });
});
