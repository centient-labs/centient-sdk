/**
 * WAL Replay — Idempotent Replay of Unconfirmed Entries
 *
 * After a crash or restart, reads the WAL and replays any entries that were
 * never confirmed (i.e., the operation was logged but not completed).
 * Each entry is replayed via a caller-provided executor. On success the entry
 * is confirmed in the WAL so it will not be replayed again.
 *
 * Idempotency contract: the executor MUST be idempotent — replaying the same
 * operationId twice must produce the same result without side-effect duplication.
 */

import { readEntries, confirmEntry, compactWal } from "./wal.js";
import type { WALEntry, WALCompactResult } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of executing a single WAL entry during replay. */
export interface ReplayEntryResult {
  operationId: string;
  /** Whether the executor succeeded and the entry was confirmed. */
  success: boolean;
  /** True if the entry was already confirmed (skipped). */
  skipped: boolean;
  /** Error message if the executor or confirmation failed. */
  error?: string;
}

/** Summary returned after replaying all unconfirmed entries. */
export interface ReplayResult {
  success: boolean;
  /** Total entries found in the WAL (confirmed + unconfirmed). */
  totalEntries: number;
  /** Entries that were unconfirmed and needed replay. */
  unconfirmedCount: number;
  /** Entries successfully replayed and confirmed. */
  replayedCount: number;
  /** Entries that failed replay. */
  failedCount: number;
  /** Per-entry results. */
  results: ReplayEntryResult[];
  /** Top-level error if the WAL could not be read at all. */
  error?: string;
}

/**
 * Executor callback invoked for each unconfirmed WAL entry during replay.
 *
 * The executor receives the full WALEntry and must perform the operation
 * that the entry represents. It must be idempotent: if the operation was
 * partially completed before the crash, re-executing it should not produce
 * duplicates.
 *
 * Return `true` on success, `false` on failure. Throwing is also treated as
 * failure — the error message is captured in the replay result.
 */
export type WALExecutor = (entry: WALEntry) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Replay all unconfirmed WAL entries in chronological order.
 *
 * For each unconfirmed entry:
 * 1. Call the executor with the entry
 * 2. If the executor returns `true`, confirm the entry in the WAL
 * 3. If the executor returns `false` or throws, record the failure and continue
 *
 * Entries are replayed in the order they were written (oldest first). The WAL
 * is append-only, so file order equals chronological order.
 *
 * Replay is best-effort: a failure on one entry does not abort the remaining
 * entries. This allows partial recovery — entries that can succeed will be
 * confirmed, and only truly broken entries remain unconfirmed for investigation.
 *
 * @param walPath - Full path to the WAL file
 * @param executor - Callback that replays a single entry (must be idempotent)
 * @returns Summary of the replay operation
 */
export async function replayUnconfirmed(
  walPath: string,
  executor: WALExecutor,
): Promise<ReplayResult> {
  const readResult = await readEntries(walPath);
  if (!readResult.success) {
    return {
      success: false,
      totalEntries: 0,
      unconfirmedCount: 0,
      replayedCount: 0,
      failedCount: 0,
      results: [],
      error: readResult.error,
    };
  }

  const allEntries = readResult.entries;
  const unconfirmed = allEntries.filter((e) => !e.confirmed);
  const entryResults: ReplayEntryResult[] = [];
  let replayedCount = 0;
  let failedCount = 0;

  for (const entry of unconfirmed) {
    const result = await replayEntry(walPath, entry, executor);
    entryResults.push(result);
    if (result.success) {
      replayedCount++;
    } else {
      failedCount++;
    }
  }

  return {
    success: failedCount === 0,
    totalEntries: allEntries.length,
    unconfirmedCount: unconfirmed.length,
    replayedCount,
    failedCount,
    results: entryResults,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Replay a single WAL entry: execute then confirm.
 *
 * Separated for clarity. Catches executor errors so that one failing entry
 * does not prevent replay of subsequent entries.
 */
async function replayEntry(
  walPath: string,
  entry: WALEntry,
  executor: WALExecutor,
): Promise<ReplayEntryResult> {
  const { operationId } = entry;

  // Step 1: Execute
  let executorSucceeded: boolean;
  try {
    executorSucceeded = await executor(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      operationId,
      success: false,
      skipped: false,
      error: `Executor failed: ${message}`,
    };
  }

  if (!executorSucceeded) {
    return {
      operationId,
      success: false,
      skipped: false,
      error: "Executor returned false",
    };
  }

  // Step 2: Confirm
  const confirmResult = await confirmEntry(walPath, operationId);
  if (!confirmResult.success) {
    return {
      operationId,
      success: false,
      skipped: false,
      error: `Executor succeeded but confirm failed: ${confirmResult.error}`,
    };
  }

  return { operationId, success: true, skipped: false };
}

// ---------------------------------------------------------------------------
// Replay + Compact
// ---------------------------------------------------------------------------

/** Result of replaying and then compacting the WAL. */
export interface ReplayAndCompactResult {
  replay: ReplayResult;
  compact: WALCompactResult;
}

/**
 * Replay all unconfirmed entries and then compact the WAL file.
 *
 * This is a convenience function that combines `replayUnconfirmed` and
 * `compactWal` into a single operation. After replay, confirmed entries
 * are removed from the WAL file to reduce its size.
 *
 * This avoids the O(N^2) pattern of N individual confirmations (each of which
 * rewrites the file) followed by a separate compaction pass. Instead, the
 * compaction runs once after all replays complete.
 *
 * @param walPath - Full path to the WAL file
 * @param executor - Callback that replays a single entry (must be idempotent)
 * @returns Combined replay and compaction results
 */
export async function replayAndCompact(
  walPath: string,
  executor: WALExecutor,
): Promise<ReplayAndCompactResult> {
  const replay = await replayUnconfirmed(walPath, executor);

  const compact = await compactWal(walPath);

  return { replay, compact };
}
