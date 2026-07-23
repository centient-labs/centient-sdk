# @centient/resilience

Zero-dependency resilience primitives for Centient packages: circuit breaker, token-bucket rate limiter, backoff-with-jitter, retry with an injectable failure classifier, LRU/TTL/SWR cache, and bounded-concurrency pool.

Every time- and entropy-dependent behaviour is driven by an injected `Clock` or `RandomSource` — no `Date.now()` or `Math.random()` in any logic path — so the primitives are fully deterministic under test. The package follows the factory-function convention (`createCircuitBreaker()`, `createTokenBucket()`, …) and the `Result` discriminated-union error pattern used across `@centient`.

## Installation

```bash
npm install @centient/resilience
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/resilience --workspace
```

## Design: injected clock and randomness

The single rule that shapes this package: **a logic path never reads the wall clock or the global RNG directly.** Instead it takes a `Clock` (`() => number`, epoch ms) and, where jitter is involved, a `RandomSource` (`() => number` in `[0, 1)`).

```typescript
import { systemClock, createManualClock, systemRandom, fixedRandom } from "@centient/resilience";

// Production
const clock = systemClock; // the only place Date.now() is read

// Tests — advance time by hand, deterministically
const t = createManualClock(0);
t.advance(5_000); // 5 seconds pass
```

A source-grep test enforces the rule: `Date.now()` may only appear in `clock.ts`, `Math.random()` only in `random.ts`.

## Result type

Operations whose failure is an ordinary outcome (a denied rate-limit acquire, a cache miss promoted to an error) return a `Result<T, E>` rather than throwing. Throwing is reserved for programmer error (invalid configuration).

```typescript
import { ok, err, isOk, type Result } from "@centient/resilience";

const r: Result<number, string> = ok(42);
if (isOk(r)) console.log(r.value); // 42
```

---

## Circuit breaker

A `CLOSED -> OPEN -> HALF_OPEN -> CLOSED` state machine. Consecutive failures trip the circuit open; while open, calls are rejected until the open duration elapses, then a single probe (HALF_OPEN) decides whether to close or re-open with exponentially-increased backoff (capped).

```typescript
import { createCircuitBreaker, CircuitOpenError } from "@centient/resilience";

const breaker = createCircuitBreaker({
  failureThreshold: 5,    // open after 5 consecutive failures
  openDurationMs: 30_000, // stay open 30s before probing
  backoffMultiplier: 2,   // double the open duration on each failed probe
  maxOpenDurationMs: 300_000,
});

try {
  const data = await breaker.execute(() => fetchFromUpstream());
} catch (e) {
  if (e instanceof CircuitOpenError) {
    // serve a fallback; e.retryAfterMs tells you when to try again
  }
}
```

Out-of-band recording (when you are not wrapping the call in `execute`):

```typescript
if (breaker.canExecute()) {
  try { doWork(); breaker.onSuccess(); }
  catch { breaker.onFailure(); }
}
```

### Pure state machine

The factory wraps a pure, immutable state machine you can use directly (ported from crucible's `circuit-breaker.ts`). Every function takes state + an epoch-millisecond timestamp and returns new state:

```typescript
import {
  createCircuitBreakerState,
  getDefaultCircuitBreakerConfig,
  checkCircuit,
  recordSuccess,
  recordFailure,
} from "@centient/resilience";

const config = getDefaultCircuitBreakerConfig();
let state = createCircuitBreakerState(config);
state = recordFailure(state, config, Date.now()); // you own the clock here
const { result, updatedState } = checkCircuit(state, Date.now());
```

**Exports:** `createCircuitBreaker`, `CircuitOpenError`, `getDefaultCircuitBreakerConfig`, `createCircuitBreakerState`, `checkCircuit`, `recordSuccess`, `recordFailure`, and the types `CircuitBreaker`, `CircuitBreakerConfig`, `CircuitBreakerOptions`, `CircuitBreakerState`, `CircuitCheckResult`, `CircuitState`.

---

## Token-bucket rate limiter

A bucket holds up to `capacity` tokens and refills at `refillPerSecond`. Refill is computed lazily from the clock — no background timer.

```typescript
import { createTokenBucket } from "@centient/resilience";

const bucket = createTokenBucket({ capacity: 10, refillPerSecond: 5 });

// Non-blocking: returns a Result
const r = bucket.tryAcquire(3);
if (r.ok) {
  // 3 tokens consumed; r.value tokens remain
} else {
  // denied; r.error.retryAfterMs ms until enough tokens accrue
}

// Blocking: waits (via injected sleep) until tokens are available
await bucket.acquire(2);

bucket.available(); // current tokens after lazy refill
```

**Exports:** `createTokenBucket`, and the types `TokenBucket`, `TokenBucketConfig`, `TokenBucketOptions`, `RateLimitError`.

---

## Backoff with jitter

`linear` reproduces the `@centient/sdk` retry schedule exactly — base `attempt * baseDelayMs` plus jitter in `[0, jitterRatio * baseDelayMs)` (sdk uses `jitterRatio = 0.5`) — so the sdk can adopt it as a drop-in. `exponential` is `baseDelayMs * factor^(attempt-1)`, capped at `maxDelayMs`, with the same additive jitter.

```typescript
import { createBackoff } from "@centient/resilience";

// Linear (sdk-compatible): attempt 1 ∈ [1000, 1500), attempt 2 ∈ [2000, 2500)
const linear = createBackoff({ baseDelayMs: 1000 });
const delay = linear.delayFor(attempt); // sleep this many ms before retry

// Exponential with cap
const expo = createBackoff({
  baseDelayMs: 100,
  strategy: "exponential",
  factor: 2,
  maxDelayMs: 1000,
});
expo.baseFor(5); // 1000 (1600 capped)

// Deterministic jitter in tests
import { fixedRandom } from "@centient/resilience";
createBackoff({ baseDelayMs: 1000, random: fixedRandom(0) }).delayFor(1); // exactly 1000
```

`baseFor(attempt)` and `maxFor(attempt)` expose the (capped) base and the full jitter envelope.

### Full jitter (no floor)

`jitter: "full"` switches to the AWS "Exponential Backoff And Jitter" *full* variant: `delay = random() * min(maxDelayMs, baseDelayMs * factor^(attempt-1))` — uniform in `[0, cap)`, **no floor, can be 0**. The default (`jitter: "additive"`) is unchanged, so existing callers see no difference.

Use it when many clients back off against the same upstream. A non-zero floor re-clusters a retrying fleet and reconstitutes the thundering herd that caused the brownout; uniform-from-zero spreads them maximally.

```typescript
const backoff = createBackoff({
  baseDelayMs: 500,
  strategy: "exponential",
  factor: 2,
  maxDelayMs: 5_000,
  jitter: "full",
});
backoff.delayFor(1); // ∈ [0, 500)   — can be exactly 0
backoff.delayFor(3); // ∈ [0, 2000)
backoff.baseFor(3);  // 2000 — in full mode the schedule value is the CAP, not the floor
```

`jitterRatio` does not apply to full jitter (the span comes from the schedule value itself); passing both throws rather than silently ignoring one.

### Cumulative delay budget

A retry chain's worst case is the *sum* of its delays. `totalMaxFor(attempts)` reports the exact envelope — `sum(maxFor(1..attempts-1))`, since `attempts` attempts sleep `attempts - 1` times — which is tighter than the coarse `(attempts - 1) * maxDelayMs` bound.

Callers on a tick budget can declare it and have the factory enforce it at construction:

```typescript
const backoff = createBackoff({
  baseDelayMs: 500, strategy: "exponential", factor: 2, maxDelayMs: 5_000,
  jitter: "full",
  attempts: 3,             // the chain the budget covers
  maxTotalDelayMs: 15_000, // must stay well inside a 30s tick
});
backoff.totalMaxFor(3);    // 1500 (500 + 1000) — throws at construction if it exceeded the budget
backoff.budgetedAttempts;  // 3 — withRetry refuses to run more than this
```

**Exports:** `createBackoff`, and the types `Backoff`, `BackoffConfig`, `BackoffStrategy`, `BackoffJitter`.

---

## Retry with an injectable classifier

`withRetry` runs an async operation on a `Backoff` schedule and retries only the failures its `shouldRetry` predicate accepts. Schedule, predicate, and `sleep` are all injected, so the loop is deterministic under test. The last error is re-thrown unchanged once attempts are exhausted — no new error shape, so existing failure handling stays authoritative.

```typescript
import { createBackoff, withRetry } from "@centient/resilience";

const backoff = createBackoff({
  baseDelayMs: 500, strategy: "exponential", factor: 2,
  maxDelayMs: 5_000, jitter: "full", attempts: 3, maxTotalDelayMs: 15_000,
});

const crystal = await withRetry(() => client.crystals.get(id), {
  backoff, // attempts defaults to backoff.budgetedAttempts (3 here) — no need to repeat it
  onRetry: ({ attempt, delayMs, error }) => log.warn("retry", { attempt, delayMs, error }),
});
```

`attempts` defaults to the backoff's declared `budgetedAttempts`, or 3 when no budget was declared — the chain length is stated once, on the schedule. Passing a value *above* the budget still throws; only the defaulting defers to the schedule.

Wrap one logical operation per call — wrapping a pagination loop rather than the per-page fetch multiplies the budget by the page count.

### Classification is a parameter, not a policy

Which errors deserve a retry is a property of the *caller's* failure domain. A client riding out an upstream brownout wants request timeouts retried (they are the brownout's dominant transient) and unknown errors **not** retried (an unclassifiable failure may be a non-idempotent partial success, and replaying it duplicates a write). `isTransientError` is the packaged default:

| Class | Retried |
|---|---|
| Timeouts (`AbortError` / `TimeoutError` / `code: "TIMEOUT"` / "request timed out") | yes |
| 5xx (`statusCode` / `status` / `response.status` >= 500) | yes |
| Network (`NETWORK_ERROR`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`) | yes |
| 4xx (400–499), **including 409 CAS conflicts** | no |
| Schema validation (`ZodError`) | no |
| Anything else (unknown, non-`Error` throws) | no |

A status code, when present, wins over name/code/message heuristics. 409s are terminal because blind replay of the same `expectedVersion` can never succeed — the caller's compare-and-set loop owns conflict policy.

Supply your own predicate, or build a variant of the packaged one:

```typescript
import { createTransientErrorPredicate, withRetry } from "@centient/resilience";

const shouldRetry = createTransientErrorPredicate({
  isConflict: isCrystalVersionConflictError, // caller-owned conflicts, evaluated first
  retryableCodes: ["EAI_AGAIN"],             // extra transient codes
  retryUnknown: false,                       // default; true only if every op is idempotent
});

await withRetry(op, { backoff, shouldRetry });
```

**Exports:** `withRetry`, `isTransientError`, `createTransientErrorPredicate`, and the types `ShouldRetry`, `RetryConfig`, `RetryAttemptInfo`, `TransientErrorPredicateOptions`.

---

## Cache (LRU / TTL / SWR)

A capacity-bounded LRU cache with optional TTL and stale-while-revalidate. Reads promote to most-recently-used; overflow evicts the least-recently-used.

```typescript
import { createCache } from "@centient/resilience";

// Plain LRU
const lru = createCache<string, number>({ maxSize: 100 });
lru.set("a", 1);
lru.get("a"); // { hit: true, status: "fresh", value: 1 }

// TTL + stale-while-revalidate
const cache = createCache<string, User>({
  maxSize: 1000,
  ttlMs: 60_000,                 // fresh for 60s
  staleWhileRevalidateMs: 30_000, // then served stale for 30s more
});

const r = cache.get("u1");
if (r.hit && r.status === "stale") {
  // serve r.value now, refresh in the background
  void refreshUser("u1").then((u) => cache.set("u1", u));
}
```

`get` returns `{ hit, status, value? }` where `status` is `"fresh" | "stale" | "expired"`. A miss or a fully-expired entry is `{ hit: false, status: "expired" }`. `stats()` exposes hit/miss/eviction/expiration counters.

**Exports:** `createCache`, and the types `Cache`, `CacheConfig`, `CacheGetResult`, `CacheEntryStatus`, `CacheStats`.

---

## Bounded-concurrency pool

Runs async tasks with at most `concurrency` in flight; the rest queue FIFO. An optional `maxQueue` sheds load (rejecting with `PoolRejectedError`) rather than letting the backlog grow unbounded.

```typescript
import { createPool, PoolRejectedError } from "@centient/resilience";

const pool = createPool({ concurrency: 4 });
const results = await Promise.all(urls.map((u) => pool.run(() => fetch(u))));

await pool.onIdle(); // resolves when all work settles

// Bounded queue: reject when saturated
const bounded = createPool({ concurrency: 2, maxQueue: 10 });
try {
  await bounded.run(task);
} catch (e) {
  if (e instanceof PoolRejectedError) {
    // shed load
  }
}
```

`pool.active`, `pool.queued`, and `pool.stats()` report occupancy.

**Exports:** `createPool`, `PoolRejectedError`, and the types `Pool`, `PoolConfig`, `PoolStats`.

---

## Shared primitive exports

- **Clock:** `systemClock`, `createManualClock`, type `Clock`, `ManualClock`
- **Sleep:** `systemSleep`, type `Sleep` — the single wait seam (`TokenBucket.acquire`, `withRetry`)
- **Randomness:** `systemRandom`, `fixedRandom`, `sequenceRandom`, type `RandomSource`
- **Result:** `ok`, `err`, `isOk`, `isErr`, type `Result`, `Ok`, `Err`

## License

MIT
