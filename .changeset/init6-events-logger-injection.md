---
"@centient/events": minor
---

Add optional logger injection to `createEventStream()`, `fromJsonl()`, and `createJsonlSubscriber()`.

Each accepts a `logger` matching the new structural `EventsLogger` interface (`debug`/`info`/`warn`/`error`, context-first or message-only — a `@centient/logger` `Logger` satisfies it directly). When omitted, the package still defaults to a `@centient/logger` component logger, so existing consumers see no behavior change. The default logger is now constructed lazily behind a single injection point, and the structural interface lets consumers route event-internal diagnostics to their own logger instance.

The JSONL subscriber's `flush()` now **rejects** when the underlying write fails (the failed lines are requeued for retry first), so callers awaiting `flush()` for a durability guarantee observe write failures instead of a silent success. Fire-and-forget paths (the periodic timer, eager batch flushes, and close-time flush) still catch-and-log and never crash the stream.
