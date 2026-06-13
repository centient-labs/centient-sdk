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
