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

import { readEntries, confirmEntry, compactWal, appendEntry } from "./wal.js";
import { createComponentLogger } from "@centient/logger";
import type {
  WALEntry,
  ReplayOptions,
  DeadLetterPayload,
  ReplayEntryResult,
  ReplayResult,
  ReplayAndCompactResult,
  WALExecutor,
} from "./types.js";

const logger = createComponentLogger("engram", "wal-replay");

// ---------------------------------------------------------------------------
// Retry Tracking (Module-Level)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 5;
/** Minimum allowed value for maxRetries (values below are clamped up). */
const RETRY_FLOOR = 1;
/** Maximum allowed value for maxRetries (values above are clamped down). */
const RETRY_CEILING = 100;

/**
 * Module-level retry counts keyed by operationId.
 *
 * Must persist across `replayUnconfirmed()` calls because each call typically
 * processes every failing entry once. A per-call Map would never reach the cap.
 *
 * Note: retry counts reset on process restart. Dead-lettering is the only
 * mechanism that prevents indefinite retries across restarts.
 */
const walRetryCounts = new Map<string, number>();

/**
 * Reset all retry counts.
 *
 * @internal — Test isolation only. Do NOT call in production.
 * Resets all failure history, which could allow entries that have already
 * exceeded maxRetries to bypass dead-lettering on the next replay call.
 */
export function clearRetryCounts(): void {
  walRetryCounts.clear();
}

/**
 * Resolve the effective maxRetries value.
 *
 * Priority: `options.maxRetries` > `WAL_MAX_RETRIES` env var > default (5).
 * Result is clamped to [RETRY_FLOOR, RETRY_CEILING].
 */
function resolveMaxRetries(options?: ReplayOptions): number {
  if (options?.maxRetries !== undefined) {
    return Math.max(RETRY_FLOOR, Math.min(RETRY_CEILING, options.maxRetries));
  }
  const envVal = process.env["WAL_MAX_RETRIES"];
  if (envVal !== undefined) {
    const parsed = Number(envVal);
    if (Number.isInteger(parsed)) {
      return Math.max(RETRY_FLOOR, Math.min(RETRY_CEILING, parsed));
    }
    logger.warn({ envValue: envVal }, "WAL_MAX_RETRIES is not a valid integer, using default");
  }
  return DEFAULT_MAX_RETRIES;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Replay all unconfirmed WAL entries in chronological order.
 *
 * For each unconfirmed entry:
 * 1. Call the executor with the entry
 * 2. If the executor returns `true`, confirm the entry in the WAL
 * 3. If the executor returns `false` or throws, increment the retry count.
 *    Once the count reaches `maxRetries`, dead-letter the entry.
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
 * @param options - Optional replay settings (maxRetries for dead-letter cap)
 * @returns Summary of the replay operation
 */
export async function replayUnconfirmed(
  walPath: string,
  executor: WALExecutor,
  options?: ReplayOptions,
): Promise<ReplayResult> {
  const readResult = await readEntries(walPath);
  if (!readResult.success) {
    logger.error({ walPath, error: readResult.error }, "WAL replay aborted: could not read WAL");
    return {
      success: false,
      totalEntries: 0,
      unconfirmedCount: 0,
      replayedCount: 0,
      failedCount: 0,
      deadLetteredCount: 0,
      results: [],
      error: readResult.error,
    };
  }

  const maxRetries = resolveMaxRetries(options);
  const allEntries = readResult.entries;
  const unconfirmed = allEntries.filter((e) => !e.confirmed);
  const entryResults: ReplayEntryResult[] = [];
  let replayedCount = 0;
  let failedCount = 0;
  let deadLetteredCount = 0;

  for (const entry of unconfirmed) {
    const result = await replayEntry(walPath, entry, executor, maxRetries);
    entryResults.push(result);
    if (result.deadLettered) {
      deadLetteredCount++;
    } else if (result.success) {
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
    deadLetteredCount,
    results: entryResults,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Replay a single WAL entry: execute then confirm, or dead-letter on
 * repeated failure.
 *
 * Catches executor errors so that one failing entry does not prevent
 * replay of subsequent entries. Tracks cumulative retry counts in the
 * module-level `walRetryCounts` map so the cap persists across calls.
 */
async function replayEntry(
  walPath: string,
  entry: WALEntry,
  executor: WALExecutor,
  maxRetries: number,
): Promise<ReplayEntryResult> {
  const { operationId } = entry;

  // Step 1: Execute
  let executorSucceeded: boolean;
  let errorMessage: string | undefined;
  try {
    executorSucceeded = await executor(entry);
    if (!executorSucceeded) {
      errorMessage = "Executor returned false";
    }
  } catch (err: unknown) {
    executorSucceeded = false;
    errorMessage = `Executor failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 2a: Success — confirm and clear retry count
  if (executorSucceeded) {
    const confirmResult = await confirmEntry(walPath, operationId);
    if (!confirmResult.success) {
      return {
        operationId,
        success: false,
        skipped: false,
        deadLettered: false,
        error: `Executor succeeded but confirm failed: ${confirmResult.error}`,
      };
    }
    walRetryCounts.delete(operationId);
    logger.debug({ walPath, operationId, type: entry.type, scopeId: entry.scopeId }, "WAL entry replayed and confirmed");
    return { operationId, success: true, skipped: false, deadLettered: false };
  }

  // Step 2b: Failure — increment retry count, maybe dead-letter
  const retryCount = (walRetryCounts.get(operationId) ?? 0) + 1;
  walRetryCounts.set(operationId, retryCount);

  if (retryCount >= maxRetries) {
    // Dead-letter: confirm the original, then append a dead_letter record.
    // If we crash between confirm and append, the entry stays confirmed
    // (no re-replay) but no dead-letter record is written — a silent loss,
    // but no duplicate execution occurs.
    const confirmResult = await confirmEntry(walPath, operationId);
    if (!confirmResult.success) {
      logger.error({ walPath, operationId, error: confirmResult.error }, "Dead-letter confirm failed");
      return {
        operationId,
        success: false,
        skipped: false,
        deadLettered: false,
        error: `Dead-letter confirm failed: ${confirmResult.error}`,
      };
    }

    const deadLetterPayload: DeadLetterPayload = {
      originalOperationId: operationId,
      originalType: entry.type,
      failureCount: retryCount,
      lastError: errorMessage,
      deadLetteredAt: new Date().toISOString(),
    };

    const appendResult = await appendEntry(walPath, {
      type: "dead_letter",
      scopeId: entry.scopeId,
      stage: entry.stage,
      phase: entry.phase,
      payload: deadLetterPayload,
    }, { autoConfirm: true });

    if (!appendResult.success) {
      logger.error({ walPath, operationId, error: appendResult.error }, "Dead-letter append failed");
      // Original is already confirmed — return failure so caller knows
      // the dead-letter record was not written
      return {
        operationId,
        success: false,
        skipped: false,
        deadLettered: false,
        error: `Dead-letter append failed: ${appendResult.error}`,
      };
    }

    walRetryCounts.delete(operationId);

    logger.error(
      { walPath, operationId, type: entry.type, scopeId: entry.scopeId, failureCount: retryCount, error: errorMessage },
      "WAL entry dead-lettered after max retries",
    );

    return {
      operationId,
      success: false,
      skipped: false,
      deadLettered: true,
      error: `Dead-lettered after ${retryCount} failures: ${errorMessage}`,
    };
  }

  logger.warn(
    { walPath, operationId, type: entry.type, scopeId: entry.scopeId, retryCount, error: errorMessage },
    "WAL entry replay failed, will retry",
  );

  return {
    operationId,
    success: false,
    skipped: false,
    deadLettered: false,
    error: errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Replay + Compact
// ---------------------------------------------------------------------------

/**
 * Replay all unconfirmed entries and then compact the WAL file.
 *
 * This is a convenience function that combines `replayUnconfirmed` and
 * `compactWal` into a single operation. After replay, confirmed entries
 * (including dead-letter records) are removed from the WAL file.
 *
 * If replay fails to read the WAL, compaction is skipped.
 *
 * @param walPath - Full path to the WAL file
 * @param executor - Callback that replays a single entry (must be idempotent)
 * @param options - Optional replay settings (maxRetries for dead-letter cap)
 * @returns Combined replay and compaction results
 */
export async function replayAndCompact(
  walPath: string,
  executor: WALExecutor,
  options?: ReplayOptions,
): Promise<ReplayAndCompactResult> {
  const replay = await replayUnconfirmed(walPath, executor, options);

  // Short-circuit compaction if we couldn't even read the WAL
  if (replay.error && replay.totalEntries === 0) {
    return {
      replay,
      compact: { success: false, removed: 0, remaining: 0, error: "Skipped: replay failed" },
    };
  }

  const compact = await compactWal(walPath);

  logger.info(
    { walPath, replayedCount: replay.replayedCount, failedCount: replay.failedCount, deadLetteredCount: replay.deadLetteredCount, compactRemoved: compact.removed },
    "WAL replay and compact complete",
  );

  return { replay, compact };
}
