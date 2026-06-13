/**
 * LRU cache with optional TTL and stale-while-revalidate (SWR).
 *
 * - LRU: capacity-bounded; the least-recently-used entry is evicted on
 *   overflow. A read promotes the entry to most-recently-used.
 * - TTL: an entry older than `ttlMs` is "expired". A `get` past the TTL
 *   removes the entry and misses.
 * - SWR: when `staleWhileRevalidateMs` is set, an entry between `ttlMs` and
 *   `ttlMs + staleWhileRevalidateMs` is "stale" — still served (so the caller
 *   can return it immediately) but flagged so the caller can refresh in the
 *   background. Past that window the entry is fully expired.
 *
 * All age decisions use the injected {@link Clock} — no `Date.now()` in the
 * logic path, so expiry and SWR windows are deterministic under test.
 */

import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

/** Freshness classification of a cache entry at read time. */
export type CacheEntryStatus = "fresh" | "stale" | "expired";

/** Configuration for a {@link Cache}. */
export interface CacheConfig {
  /** Maximum number of entries before LRU eviction. Must be > 0. */
  maxSize: number;
  /**
   * Time-to-live in ms. After this, an entry is stale (if SWR is configured)
   * or expired. Omit for no TTL (entries never expire by age).
   */
  ttlMs?: number;
  /**
   * Stale-while-revalidate window in ms, added on top of `ttlMs`. Within it a
   * read returns the value with `status: "stale"`. Requires `ttlMs`.
   */
  staleWhileRevalidateMs?: number;
  /** Clock for time injection (default: {@link systemClock}). */
  clock?: Clock;
}

/** The outcome of a {@link Cache.get}. */
export interface CacheGetResult<V> {
  /** Whether a usable entry was found (fresh or stale). A miss is `false`. */
  hit: boolean;
  /** The cached value, if `hit`. */
  value?: V;
  /** Freshness of the returned value (`"expired"` accompanies a miss). */
  status: CacheEntryStatus;
}

/** Cache hit/miss/eviction counters. */
export interface CacheStats {
  hits: number;
  staleHits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
}

/** An LRU+TTL+SWR cache. */
export interface Cache<K, V> {
  /**
   * Read `key`. Returns `{ hit: false, status: "expired" }` on a miss or a
   * fully-expired entry; `{ hit: true, status: "fresh" | "stale", value }`
   * otherwise. A hit promotes the entry to most-recently-used.
   */
  get(key: K): CacheGetResult<V>;
  /** Insert or update `key`. Stamps the entry's creation time from the clock. */
  set(key: K, value: V): void;
  /** Whether `key` is present and not fully expired (does not promote). */
  has(key: K): boolean;
  /** Remove `key`. Returns whether it was present. */
  delete(key: K): boolean;
  /** Remove all entries (counters are preserved). */
  clear(): void;
  /** Current entry count (after pruning lazily-noticed expirations? No — raw). */
  readonly size: number;
  /** A snapshot of the hit/miss/eviction counters. */
  stats(): CacheStats;
}

interface CacheEntry<V> {
  value: V;
  createdAt: number;
}

/**
 * Create an LRU+TTL+SWR {@link Cache}.
 *
 * @example Plain LRU
 * const c = createCache<string, number>({ maxSize: 2 });
 * c.set("a", 1); c.set("b", 2); c.set("c", 3); // evicts "a"
 *
 * @example TTL + stale-while-revalidate
 * const c = createCache<string, User>({
 *   maxSize: 100, ttlMs: 60_000, staleWhileRevalidateMs: 30_000, clock,
 * });
 * const r = c.get("u1");
 * if (r.hit && r.status === "stale") { void refresh("u1"); }
 */
export function createCache<K, V>(config: CacheConfig): Cache<K, V> {
  const {
    maxSize,
    ttlMs,
    staleWhileRevalidateMs,
    clock = systemClock,
  } = config;

  if (maxSize <= 0) {
    throw new RangeError(`createCache: maxSize must be > 0, got ${maxSize}`);
  }
  if (ttlMs !== undefined && ttlMs < 0) {
    throw new RangeError(`createCache: ttlMs must be >= 0, got ${ttlMs}`);
  }
  if (staleWhileRevalidateMs !== undefined) {
    if (staleWhileRevalidateMs < 0) {
      throw new RangeError(
        `createCache: staleWhileRevalidateMs must be >= 0, got ${staleWhileRevalidateMs}`,
      );
    }
    if (ttlMs === undefined) {
      throw new RangeError(
        "createCache: staleWhileRevalidateMs requires ttlMs to be set",
      );
    }
  }

  // Map preserves insertion order; we use it as the LRU recency list. The
  // back of the map is most-recently-used.
  const entries = new Map<K, CacheEntry<V>>();
  const counters = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  /** Classify an entry's freshness at `nowMs`. */
  function classify(entry: CacheEntry<V>, nowMs: number): CacheEntryStatus {
    if (ttlMs === undefined) return "fresh";
    const age = nowMs - entry.createdAt;
    if (age < ttlMs) return "fresh";
    if (staleWhileRevalidateMs !== undefined && age < ttlMs + staleWhileRevalidateMs) {
      return "stale";
    }
    return "expired";
  }

  /** Move an existing key to the most-recently-used position. */
  function promote(key: K, entry: CacheEntry<V>): void {
    entries.delete(key);
    entries.set(key, entry);
  }

  function evictIfNeeded(): void {
    while (entries.size > maxSize) {
      // The first key in iteration order is the least-recently-used.
      const lru = entries.keys().next();
      if (lru.done) break;
      entries.delete(lru.value);
      counters.evictions += 1;
    }
  }

  return {
    get(key: K): CacheGetResult<V> {
      const entry = entries.get(key);
      if (entry === undefined) {
        counters.misses += 1;
        return { hit: false, status: "expired" };
      }
      const status = classify(entry, clock());
      if (status === "expired") {
        entries.delete(key);
        counters.expirations += 1;
        counters.misses += 1;
        return { hit: false, status: "expired" };
      }
      promote(key, entry);
      if (status === "stale") counters.staleHits += 1;
      else counters.hits += 1;
      return { hit: true, status, value: entry.value };
    },
    set(key: K, value: V): void {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, { value, createdAt: clock() });
      evictIfNeeded();
    },
    has(key: K): boolean {
      const entry = entries.get(key);
      if (entry === undefined) return false;
      return classify(entry, clock()) !== "expired";
    },
    delete(key: K): boolean {
      return entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
    stats(): CacheStats {
      return { ...counters, size: entries.size };
    },
  };
}
