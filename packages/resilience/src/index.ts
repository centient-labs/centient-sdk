/**
 * @centient/resilience — zero-dependency resilience primitives.
 *
 * Circuit breaker, token-bucket rate limiter, backoff-with-jitter,
 * LRU/TTL/SWR cache, and bounded-concurrency pool. Clock and randomness are
 * injected throughout (no `Date.now()` / `Math.random()` in logic paths), so
 * every time- and entropy-dependent behaviour is deterministic under test.
 */

// Shared primitives
export type { Clock, ManualClock } from "./clock.js";
export { systemClock, createManualClock } from "./clock.js";

export type { RandomSource } from "./random.js";
export { systemRandom, fixedRandom, sequenceRandom } from "./random.js";

export type { Result, Ok, Err } from "./result.js";
export { ok, err, isOk, isErr } from "./result.js";

// Backoff
export type { Backoff, BackoffConfig, BackoffStrategy } from "./backoff.js";
export { createBackoff } from "./backoff.js";

// Circuit breaker
export type {
  CircuitState,
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerOptions,
  CircuitBreakerState,
  CircuitCheckResult,
} from "./circuit-breaker.js";
export {
  createCircuitBreaker,
  CircuitOpenError,
  getDefaultCircuitBreakerConfig,
  createCircuitBreakerState,
  checkCircuit,
  recordSuccess,
  recordFailure,
} from "./circuit-breaker.js";

// Rate limiter
export type {
  TokenBucket,
  TokenBucketConfig,
  TokenBucketOptions,
  RateLimitError,
} from "./rate-limiter.js";
export { createTokenBucket } from "./rate-limiter.js";

// Cache
export type {
  Cache,
  CacheConfig,
  CacheGetResult,
  CacheEntryStatus,
  CacheStats,
} from "./cache.js";
export { createCache } from "./cache.js";

// Pool
export type { Pool, PoolConfig, PoolStats } from "./pool.js";
export { createPool, PoolRejectedError } from "./pool.js";
