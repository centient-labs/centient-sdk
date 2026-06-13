---
"@centient/wal": minor
---

Add optional logger injection to the WAL entry points.

`appendEntry`/`replayUnconfirmed`/`replayAndCompact` accept a `logger` in their options object, and `readEntries`/`confirmEntry`/`getUnconfirmedEntries`/`compactWal`/`cleanupOrphanedTempFiles` accept an optional trailing logger argument. The injected logger matches the new structural `WalLogger` interface (`debug`/`info`/`warn`/`error`, context-first or message-only — a `@centient/logger` `Logger` satisfies it directly). When omitted, the package still defaults to a `@centient/logger` component logger, so existing consumers see no behavior change. `clearRetryCounts()` is unchanged. Replay forwards its logger to the read/confirm/compact/append calls it drives, so all WAL-internal logging during a replay routes to the same logger.

`cleanupOrphanedTempFiles()` now returns a `WALCleanupResult` (`{ success, removed, failures }`) instead of `void`. Per-file delete failures are no longer log-only — they are collected in `failures` and set `success: false`, so callers can detect e.g. a permissions problem that would otherwise leave stale temp files accumulating silently. The function remains best-effort and non-throwing; a missing directory still returns success. The new `WALCleanupResult`/`WALCleanupFailure` types are exported.
