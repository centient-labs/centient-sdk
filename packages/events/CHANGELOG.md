# @centient/events

## 0.3.0

### Minor Changes

- fc21d4c: Add optional logger injection to `createEventStream()`, `fromJsonl()`, and `createJsonlSubscriber()`.

  Each accepts a `logger` matching the new structural `EventsLogger` interface (`debug`/`info`/`warn`/`error`, context-first or message-only — a `@centient/logger` `Logger` satisfies it directly). When omitted, the package still defaults to a `@centient/logger` component logger, so existing consumers see no behavior change. The default logger is now constructed lazily behind a single injection point, and the structural interface lets consumers route event-internal diagnostics to their own logger instance.

  The JSONL subscriber's `flush()` now **rejects** when the underlying write fails (the failed lines are requeued for retry first), so callers awaiting `flush()` for a durability guarantee observe write failures instead of a silent success. Fire-and-forget paths (the periodic timer, eager batch flushes, and close-time flush) still catch-and-log and never crash the stream.

## 0.2.3

### Patch Changes

- Updated dependencies [f1c25aa]
  - @centient/logger@0.17.1

## 0.2.2

### Patch Changes

- 6b39bf3: Bump `@centient/logger` dep to `^0.17.0`.

  Follow-up to `@centient/logger@0.17.0` (which dropped the reserved `version`
  context slot and stopped silently stripping user-supplied `version` fields).
  No events API changes; runtime logger calls inside `jsonl.ts`, `replay.ts`,
  and `stream.ts` continue to work unchanged.

  Unblocks downstream `centient-labs/daemon#7` and any other consumer that
  imports both `@centient/events` and `@centient/logger` and wants to move
  to the 0.17.0 logger without a split-version install.

  Ref: centient-labs/centient-sdk#45.

## 0.2.1

### Patch Changes

- b3afec7: Harden JSONL subscriber and follow-mode reader against silent degradation (P2):

  - **JSONL subscriber**: `onEvent` now catches `JSON.stringify` failures (circular refs, BigInt, etc.) and drops the single offending event instead of letting the exception escape and crash the subscriber. `onClose` performs a best-effort final flush so events buffered since the last interval tick aren't lost when a stream closes quickly; callers needing a durability guarantee should still await the returned `flush()` function.
  - **Follow-mode reader**: `init()` is now single-flight — concurrent `next()` calls at cold start share one init attempt, preventing a race that could leak file handles and watchers from the loser.
  - **Follow-mode reader**: lines exceeding `MAX_LINE_BYTES` (1 MiB) now surface as an iterator error instead of being silently discarded.
  - **README**: removed the `"block"` backpressure policy row from the `BackpressurePolicy` table — the policy was removed from the types but left in docs.

- Updated dependencies [b3afec7]
  - @centient/logger@0.16.1

## 0.2.0

### Minor Changes

- 5eba377: Add @centient/events — typed event streaming with backpressure, JSONL persistence/replay, and subscribe filters
