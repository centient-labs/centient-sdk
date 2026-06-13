---
"@centient/wal": minor
---

Promote the WAL's internal atomic-write machinery to a documented public API: `atomicWrite(path, data, { fsync? })` and `atomicAppendLine(path, line, { fsync? })`, plus the `AtomicWriteOptions` type.

`atomicWrite` uses temp-file-then-`rename(2)` for crash-consistency; with `{ fsync: true }` it fsyncs the temp file before the rename and the parent directory after it, so a confirmed write is durable. `atomicAppendLine` appends a single line via one `write(2)`, atomic for payloads up to `PIPE_BUF` (4096 bytes on Linux) — the boundary is documented in JSDoc and the README. No behavior change to existing entry points (`appendEntry`, `confirmEntry`, `compactWal`, …); the internal rewrite helper now delegates to `atomicWrite({ fsync: true })`.
