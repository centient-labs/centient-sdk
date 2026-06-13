---
"@centient/sdk": minor
---

events: add `subscribeIter()` (AsyncIterable delivery) and harden the broken `subscribe()` path

## ⚠️ BREAKING-IN-SPIRIT — default behavior change to `events.subscribe()`

`events.subscribe()` (the `EventSource` path) **now throws
`InsecureEventSourceError` by default.** `EventSource` cannot send custom
request headers, so the API key was computed but never transmitted —
authentication silently failed against any authenticated endpoint (the
canonical "No Silent Degradation" defect). That path was already marked
`@deprecated` and documented broken, so this fixes a defect rather than removing
a working contract; it is shipped as **minor** for that reason, but the default
behavior change is flagged here prominently for the release procedure to
arbitrate (escalate to major if release policy requires). The legacy behavior
remains reachable, unauthenticated-only, behind an explicit opt-in:

```typescript
client.events.subscribe(types, onEvent, onError, { allowInsecureEventSource: true });
```

Removal of `subscribe()` is reserved for 3.0.

## Added — `events.subscribeIter()` (AsyncIterable delivery)

A pull-based counterpart to `subscribeWithFetch()`:

```typescript
for await (const event of client.events.subscribeIter(["crystal.created"], { signal })) {
  console.log(event.type, event.entity_id);
}
```

- Thin adapter over the existing hand-rolled SSE parser (push callback → pull
  iterator with a bounded internal queue). Zero new dependencies — does **not**
  import `@centient/events`.
- Sends `X-API-Key` correctly. Mirrors the Python SDK's `events.subscribe_iter`.
- Backpressure is **bounded, never silent**: if the consumer falls behind and
  the buffer exceeds `highWaterMark` (default `1024`), the iterator throws the
  new `EventStreamOverflowError` rather than dropping events.
- Aborting via `options.signal` (or `break`ing the `for await` loop) ends the
  iterator cleanly and releases the underlying stream.

## Added — error classes

- `InsecureEventSourceError` — thrown by `subscribe()` without the opt-in.
- `EventStreamOverflowError` — thrown on the `subscribeIter()` iterator on overflow.

Both are exported from the package barrel, alongside the new `SubscribeOptions`
and `SubscribeIterOptions` option types and the `EngramEventStream` return-type
alias for `subscribeIter()`.
