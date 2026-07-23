---
"@centient/resilience": minor
---

feat(resilience): full-jitter backoff, cumulative delay budget, and retry with an injectable classifier (#116)

Two additive capabilities that unblock adoption by callers riding out an
upstream brownout. Existing behaviour is untouched: every current
`createBackoff` config produces byte-identical delays.

**Full jitter (`jitter: "full"`)** — the AWS "Exponential Backoff And Jitter"
*full* variant: `delay = random() * min(maxDelayMs, baseDelayMs * factor^(attempt-1))`,
uniform in `[0, cap)` with **no floor**, so a delay can be exactly 0. The
default `jitter: "additive"` (base + `jitterRatio * baseDelayMs`) keeps its
non-zero floor. A floor re-clusters a retrying fleet and reconstitutes the
thundering herd that caused the brownout; uniform-from-zero spreads them
maximally. `jitterRatio` does not apply to full jitter and passing both throws
rather than silently ignoring one.

**Cumulative delay budget** — `Backoff.totalMaxFor(attempts)` reports the exact
worst-case sum of a chain's sleeps, `sum(maxFor(1..attempts-1))`, which is
tighter than the coarse `(attempts - 1) * maxDelayMs` bound. Declaring
`attempts` + `maxTotalDelayMs` has the factory enforce it at construction, and
`Backoff.budgetedAttempts` lets `withRetry` refuse to overrun it — a budget the
loop can silently exceed is not a budget.

**`withRetry()` with an injectable classifier** — runs an async op on a
`Backoff` schedule, retrying only what `shouldRetry(error)` accepts, with
`sleep` and an `onRetry` observability hook injected. The last error is
re-thrown unchanged, so callers' existing failure handling stays authoritative.
`isTransientError` is the packaged default taxonomy — timeouts, 5xx, and
network failures retryable; 4xx (including 409 CAS conflicts), `ZodError`, and
unknown errors terminal, because an unclassifiable failure may be a
non-idempotent partial success. `createTransientErrorPredicate()` builds
variants (a caller-owned conflict predicate, extra retryable codes, or the
opposite stance on unknown errors).

Also lifts the `setTimeout` wait into a single `systemSleep` / `Sleep` seam in
`clock.ts`, shared by `TokenBucket.acquire` and `withRetry`.
