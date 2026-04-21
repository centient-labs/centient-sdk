---
"@centient/logger": patch
---

Fix `FileTransport.close()` dropping buffered entries.

`close()` previously set `this.closed = true` before calling `flushSync()`. Because `flushSync()` early-returns when `this.closed` is true, any entry still in the in-memory buffer at the time of close was silently discarded. Callers that wrote a handful of entries (fewer than `maxBufferSize`, so no size-triggered auto-flush) and then called `close()` without an intervening `flush()` would get an empty file.

In practice this was masked by every call site pairing `await transport.flush(); await transport.close();` — including the test suite. Surfacing the bug therefore required a test that calls `close()` on its own; adding one demonstrated the regression and this PR fixes it.

The fix swaps the two lines in `close()` so `flushSync()` runs before `closed` is set, and adds a regression test asserting a buffered entry lands on disk after a close-without-prior-flush.
