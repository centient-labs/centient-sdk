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
```

> **No-auth daemons:** against a local engram daemon with auth disabled, omit
> `apiKey` entirely. The SDK only sends `X-API-Key` when `apiKey` is truthy —
> a no-auth daemon accepts key-less requests but rejects a provided
> placeholder/bogus key with 401.

```typescript
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

## Server availability

The SDK is a **thin client over the Engram Memory Server REST API**. It performs
**no graceful degradation**: there is no local cache, no offline queue, and no
fallback path. When engram-server is down, unreachable, or the network is
partitioned, **every call rejects** — you will see a thrown error (connection
refused, DNS failure, or a `TimeoutError`), not a degraded-but-successful result.

The client's only built-in resilience is its **retry policy**: 5xx and transient
network failures are retried with jittered backoff up to the configured attempt
cap. That policy is for *transient* faults — it does not paper over a server that
is genuinely down. Any retry, backoff, circuit-breaking, or fallback behavior
**beyond** the built-in retry budget is the **caller's responsibility**. Wrap
calls in your own error handling and decide, per call site, whether to retry,
surface the failure to the user, or fail the operation.

The retry **backoff** is powered by [`@centient/resilience`](../resilience)'s
`createBackoff` primitive (linear strategy, 0.5 jitter ratio) — the sleep before
retry *n* is `n * retryDelay` plus a random jitter in `[0, 0.5 * retryDelay)`.
This is the same schedule the SDK has always used; the math now lives in one
shared, deterministically-testable place.

### `isRetryableError(err)`

The SDK exports the same predicate it uses internally to decide whether a caught
error is worth re-issuing, so you do not have to hand-roll it by matching error
messages:

```typescript
import { isRetryableError } from "@centient/sdk";

try {
  await client.search(sessionId, { query });
} catch (err) {
  if (isRetryableError(err)) {
    // transient: a 5xx server error or a raw transport failure — safe to back
    // off and try again at the application layer.
  } else {
    throw err; // terminal: a timeout, a 4xx, or a deterministic shape/parse
               // failure — retrying cannot change the outcome.
  }
}
```

**Retryable** (`true`): a 5xx `EngramError`, or a raw transport `Error` (e.g. a
`fetch` `TypeError` / `ECONNREFUSED`). **Non-retryable** (`false`):
`TimeoutError`, `NetworkError`, `ResponseShapeError`, any 4xx `EngramError`, and
non-`Error` throwables.

## Runtime requirements

- **Node.js >= 20.0.0** (enforced via `engines.node` in `package.json`).
- The per-request **timeout** and **connection-establishment abort** are
  implemented with the global `fetch` API and `AbortController` /
  `AbortSignal` (`client.ts` — `new AbortController()` + `setTimeout(...abort)`).
  These are the WHATWG `fetch` semantics built into Node since the 18.x line;
  the SDK depends on them being present and standards-conformant, which is why
  the supported floor is stated explicitly rather than left implicit. Running on
  an older runtime, or one without a conformant global `fetch`/`AbortSignal`,
  is unsupported — timeouts and aborts will not behave as documented.

## engram-server compatibility

This SDK targets the [engram-server](https://github.com/centient-labs) REST API.
The client enforces a single **minimum server version** at connect time
(`MIN_SERVER_VERSION`, exported from the package); newer resources layer
**per-feature floors** on top of it — calling a feature against a server below
its floor 404s (the route does not exist yet), not a silent no-op.

| SDK area | Minimum engram-server | Notes |
|---|---|---|
| Client floor (all core resources) | **0.31.0** | `MIN_SERVER_VERSION`; checked by `client.checkCompatibility()`. |
| `maintenance.vacuum()`, `skipEmbedding` on `crystals.create()` | **0.34.0** | Needs the 0.34.0 `{success,data}` envelope realignment. |
| `shimmers` (`/v1/shimmers`) | **0.34.0** | Also requires the deployment to set `ENGRAM_SHIMMER_ENABLED=true`. |
| `consolidationEvents` (`/v1/consolidation-events`) | **0.41.0** | Public consolidation lifecycle (engram-server #938/#939); the two write actions (`consolidate`, `undo`) require a write-scoped key. |
| `invitations` (`/v1/invitations`) | **0.50.0** | ADR-044 invite/provisioning/connection lifecycle. The 3 redeem routes (`redeemPreview`, `accept`, `decline`) are public — call them from a client with no `apiKey`/`userId` (the token is the credential). `reveal.token` (create/resend) and `key.value` (accept) are one-time secrets, never re-fetchable. |
| `health()` / `healthDetailed()` / `healthReady()` union shapes | **0.50.0** | The three health routes return discriminated unions on `status`/`ready` (engram-server #1175), and BOTH 200 and 503 carry the typed body — the SDK resolves a health 503 with the parsed variant (degraded/unhealthy/not-ready) instead of throwing. Older servers return the flat pre-union shapes (e.g. `healthDetailed()`'s `{dependencies, circuitBreakers, rateLimiters}`, numeric `uptime`), which fail the union guards with `ResponseShapeError`; `healthReady()` needs the `/v1/health/ready` union route. `healthDetailed()`/`healthReady()` are auth-gated; `health()` is public. |
| Extraction previews (`extraction.bootstrapPreview()`, `extraction.dryRunPreview()`) | **0.50.0** | The `bootstrap`/`dryRun` mode flags on `POST /v1/extraction/extract` (engram-server #1167/#1174); write-scoped like the rest of the extraction surface. |
| `consolidationEvents.queue()` (`/v1/consolidations/queue`) | **0.50.0** | Per-note review-queue rows with composite + coherence/uniqueness/quality score breakdowns — distinct from the event list, which returns event-level aggregates. |
| `evidence` (`/v1/evidence`) | **0.47.0** | ADR-042 D3 append-only evidence series (engram-server #1035). Dedup-aware `append` (`append`/`get`/`listBySeries`/`listByEntity`/`listByDescriptor`); a same-`dedupKey`, differing-`bodyDigest` append throws `EvidenceDedupConflictError` (409, never last-write-wins). `seq` is a decimal string; `payload` is opaque JSONB. The `append` mutation requires a write-scoped key. |

**Tested range (@centient/sdk 2.1.x):** floor **0.31.0** → tested upper edge
**0.47.0** (centient's G3 integration gate). engram-server `main` is **0.49.1**;
versions between the tested upper edge and `main` are expected to work but are
not covered by the SDK's integration gate.

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
