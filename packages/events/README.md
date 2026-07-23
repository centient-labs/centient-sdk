# @centient/events

Typed event streaming with backpressure for Node.js. AsyncIterable fan-out, JSONL persistence, configurable backpressure, and live replay.

## Installation

```bash
pnpm add @centient/events
```

## Quick Start

```typescript
import { createEventStream } from "@centient/events";

type AppEvent = { type: "user:login"; userId: string } | { type: "order:placed"; orderId: string };

const stream = createEventStream<AppEvent>();

const events = stream.subscribe();
(async () => {
  for await (const event of events) {
    console.log(event.type, event);
  }
})();

stream.emit({ type: "user:login", userId: "u-1" });
stream.emit({ type: "order:placed", orderId: "ord-42" });

await stream.close();
```

## API

### `createEventStream<T>(opts?)`

```typescript
const stream = createEventStream<MyEvent>({
  backpressure: "drop-oldest", // default
  defaultBufferSize: 1000,     // default
  rotation: undefined,         // default — JSONL rotation off
});
```

Returns an `EventStream<T>`.

### `EventStream<T>`

| Member | Signature | Description |
|--------|-----------|-------------|
| `emit` | `(event: T) => void` | Deliver an event to all subscribers |
| `subscribe` | `(opts?: SubscribeOptions<T>) => AsyncIterable<T>` | AsyncIterable for `for await...of` consumption |
| `tee` | `(name: string, subscriber: EventSubscriber<T>) => () => void` | Add a named callback subscriber; returns a dispose function |
| `jsonl` | `(filePath: string, opts?: JsonlSubscriberOptions) => () => void` | Persist events to a JSONL file; returns a dispose function |
| `subscriberCount` | `readonly number` | Active subscriber count (AsyncIterable + tee'd) |
| `close` | `() => Promise<void>` | Flush, signal completion, and clean up all subscribers |

### `SubscribeOptions<T>`

| Option | Type | Description |
|--------|------|-------------|
| `bufferSize` | `number` | Override the per-subscriber buffer capacity |
| `filter` | `(event: T) => boolean` | Only deliver events that pass this predicate |

### `BackpressurePolicy`

| Value | Behavior |
|-------|----------|
| `"drop-oldest"` | Drop the oldest buffered event to make room (default) |
| `"drop-newest"` | Reject the incoming event; keep the buffer intact |

### `EventSubscriber<T>`

Callback-based subscriber for use with `tee()`.

```typescript
interface EventSubscriber<T> {
  name: string;
  onEvent(event: T): void | Promise<void>;
  onError?(error: Error): void;
  onClose?(): void;
}
```

#### `onEvent()` contract: callbacks must not block

A tee'd subscriber's `onEvent()` is invoked **synchronously inside the `emit()`
call** as fire-and-forget — `emit()` does not await it. Two consequences follow,
and **callbacks must not block**:

- A **synchronously blocking** `onEvent()` (a long CPU loop, a sync filesystem
  call) stalls the emit loop itself: it delays delivery to *every other*
  subscriber of that event, because `emit()` walks subscribers in order on the
  caller's stack. Keep synchronous work trivial.
- An **async** `onEvent()` (one that returns a `Promise`) is *not* awaited by
  `emit()`; the stream fires it and moves on. A slow async consumer therefore
  does **not** apply backpressure to the callback (`tee()`) path — there is no
  per-callback buffer to fill — but if it falls behind it accumulates unsettled
  promises with no bound. If you need bounded, backpressure-respecting delivery,
  consume via `subscribe()` (the AsyncIterable path) instead of `tee()`.

**Which backpressure policy applies to callback fan-out:** none. The configured
`BackpressurePolicy` (`drop-oldest` / `drop-newest`) governs only the
**per-subscriber buffers of `subscribe()` AsyncIterable consumers** — when an
iterable consumer's buffer fills, the policy decides which event to drop. The
`tee()` callback path has no buffer and is never subject to that policy; events
are pushed to `onEvent()` immediately and unconditionally. The contract that
keeps this safe is the one above: do not block in `onEvent()`.

**Why this is a contract, not a runtime guard.** `emit()` does not time, wrap,
or timeout your `onEvent()` — the contract is enforced by convention, not by the
library. This is deliberate: instrumenting the synchronous fan-out (clock reads
or timeout wrappers around every callback) would add per-event overhead to the
exact path whose value is being unbuffered, allocation-free, and immediate, and
a wall-clock threshold cannot distinguish a legitimately slow consumer from a
buggy one without producing false positives. The library therefore gives you a
**structural** escape hatch instead of a runtime one: if you cannot guarantee a
non-blocking callback, do not use `tee()` — consume via `subscribe()`, whose
AsyncIterable buffer makes a slow consumer's backpressure explicit and bounded
(and subject to the `BackpressurePolicy` above). Treat a blocking `onEvent()` as
a programming error caught in review, the same way you would a blocking handler
in any synchronous emitter.

### `defineEvent<T, P>(type)`

Create a typed event envelope factory for a given discriminant string. Timestamps are auto-generated (ISO 8601).

```typescript
import { defineEvent } from "@centient/events";
import type { EventEnvelope } from "@centient/events";

const blockStarted = defineEvent<"block:started", { blockPath: string }>("block:started");
const event = blockStarted({ blockPath: "implement/auth" });
// => { type: "block:started", timestamp: "2026-...", payload: { blockPath: "implement/auth" } }
```

### `fromJsonl<T>(path, opts?)`

Read events from a JSONL file as an `AsyncIterable`. Replays logs written by `stream.jsonl()`.

```typescript
import { fromJsonl } from "@centient/events";

// One-shot replay
for await (const event of fromJsonl<MyEvent>("/var/log/events.jsonl")) { ... }

// Live tail (like tail -f)
for await (const event of fromJsonl<MyEvent>("/var/log/events.jsonl", { follow: true })) { ... }
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `follow` | `boolean` | `false` | Continue watching after EOF (live tail mode) |
| `keepMeta` | `boolean` | `false` | Keep the `_ts` metadata field in emitted events |

### `createJsonlSubscriber<T>(filePath, opts?)`

Standalone JSONL file subscriber factory. Returns `{ subscriber, flush }` for use with `stream.tee()` when manual lifecycle control is needed.

```typescript
import { createJsonlSubscriber } from "@centient/events";

const { subscriber, flush } = createJsonlSubscriber<MyEvent>("/var/log/events.jsonl");
const dispose = stream.tee("my-log", subscriber);
await flush();
dispose();
```

Writes are buffered (flushed every 100 ms or every 100 events, whichever comes first). `stream.jsonl(filePath, opts)` is a convenience wrapper around this.

#### `JsonlSubscriberOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | `EventsLogger` | `centient:events:jsonl` | Write/serialization/flush/rotation diagnostics |
| `rotation` | `JsonlRotationOptions` | *(off)* | Size-based log rotation — see below |
| `clock` | `() => Date` | `() => new Date()` | Source of the `_ts` stamp and of rotated file names |

## Log rotation

JSONL logs grow without bound by default — a 601 MB un-rotated event log is what
prompted this option ([#132](https://github.com/centient-labs/centient-sdk/issues/132)).
Pass `rotation` to bound it:

```typescript
const stream = createEventStream<MyEvent>({
  rotation: { maxSizeBytes: 100 * 1024 * 1024, maxFiles: 5 },
});
stream.jsonl("/var/log/maintainer.jsonl");

// Or per subscriber:
createJsonlSubscriber<MyEvent>("/var/log/maintainer.jsonl", {
  rotation: {},  // an empty object means "rotate, with the defaults"
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSizeBytes` | `number` | `104857600` (100 MiB) | Rotate once the file has reached this size |
| `maxFiles` | `number` | `5` | Rotated files retained; `0` means rotate and discard |

**Off by default.** Omitting `rotation` leaves the log un-rotated, exactly as
before this option existed. A per-call `jsonl(path, { rotation })` overrides
`EventStreamOptions.rotation`; invalid settings throw a `TypeError` at
construction rather than being silently clamped.

How it works:

- **Rename, not copy-truncate.** The subscriber holds no persistent file
  descriptor — every flush is a discrete `O_APPEND` `appendFile`. A rename is
  therefore race-free: a flush that opened the file before the rename lands its
  whole lines in the rotated file, and the next flush recreates the canonical
  path. Copy-truncate would lose every line written in its copy→truncate window.
- **Checked at a flush boundary**, immediately before the append — so no
  periodic timer is needed and a batch of lines is never split across two files.
  The live file is bounded at `maxSizeBytes` plus at most one flush's worth of
  lines.
- **Boot-time rotation.** A file left oversized by a previous process rotates
  before this subscriber's first append, not after another `maxSizeBytes` of
  growth.
- **Rotated names** are `<file>.<UTC stamp>`, e.g.
  `maintainer.jsonl.2026-07-02T10-15-30-123Z`, with a `-N` suffix if that name
  is already taken.
- **Retention is anchored to that exact shape.** Only names matching
  `<basename>.<stamp>[-N]` end to end are ever deleted, so operator-made
  siblings (`maintainer.jsonl.old`, `maintainer.jsonl.1`, a hand-renamed
  `2026.06.13.maintainer.jsonl`) are never swept.
- **Failures are logged, never thrown.** A full disk or a read-only directory
  surfaces as a `warn` on the subscriber's logger and the stream keeps running —
  rotation is hygiene, and losing the event stream over it would be worse.

Trade-off: a reader tailing the canonical path (`fromJsonl(path, { follow: true })`)
sees the stream restart at the rotation point; earlier events live in the rotated
sibling.

## Examples

### Subscribe with filter

```typescript
const stream = createEventStream<AppEvent>();

const logins = stream.subscribe({
  filter: (e) => e.type === "user:login",
});

for await (const event of logins) {
  console.log("login:", event.userId);
}
```

### JSONL persistence and replay

```typescript
import { createEventStream, fromJsonl } from "@centient/events";

const LOG = "/var/log/app-events.jsonl";
const stream = createEventStream<AppEvent>();

const stopLogging = stream.jsonl(LOG);
stream.emit({ type: "user:login", userId: "u-1" });
await stream.close();

// Replay on next startup
for await (const event of fromJsonl<AppEvent>(LOG)) {
  console.log("replaying:", event);
}
```

### Typed event envelopes

```typescript
import { createEventStream, defineEvent } from "@centient/events";
import type { EventEnvelope } from "@centient/events";

type BlockEvent =
  | EventEnvelope<"block:started", { blockPath: string }>
  | EventEnvelope<"block:completed", { blockPath: string; durationMs: number }>;

const blockStarted = defineEvent<"block:started", { blockPath: string }>("block:started");
const blockCompleted = defineEvent<"block:completed", { blockPath: string; durationMs: number }>("block:completed");

const stream = createEventStream<BlockEvent>();
stream.emit(blockStarted({ blockPath: "implement/auth" }));
stream.emit(blockCompleted({ blockPath: "implement/auth", durationMs: 3200 }));
```

## Logger injection

`createEventStream()`, `fromJsonl()`, and `createJsonlSubscriber()` emit internal
diagnostics (backpressure drops, closed-stream calls, JSONL write/serialization
errors, malformed-line skips). By default these route to a `@centient/logger`
component logger, so omitting the option keeps the pre-injection behavior.

To route event-internal logging to your own logger, pass a `logger` matching the
structural `EventsLogger` interface (`debug`/`info`/`warn`/`error`, each accepting
either `(context, message)` or `(message)`). A `@centient/logger` `Logger`
satisfies it directly:

```ts
import { createEventStream, type EventsLogger } from "@centient/events";
import { createLogger } from "@centient/logger";

const logger = createLogger({ service: "my-app" });

// A @centient/logger Logger is a valid EventsLogger — inject it directly.
const stream = createEventStream<MyEvent>({ logger });

// Or supply any object with the same shape:
const capture: EventsLogger = {
  debug: () => {},
  info: () => {},
  warn: (ctx, msg) => console.warn(msg, ctx),
  error: (ctx, msg) => console.error(msg, ctx),
};
const reader = fromJsonl<MyEvent>("./events.jsonl", { logger: capture });
```

## License

MIT
