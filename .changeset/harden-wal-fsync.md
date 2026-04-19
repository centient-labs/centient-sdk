---
"@centient/wal": patch
---

Add explicit `fsync` to the WAL durability path. The WAL's purpose is crash recovery, so a `success: true` return must mean the bytes are on disk — not buffered in the page cache where an immediate OS crash can lose them.

- `appendEntry` now opens the WAL file with `O_APPEND`, writes the entry, calls `fh.sync()`, and closes the handle before returning success. The public API is unchanged.
- `atomicWriteFile` (used by `confirmEntry` and `compactWal`) now `fsync`s the temp file before the `rename` commits it. Without this, an OS crash after the rename but before the temp file's data pages flushed would leave the target file pointing at an inode with stale content.

No behavior change under normal operation; measurable only on crash scenarios.
