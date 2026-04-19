---
"@centient/events": patch
---

Harden JSONL subscriber and follow-mode reader against silent degradation (P2):

- **JSONL subscriber**: `onEvent` now catches `JSON.stringify` failures (circular refs, BigInt, etc.) and drops the single offending event instead of letting the exception escape and crash the subscriber. `onClose` performs a best-effort final flush so events buffered since the last interval tick aren't lost when a stream closes quickly; callers needing a durability guarantee should still await the returned `flush()` function.
- **Follow-mode reader**: `init()` is now single-flight — concurrent `next()` calls at cold start share one init attempt, preventing a race that could leak file handles and watchers from the loser.
- **Follow-mode reader**: lines exceeding `MAX_LINE_BYTES` (1 MiB) now surface as an iterator error instead of being silently discarded.
- **README**: removed the `"block"` backpressure policy row from the `BackpressurePolicy` table — the policy was removed from the types but left in docs.
