---
"@centient/sdk": minor
---

feat(sdk): injectable retry classifier + opt-in brownout taxonomy (#173)

The client's retry classification is now a constructor seam:

```typescript
const client = createEngramClient({ baseUrl, apiKey, shouldRetry: isBrownoutTransientError });
```

**The default is unchanged.** A client constructed without `shouldRetry`
classifies failures exactly as it did at 2.4.0 — 5xx and raw transport failures
retried; timeouts, 4xx, and deterministic shape failures terminal. No migration
is required.

Issue #116 §2 showed the default is inverted for a client riding out an engram
brownout: request **timeouts** (the dominant brownout transient) are terminal,
while **unknown** errors — which may be non-idempotent partial successes — are
replayed blind. Flipping that in a minor would make blind replay of a timed-out
`POST` the new default for every existing caller, so the taxonomy ships as an
opt-in and the flip is **deferred to the next major**.

New exports:

- `shouldRetry?: RetryPredicate` on `EngramClientConfig` — governs **every**
  request path (the response-site 5xx gate, the transport catch, and the request
  timeout), so no path can silently bypass an injected predicate.
- `isBrownoutTransientError` — the #116 taxonomy over the SDK's own error
  classes. Differs from the default on exactly two classes: timeouts are
  **retried**, unknown/generic errors are **not**. Prefer it over
  `@centient/resilience`'s `isTransientError` for this seam — the resilience
  preset is shape-based and reads `fetch`'s bare `TypeError` as unknown, so
  injecting it would stop retrying real network outages.
- `RetryPredicate` — the predicate type, structurally identical to
  `@centient/resilience`'s `ShouldRetry`.

Two invariants hold whatever predicate is injected: `retries` still caps the
attempt count (a predicate widens *which* failures are retried, never *how
many* times), and a deterministic response-shape failure (a non-JSON 2xx body)
is never re-issued.

Adopt `isBrownoutTransientError` only when every call the client makes is safe
to re-issue after a timeout — a `POST` that timed out may already have been
applied server-side.

**One behavioural delta at the default**, from routing all five request paths
through the one classifier: a *programming-error* constructor thrown inside the
request path (`ReferenceError` / `SyntaxError` / `RangeError` / `EvalError`, or
a non-`Error` throwable) is now terminal instead of being retried. The exported
`isRetryableError` already classified these as non-retryable; the transport
catch fell through to an unconditional retry and never asked it. Retrying a bug
could not have succeeded, so the fix only shortens the path to the same failure.
