---
"@centient/sdk": minor
---

retry: adopt `@centient/resilience` backoff + export `isRetryableError` (behaviour-preserving)

## Added — `isRetryableError(err): boolean`

The SDK now exports the same predicate its request loop uses to decide whether a
caught error is worth re-issuing, so downstream consumers (centient, mbot,
test-kit) no longer have to hand-roll the classification by string-matching
error messages:

```typescript
import { isRetryableError } from "@centient/sdk";

try {
  await client.search(sessionId, { query });
} catch (err) {
  if (isRetryableError(err)) {
    // transient — back off and try again
  } else {
    throw err; // terminal
  }
}
```

- **Retryable** (`true`): a 5xx `EngramError`, or a raw transport `Error` (e.g. a
  `fetch` `TypeError` / `ECONNREFUSED`).
- **Non-retryable** (`false`): `TimeoutError`, `NetworkError`,
  `ResponseShapeError`, any 4xx `EngramError`, and non-`Error` throwables.

The client uses this helper internally for its 5xx retry decision, so there is a
single source of truth.

## Changed — backoff now powered by `@centient/resilience` (behaviour-preserving)

The client's private retry backoff is now delegated to
`@centient/resilience`'s `createBackoff` (linear strategy, `jitterRatio` 0.5)
instead of an inlined formula. This is **behaviour-preserving**: the resilience
linear schedule is `attempt * retryDelay + random() * (0.5 * retryDelay)` —
identical to the schedule the client has always used — and its default
randomness source calls `Math.random()`, so timing and jitter are unchanged and
existing jitter tests pass unmodified.

This adds `@centient/resilience` as the SDK's first intra-monorepo `@centient`
dependency (`workspace:*`). It is an internal composition — resilience exists
precisely so the SDK consumes it — and does not add any **external** runtime
dependency. The public surface is otherwise unchanged (the `isRetryableError`
export is purely additive).
