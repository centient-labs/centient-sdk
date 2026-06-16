# @centient/wal

## 0.4.0

### Minor Changes

- fc21d4c: Add optional logger injection to the WAL entry points.

  `appendEntry`/`replayUnconfirmed`/`replayAndCompact` accept a `logger` in their options object, and `readEntries`/`confirmEntry`/`getUnconfirmedEntries`/`compactWal`/`cleanupOrphanedTempFiles` accept an optional trailing logger argument. The injected logger matches the new structural `WalLogger` interface (`debug`/`info`/`warn`/`error`, context-first or message-only — a `@centient/logger` `Logger` satisfies it directly). When omitted, the package still defaults to a `@centient/logger` component logger, so existing consumers see no behavior change. `clearRetryCounts()` is unchanged. Replay forwards its logger to the read/confirm/compact/append calls it drives, so all WAL-internal logging during a replay routes to the same logger.

  `cleanupOrphanedTempFiles()` now returns a `WALCleanupResult` (`{ success, removed, failures }`) instead of `void`. Per-file delete failures are no longer log-only — they are collected in `failures` and set `success: false`, so callers can detect e.g. a permissions problem that would otherwise leave stale temp files accumulating silently. The function remains best-effort and non-throwing; a missing directory still returns success. The new `WALCleanupResult`/`WALCleanupFailure` types are exported.

- 160abe1: Promote the WAL's internal atomic-write machinery to a documented public API: `atomicWrite(path, data, { fsync? })` and `atomicAppendLine(path, line, { fsync? })`, plus the `AtomicWriteOptions` type.

  `atomicWrite` uses temp-file-then-`rename(2)` for crash-consistency; with `{ fsync: true }` it fsyncs the temp file before the rename and the parent directory after it, so a confirmed write is durable. `atomicAppendLine` appends a single line via one `write(2)`, atomic for payloads up to `PIPE_BUF` (4096 bytes on Linux) — the boundary is documented in JSDoc and the README. To keep the single-line invariant from silently breaking, `atomicAppendLine` rejects (with a `TypeError`) a `line` that already contains a newline, validated before any filesystem mutation. No behavior change to existing entry points (`appendEntry`, `confirmEntry`, `compactWal`, …); the internal rewrite helper now delegates to `atomicWrite({ fsync: true })`.

## 0.3.3

### Patch Changes

- Updated dependencies [f1c25aa]
  - @centient/logger@0.17.1

## 0.3.2

### Patch Changes

- 6b39bf3: Bump `@centient/logger` dep to `^0.17.0`.

  Follow-up to `@centient/logger@0.17.0` (which dropped the reserved `version`
  context slot and stopped silently stripping user-supplied `version` fields).
  No WAL API changes; runtime logger calls inside `wal.ts` and `replay.ts`
  continue to work unchanged.

  Aligns the workspace at the 0.17.x logger boundary alongside
  `@centient/events`. Without this bump, downstream consumers that depend on
  both `@centient/wal` and `@centient/logger@^0.17.0` would end up with a
  split-version install (wal pulls in 0.16.1 alongside the caller's 0.17.x).

  Ref: centient-labs/centient-sdk#45.

## 0.3.1

### Patch Changes

- b3afec7: Add explicit `fsync` to the WAL durability path. The WAL's purpose is crash recovery, so a `success: true` return must mean the bytes are on disk — not buffered in the page cache where an immediate OS crash can lose them.

  - `appendEntry` now opens the WAL file with `O_APPEND`, writes the entry, calls `fh.sync()`, and closes the handle before returning success. The public API is unchanged.
  - `atomicWriteFile` (used by `confirmEntry` and `compactWal`) now `fsync`s the temp file before the `rename` commits it. Without this, an OS crash after the rename but before the temp file's data pages flushed would leave the target file pointing at an inode with stale content.

  No behavior change under normal operation; measurable only on crash scenarios.

- Updated dependencies [b3afec7]
  - @centient/logger@0.16.1

## 0.3.0

### Minor Changes

- 7caed2c: Add mutex serialization, atomic writes, dead-letter support, and auto-confirm

  - Per-path mutex serialization for confirmEntry and compactWal to prevent TOCTOU races
  - Atomic file writes via temp-file-then-rename for crash safety
  - Dead-letter support with configurable maxRetries and WAL_MAX_RETRIES env var
  - Auto-confirm option on appendEntry for fire-and-forget entries
  - cleanupOrphanedTempFiles() for startup cleanup with symlink protection
  - Structured logging throughout replay.ts
  - 63 tests covering all features, error paths, and edge cases
  - README.md with full API documentation

## 0.2.0

### Minor Changes

- f678c29: Initial public release of @centient/logger, @centient/sdk, and @centient/wal.
  Extracted from centient monorepo for independent versioning and npm publishing.

### Patch Changes

- Updated dependencies [f678c29]
  - @centient/logger@0.16.0
