/**
 * JSONL File Subscriber
 *
 * Appends events as newline-delimited JSON to a file. Each event is
 * wrapped in `{ _ts, event }` (ISO 8601 timestamp + original payload).
 *
 * Writes are buffered and flushed periodically (every 100ms or 100 events).
 * File writes use append mode — safe for concurrent reads (tail -f).
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { EventSubscriber } from "./types.js";
import { type EventsLogger, resolveLogger } from "./logging.js";

/** Options for {@link createJsonlSubscriber}. */
export interface JsonlSubscriberOptions {
  /**
   * Optional logger for write/serialization/flush diagnostics. Defaults to a
   * `@centient/logger` component logger (`centient:events:jsonl`), so omitting
   * it preserves the pre-injection behavior.
   */
  logger?: EventsLogger;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 100;
const FLUSH_BATCH_SIZE = 100;
const MAX_BUFFER_SIZE = FLUSH_BATCH_SIZE * 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorContext(err: unknown, filePath?: string): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  if (filePath !== undefined) ctx.filePath = filePath;
  return ctx;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JSONL file subscriber and its flush function.
 *
 * @param filePath - Path to the JSONL output file (created/appended)
 * @param options - Optional settings (inject a logger for write diagnostics)
 * @returns subscriber for use with `tee()`, and a `flush()` to drain the buffer.
 *   The returned `flush()` REJECTS if the underlying write fails (the failed
 *   lines are requeued for a later retry first), so callers that need a
 *   durability guarantee can `await flush()` and observe write failures instead
 *   of getting a silent success.
 */
export function createJsonlSubscriber<T>(
  filePath: string,
  options?: JsonlSubscriberOptions,
): {
  subscriber: EventSubscriber<T>;
  flush: () => Promise<void>;
} {
  const logger = resolveLogger(options?.logger, "events:jsonl");
  let buffer: string[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let dirCreated = false;
  let flushChain: Promise<void> = Promise.resolve();

  // -------------------------------------------------------------------------
  // Flush
  // -------------------------------------------------------------------------

  /**
   * Drain the buffer to disk. On write failure, the failed lines are requeued
   * (capped at {@link MAX_BUFFER_SIZE}) so a later flush can retry, the error
   * is logged, and the error is RE-THROWN. Re-throwing is what lets the public
   * `flush()` signal durability failures to callers that await it (the periodic
   * timer and eager batch paths catch-and-log instead — they are fire-and-forget
   * and must not crash the stream). Without the throw, an awaited `flush()` would
   * resolve successfully even when the bytes never reached disk.
   */
  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return;

    const lines = buffer;
    buffer = [];

    try {
      if (!dirCreated) {
        await mkdir(dirname(filePath), { recursive: true });
        dirCreated = true;
      }
      await appendFile(filePath, lines.join(""), "utf-8");
    } catch (err) {
      // Reset dirCreated if the directory was removed
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        dirCreated = false;
      }

      // Prepend failed lines back into the buffer for retry
      buffer = [...lines, ...buffer];

      // Cap buffer to prevent infinite growth
      if (buffer.length > MAX_BUFFER_SIZE) {
        const dropped = buffer.length - MAX_BUFFER_SIZE;
        buffer = buffer.slice(dropped);
        logger.warn({ filePath, droppedLines: dropped }, "JSONL buffer overflow, oldest lines dropped");
      }

      logger.error(errorContext(err, filePath), "JSONL write error");

      // Surface the failure to the awaiter. The lines are already requeued
      // above, so a caller that catches this and retries (or that simply
      // records the failure) loses no data.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Serialized flush. Returns a promise that rejects if the underlying write
   * failed (see {@link doFlush}). Fire-and-forget callers (timer, eager batch,
   * onClose) attach their own `.catch()` and log; durability-sensitive callers
   * `await` the returned promise and handle rejection.
   *
   * The chain is advanced through a non-throwing tail so one rejected flush does
   * not poison every subsequent flush on the chain — each caller still observes
   * the result of its own flush.
   */
  function flush(): Promise<void> {
    const result = flushChain.then(doFlush);
    // Keep the chain alive even if this flush rejects: subsequent flushes must
    // still run (the failed lines were requeued, not abandoned).
    flushChain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------

  function startTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      flush().catch((err) => {
        logger.error(errorContext(err, filePath), "JSONL periodic flush error");
      });
    }, FLUSH_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive
    if (typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref();
    }
  }

  function stopTimer(): void {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Subscriber
  // -------------------------------------------------------------------------

  const subscriber: EventSubscriber<T> = {
    onEvent(event: T): void {
      let line: string;
      try {
        line = JSON.stringify({ _ts: new Date().toISOString(), event }) + "\n";
      } catch (err) {
        // Circular refs, BigInt, etc. would crash the stream if we let this bubble.
        // Log and drop the single event; don't take down the subscriber.
        logger.error(errorContext(err, filePath), "JSONL serialization failed; event dropped");
        return;
      }
      buffer.push(line);
      if (!flushTimer) startTimer();

      // Flush eagerly if batch size reached
      if (buffer.length >= FLUSH_BATCH_SIZE) {
        flush().catch((err) => {
          logger.error(errorContext(err, filePath), "JSONL batch flush error");
        });
      }
    },

    onError(error: Error): void {
      logger.error({ filePath, error: error.message, stack: error.stack }, "JSONL subscriber received error");
    },

    onClose(): void {
      // Best-effort final flush so data buffered since the last interval tick isn't lost.
      // Fire-and-forget — callers needing a durability guarantee should await the returned flush().
      stopTimer();
      flush().catch((err) => {
        logger.error(errorContext(err, filePath), "JSONL close-time flush error");
      });
    },
  };

  logger.info({ filePath }, "JSONL subscriber created");

  return { subscriber, flush: async () => { stopTimer(); await flush(); } };
}
