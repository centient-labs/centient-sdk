# @centient/sdk

TypeScript SDK for Centient -- AI agent memory and context engineering infrastructure.

## Installation

```bash
npm install @centient/sdk
```

Or with pnpm:

```bash
pnpm add @centient/sdk
```

## Quick Start

```typescript
import { EngramClient, createEngramClient } from "@centient/sdk";

// Create client from environment variables
const client = createEngramClient();

// Or with explicit config
const client = new EngramClient({
  baseUrl: "http://localhost:3100",
  apiKey: "your-api-key",
});

// Create a session
const session = await client.createSession({
  sessionId: "2026-01-17-feature-work",
  projectPath: "/path/to/project",
  embeddingPreset: "balanced",
});

// Save notes
await client.createNote(session.id, {
  type: "decision",
  content: "Using PostgreSQL with RLS for multi-tenant data isolation",
});

// Search session memory
const results = await client.search(session.id, {
  query: "database security",
  limit: 5,
});
```

## Request logging

The client is **silent by default** — no console output, ever. To make
retries, exhausted retry budgets, and timeouts observable (e.g. when
diagnosing a hang vs. a retry storm), inject an optional `logger`:

```typescript
import { createEngramClient } from "@centient/sdk";
import { createLogger } from "@centient/logger";

const client = createEngramClient({
  logger: createLogger({ service: "my-agent" }),
});
```

`logger` is a minimal *structural* interface (`ClientLogger`): any object with
context-first `debug(context, message)` and `warn(context, message)` methods
works — a `@centient/logger` instance satisfies it directly, but
`@centient/logger` is **not** a runtime dependency of the SDK.

What gets logged:

- `debug` — each retry: attempt number, delay, error class, HTTP method + path
- `warn` — retries exhausted, and request timeouts (`TimeoutError`)

Everything is sanitized before it reaches the logger: HTTP method and
**pathname only**. Headers (`X-API-Key`, `Authorization`), request bodies,
query strings/fragments, and error messages (which can embed full URLs) are
never logged.

## Features

- 13+ resource classes covering sessions, notes, crystals, entities, search, and more
- 95+ fully typed request/response interfaces
- Factory function `createEngramClient()` for quick setup
- Session coordination (constraints, decision points, branches)
- Knowledge crystal management with hierarchy and versioning
- Entity extraction and graph queries
- Real-time event streaming
- Export/import with conflict resolution

## Real-time event streaming

The `events` resource subscribes to the server's `GET /events` SSE stream and
delivers parsed, typed `EngramEvent`s in two equivalent modes. Both send the
`X-API-Key` header correctly. Pick whichever fits your control flow.

### Pull mode — `subscribeIter()` (recommended)

An `AsyncIterable` you drive with `for await`. The Python SDK exposes the
symmetric `events.subscribe_iter` (`engram/resources/events.py`).

```typescript
const ac = new AbortController();

for await (const event of client.events.subscribeIter(
  ["crystal.created", "note.created"],
  { signal: ac.signal, highWaterMark: 512 }
)) {
  console.log(event.type, event.entity_id);
  if (shouldStop) break; // breaking out tears the subscription down
}
// ...or, from elsewhere: ac.abort() ends the loop cleanly.
```

Backpressure is **bounded, never silent**: if the server pushes events faster
than your loop drains them and the internal buffer exceeds `highWaterMark`
(default `1024`), the iterator throws `EventStreamOverflowError` instead of
dropping events. Consume faster, raise `highWaterMark`, or use the callback API.

### Push mode — `subscribeWithFetch()`

A callback subscription. Returns an `EventSubscription`; call `.close()` to stop.

```typescript
const sub = client.events.subscribeWithFetch(
  ["crystal.created"],
  (event) => console.log(event.type, event.entity_id),
  (err) => console.error("stream error", err)
);

// Later:
sub.close();
```

### Deprecated — `subscribe()` (EventSource)

`subscribe()` uses the `EventSource` API, which **cannot send the API key
header** — the key is silently dropped and authentication fails. It is
`@deprecated` and now **throws `InsecureEventSourceError` by default**; it is
reachable only with an explicit acknowledgement and only works against
unauthenticated endpoints. Prefer `subscribeIter()` or `subscribeWithFetch()`.

```typescript
// Throws InsecureEventSourceError:
client.events.subscribe(["crystal.created"], onEvent);

// Explicit opt-in (unauthenticated endpoints only):
client.events.subscribe(["crystal.created"], onEvent, onError, {
  allowInsecureEventSource: true,
});
```

## Documentation

- [Optimistic concurrency (CAS)](./docs/optimistic-concurrency.md) — using `expectedVersion` on `crystals.update` to prevent lost writes under concurrent mutation.
- [Skip-embedding optimization](./docs/skip-embedding.md) — using `skipEmbedding` on `crystals.update` to reclaim LLM compute on high-frequency status updates (heartbeats, counters, lock holders).
- [Full monorepo docs](https://github.com/centient-labs/centient-sdk) — architecture, ADRs, and cross-package guides.

## License

MIT
