/**
 * Cache tests — LRU eviction, TTL expiry, and stale-while-revalidate, all
 * deterministic via the manual clock.
 */

import { describe, it, expect } from "vitest";
import { createCache } from "../src/cache.js";
import { createManualClock } from "../src/clock.js";

describe("createCache — LRU", () => {
  it("evicts the least-recently-used entry on overflow", () => {
    const cache = createCache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.get("a").hit).toBe(false);
    expect(cache.get("b").value).toBe(2);
    expect(cache.get("c").value).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });

  it("a read promotes an entry to most-recently-used", () => {
    const cache = createCache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a").hit).toBe(true); // promote "a"
    cache.set("c", 3); // evicts "b" (now LRU), not "a"
    expect(cache.get("a").hit).toBe(true);
    expect(cache.get("b").hit).toBe(false);
  });

  it("updating an existing key refreshes recency and does not grow size", () => {
    const cache = createCache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // update, promotes "a"
    cache.set("c", 3); // evicts "b"
    expect(cache.size).toBe(2);
    expect(cache.get("a").value).toBe(10);
    expect(cache.get("b").hit).toBe(false);
  });

  it("delete and clear behave", () => {
    const cache = createCache<string, number>({ maxSize: 5 });
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("createCache — TTL", () => {
  it("misses an entry past its TTL and counts an expiration", () => {
    const t = createManualClock(0);
    const cache = createCache<string, number>({ maxSize: 5, ttlMs: 1_000, clock: t.clock });
    cache.set("a", 1);
    t.advance(999);
    expect(cache.get("a").status).toBe("fresh");
    t.advance(1); // now at TTL boundary -> expired (no SWR)
    const r = cache.get("a");
    expect(r.hit).toBe(false);
    expect(r.status).toBe("expired");
    expect(cache.stats().expirations).toBe(1);
    expect(cache.size).toBe(0); // expired entry removed
  });

  it("has() reports false for an expired entry without promoting", () => {
    const t = createManualClock(0);
    const cache = createCache<string, number>({ maxSize: 5, ttlMs: 100, clock: t.clock });
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    t.advance(100);
    expect(cache.has("a")).toBe(false);
  });

  it("has() evicts an expired entry in passing so probe-only keys do not leak", () => {
    const t = createManualClock(0);
    const cache = createCache<string, number>({ maxSize: 5, ttlMs: 100, clock: t.clock });
    cache.set("a", 1);
    expect(cache.size).toBe(1);
    t.advance(100); // expire "a"
    // A key only ever probed with has() (never get()) must still be reclaimed.
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.stats().expirations).toBe(1);
    // A repeated probe is a no-op miss — the entry is already gone, count holds.
    expect(cache.has("a")).toBe(false);
    expect(cache.stats().expirations).toBe(1);
  });

  it("has() does not evict or count a fresh entry", () => {
    const t = createManualClock(0);
    const cache = createCache<string, number>({ maxSize: 5, ttlMs: 100, clock: t.clock });
    cache.set("a", 1);
    t.advance(50);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.stats().expirations).toBe(0);
  });
});

describe("createCache — stale-while-revalidate", () => {
  it("serves a stale value within the SWR window and flags it", () => {
    const t = createManualClock(0);
    const cache = createCache<string, number>({
      maxSize: 5,
      ttlMs: 1_000,
      staleWhileRevalidateMs: 500,
      clock: t.clock,
    });
    cache.set("a", 1);

    t.advance(500); // fresh
    expect(cache.get("a").status).toBe("fresh");

    t.advance(600); // 1100ms: past TTL, within SWR
    const stale = cache.get("a");
    expect(stale.hit).toBe(true);
    expect(stale.status).toBe("stale");
    expect(stale.value).toBe(1);
    expect(cache.stats().staleHits).toBe(1);

    t.advance(500); // 1600ms: past SWR window -> expired
    expect(cache.get("a").hit).toBe(false);
  });

  it("requires ttlMs when staleWhileRevalidateMs is set", () => {
    expect(() => createCache({ maxSize: 1, staleWhileRevalidateMs: 100 })).toThrow(RangeError);
  });
});

describe("createCache — validation", () => {
  it("rejects invalid config", () => {
    expect(() => createCache({ maxSize: 0 })).toThrow(RangeError);
    expect(() => createCache({ maxSize: 1, ttlMs: -1 })).toThrow(RangeError);
    expect(() =>
      createCache({ maxSize: 1, ttlMs: 1, staleWhileRevalidateMs: -1 }),
    ).toThrow(RangeError);
  });
});
