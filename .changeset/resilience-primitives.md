---
"@centient/resilience": minor
---

Add `@centient/resilience` — zero-dependency resilience primitives: a clock-injected circuit breaker (ported from crucible's pure state machine), token-bucket rate limiter, backoff-with-jitter (linear schedule compatible with the `@centient/sdk` retry jitter, plus exponential), an LRU/TTL/SWR cache, and a bounded-concurrency pool. Clock and randomness are injected throughout (no `Date.now()`/`Math.random()` in logic paths, enforced by a source-grep test). Factory-function API (`createCircuitBreaker()`, `createTokenBucket()`, `createBackoff()`, `createCache()`, `createPool()`) and the `Result` error pattern where failure is an ordinary outcome.
