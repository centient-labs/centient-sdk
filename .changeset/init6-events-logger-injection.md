---
"@centient/events": minor
---

Add optional logger injection to `createEventStream()`, `fromJsonl()`, and `createJsonlSubscriber()`.

Each accepts a `logger` matching the new structural `EventsLogger` interface (`debug`/`info`/`warn`/`error`, context-first or message-only — a `@centient/logger` `Logger` satisfies it directly). When omitted, the package still defaults to a `@centient/logger` component logger, so existing consumers see no behavior change. The default logger is now constructed lazily behind a single injection point, and the structural interface lets consumers route event-internal diagnostics to their own logger instance.
