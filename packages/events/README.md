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
});
```

Returns an `EventStream<T>`.

### `EventStream<T>`

| Member | Signature | Description |
|--------|-----------|-------------|
| `emit` | `(event: T) => void` | Deliver an event to all subscribers |
| `subscribe` | `(opts?: SubscribeOptions<T>) => AsyncIterable<T>` | AsyncIterable for `for await...of` consumption |
| `tee` | `(name: string, subscriber: EventSubscriber<T>) => () => void` | Add a named callback subscriber; returns a dispose function |
| `jsonl` | `(filePath: string) => () => void` | Persist events to a JSONL file; returns a dispose function |
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

### `createJsonlSubscriber<T>(filePath)`

Standalone JSONL file subscriber factory. Returns `{ subscriber, flush }` for use with `stream.tee()` when manual lifecycle control is needed.

```typescript
import { createJsonlSubscriber } from "@centient/events";

const { subscriber, flush } = createJsonlSubscriber<MyEvent>("/var/log/events.jsonl");
const dispose = stream.tee("my-log", subscriber);
await flush();
dispose();
```

Writes are buffered (flushed every 100 ms or every 100 events, whichever comes first). `stream.jsonl(filePath)` is a convenience wrapper around this.

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

## License

MIT
