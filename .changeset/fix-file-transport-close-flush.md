---
"@centient/logger": patch
---

Fix `FileTransport.close()` dropping buffered entries and harden the close path against in-flight failures.

The original bug: `close()` set `this.closed = true` before calling `flushSync()`. Because `flushSync()` early-returns when `this.closed` is true, any entry still in the in-memory buffer at close time was silently discarded. Masked in practice by call sites pairing `await transport.flush(); await transport.close();`. The fix flushes before marking closed, and adds a regression test that calls `close()` without a prior `flush()`.

Additional hardening for the close path:
- Wait for in-flight rotation in a try/catch so a rotation rejection cannot leave the transport in a half-open zombie state with `this.closing` pinned to a permanently-rejected promise.
- Reset `this.closing = null` after `_doClose()` settles so a failed close attempt does not pin a rejected promise on the instance.
- Add a reject path to the `writeStream.end()` Promise so a stream error during finalization cannot leave the close awaiter pending forever.
- Preserve the buffer on a throwing `writeStream.write()` (write before clearing) so entries are not silently dropped.

New regression tests cover the rotation-rejection path and assert `writeStream === null` after the flush-throw cleanup.
