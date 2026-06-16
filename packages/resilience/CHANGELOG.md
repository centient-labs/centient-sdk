# @centient/resilience

## 0.1.0

### Minor Changes

- 4262043: Add `@centient/resilience` — zero-dependency resilience primitives: a clock-injected circuit breaker (ported from crucible's pure state machine), token-bucket rate limiter, backoff-with-jitter (linear schedule compatible with the `@centient/sdk` retry jitter, plus exponential), an LRU/TTL/SWR cache, and a bounded-concurrency pool. Clock and randomness are injected throughout (no `Date.now()`/`Math.random()` in logic paths, enforced by a source-grep test). Factory-function API (`createCircuitBreaker()`, `createTokenBucket()`, `createBackoff()`, `createCache()`, `createPool()`) and the `Result` error pattern where failure is an ordinary outcome. The token bucket surfaces a `clockRegressions()` counter so a non-monotonic clock source is observable rather than silently swallowed, the cache's `has()` reclaims fully-expired entries in passing so probe-only keys cannot leak, and the pool frees a slot before pumping its scheduler so a throwing task factory cannot strand a queued task.
