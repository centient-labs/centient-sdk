---
"@centient/sdk": patch
---

Harden `events.subscribeWithFetch` error handling: the void-launched SSE read loop can no longer produce an unhandled rejection (a throwing `onError` is swallowed after recording via a last-resort guard), every exit path now releases the stream reader (`finally` + `reader.cancel()`), a throwing `onEvent` now reaches `onError` as the actual consumer error (previously mislabeled as a malformed SSE frame) and closes the subscription, and `close()` after a failure stays idempotent.
