/**
 * Token-bucket rate-limiter tests — deterministic via the manual clock.
 */

import { describe, it, expect } from "vitest";
import { createTokenBucket } from "../src/rate-limiter.js";
import { createManualClock } from "../src/clock.js";

describe("createTokenBucket — tryAcquire", () => {
  it("starts full and consumes tokens on success", () => {
    const t = createManualClock(1_000);
    const bucket = createTokenBucket({ capacity: 5, refillPerSecond: 1, clock: t.clock });
    const r = bucket.tryAcquire(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(2);
    expect(bucket.available()).toBe(2);
  });

  it("denies when short and reports retryAfterMs and availability", () => {
    const t = createManualClock(1_000);
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, clock: t.clock });
    expect(bucket.tryAcquire(2).ok).toBe(true);
    const r = bucket.tryAcquire(1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("rate-limited");
      expect(r.error.requested).toBe(1);
      expect(r.error.available).toBe(0);
      expect(r.error.retryAfterMs).toBe(1_000); // 1 token at 1/s = 1000ms
    }
  });

  it("refills lazily from the injected clock", () => {
    const t = createManualClock(0);
    const bucket = createTokenBucket({
      capacity: 10,
      refillPerSecond: 2,
      initialTokens: 0,
      clock: t.clock,
    });
    expect(bucket.tryAcquire(1).ok).toBe(false);
    t.advance(1_000); // 2 tokens accrue
    expect(bucket.available()).toBe(2);
    expect(bucket.tryAcquire(2).ok).toBe(true);
    expect(bucket.available()).toBe(0);
  });

  it("caps refill at capacity", () => {
    const t = createManualClock(0);
    const bucket = createTokenBucket({ capacity: 5, refillPerSecond: 100, clock: t.clock });
    bucket.tryAcquire(5);
    t.advance(10_000); // would accrue 1000, capped at 5
    expect(bucket.available()).toBe(5);
  });

  it("does not credit when the clock does not advance", () => {
    const t = createManualClock(500);
    const bucket = createTokenBucket({
      capacity: 4,
      refillPerSecond: 4,
      initialTokens: 0,
      clock: t.clock,
    });
    expect(bucket.available()).toBe(0);
    expect(bucket.available()).toBe(0); // repeated read, same clock
  });

  it("validates config and request sizes", () => {
    expect(() => createTokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
    expect(() => createTokenBucket({ capacity: 1, refillPerSecond: 0 })).toThrow(RangeError);
    expect(() =>
      createTokenBucket({ capacity: 1, refillPerSecond: 1, initialTokens: 2 }),
    ).toThrow(RangeError);
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1 });
    expect(() => bucket.tryAcquire(0)).toThrow(RangeError);
    expect(() => bucket.tryAcquire(3)).toThrow(RangeError);
  });

  it("reset refills to full", () => {
    const t = createManualClock(0);
    const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 1, clock: t.clock });
    bucket.tryAcquire(3);
    expect(bucket.available()).toBe(0);
    bucket.reset();
    expect(bucket.available()).toBe(3);
  });
});

describe("createTokenBucket — acquire (waiting)", () => {
  it("resolves immediately when tokens are available", async () => {
    const t = createManualClock(0);
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, clock: t.clock });
    await expect(bucket.acquire(1)).resolves.toBeUndefined();
    expect(bucket.available()).toBe(1);
  });

  it("waits for refill using the injected sleep, advancing the clock to fund the request", async () => {
    const t = createManualClock(0);
    let slept = 0;
    const bucket = createTokenBucket({
      capacity: 2,
      refillPerSecond: 1,
      initialTokens: 0,
      clock: t.clock,
      // The fake sleep advances the manual clock so the retry can succeed.
      sleep: async (ms: number) => {
        slept += ms;
        t.advance(ms);
      },
    });
    await bucket.acquire(1);
    expect(slept).toBe(1_000);
    expect(bucket.available()).toBe(0);
  });
});
