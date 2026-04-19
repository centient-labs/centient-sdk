/**
 * JSONL Replay Reader
 *
 * Reads events from a JSONL file as an AsyncIterable, enabling replay
 * of persisted event logs. Supports both one-shot reads and live
 * tailing (follow mode) for real-time consumption.
 *
 * Usage:
 *   // Read completed file
 *   for await (const event of fromJsonl<MyEvent>("/path/to/events.jsonl")) { ... }
 *
 *   // Live tail (like tail -f)
 *   for await (const event of fromJsonl<MyEvent>("/path/to/events.jsonl", { follow: true })) { ... }
 */

import { createReadStream, type ReadStream } from "node:fs";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { watch, type FSWatcher } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

import { createComponentLogger } from "@centient/logger";

import type { FromJsonlOptions } from "./types.js";

const logger = createComponentLogger("centient", "events:replay");

/** Maximum line size before discarding (1 MB). */
const MAX_LINE_BYTES = 1_048_576;

/** Reusable read buffer size for follow mode (64 KB). */
const READ_BUFFER_SIZE = 65_536;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Read events from a JSONL file as an AsyncIterable.
 * Enables replay of persisted event logs written by `EventStream.jsonl()`.
 *
 * @param path - Path to the JSONL file
 * @param opts - Options (follow mode for live tailing, keepMeta to preserve `_ts`)
 * @returns AsyncIterable that yields parsed events
 */
export function fromJsonl<T>(path: string, opts?: FromJsonlOptions): AsyncIterable<T> {
  const follow = opts?.follow ?? false;
  const keepMeta = opts?.keepMeta ?? false;

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      if (follow) {
        return createFollowIterator<T>(path, keepMeta);
      }
      return createOneShotIterator<T>(path, keepMeta);
    },
  };
}

// ---------------------------------------------------------------------------
// One-Shot Reader (read to EOF, then done)
// ---------------------------------------------------------------------------

function createOneShotIterator<T>(path: string, keepMeta: boolean): AsyncIterator<T> {
  let stream: ReadStream | null = null;
  let rl: ReadlineInterface | null = null;
  const buffer: T[] = [];
  let done = false;
  let streamError: Error | null = null;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;
  let waitingReject: ((error: Error) => void) | null = null;

  function init(): void {
    stream = createReadStream(path, { encoding: "utf-8" });
    rl = createInterface({ input: stream, crlfDelay: Infinity });
    logger.info({ path }, "JSONL reader opened");

    rl.on("line", (line: string) => {
      const parsed = parseLine<T>(line, keepMeta, path);
      if (parsed === null) return;

      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: false, value: parsed });
      } else {
        buffer.push(parsed);
      }
    });

    rl.on("close", () => {
      done = true;
      stream = null;
      rl = null;
      logger.info({ path }, "JSONL reader closed");
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
    });

    rl.on("error", (err: Error) => {
      logger.error({ error: err.message, stack: err.stack, path }, "JSONL readline error");
      streamError = err;
      done = true;
      if (waitingReject) {
        const reject = waitingReject;
        waiting = null;
        waitingReject = null;
        reject(err);
      }
    });

    stream.on("error", (err: Error) => {
      logger.error({ error: err.message, stack: err.stack, path }, "JSONL read stream error");
      streamError = err;
      done = true;
      if (waitingReject) {
        const reject = waitingReject;
        waiting = null;
        waitingReject = null;
        reject(err);
      }
    });
  }

  return {
    next(): Promise<IteratorResult<T>> {
      if (!rl) init();

      // Return buffered item if available
      if (buffer.length > 0) {
        return Promise.resolve({ done: false, value: buffer.shift()! });
      }

      // If we've finished reading, signal done or propagate error
      if (done) {
        if (streamError) {
          const err = streamError;
          streamError = null;
          return Promise.reject(err);
        }
        return Promise.resolve({ done: true, value: undefined });
      }

      // Wait for the next line
      return new Promise<IteratorResult<T>>((resolve, reject) => {
        waiting = resolve;
        waitingReject = reject;
      });
    },

    return(): Promise<IteratorResult<T>> {
      done = true;
      try { rl?.close(); } catch (err) { logger.warn({ error: String(err) }, "cleanup error"); }
      try { stream?.destroy(); } catch (err) { logger.warn({ error: String(err) }, "cleanup error"); }
      rl = null;
      stream = null;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        waitingReject = null;
        resolve({ done: true, value: undefined });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}

// ---------------------------------------------------------------------------
// Follow Reader (tail -f mode)
// ---------------------------------------------------------------------------

function createFollowIterator<T>(path: string, keepMeta: boolean): AsyncIterator<T> {
  let fh: FileHandle | null = null;
  let watcher: FSWatcher | null = null;
  let offset = 0;
  let remainder = "";
  const buffer: T[] = [];
  let closed = false;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;
  let waitingReject: ((error: Error) => void) | null = null;
  let initPromise: Promise<void> | null = null;
  let initError: Error | null = null;
  let pendingError: Error | null = null;

  const readBuf = Buffer.allocUnsafe(READ_BUFFER_SIZE);

  function init(): Promise<void> {
    // Single-flight: concurrent next() calls share one init attempt and must not
    // both run the open()/watch() code path — doing so leaks the file handle and
    // watcher from whichever attempt loses the race.
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        fh = await open(path, "r");

        // Read initial content
        await readNewContent();

        // Watch for changes
        watcher = watch(path, () => {
          readNewContent().catch((err) => {
            logger.error(
              { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined, path },
              "follow mode read error",
            );
            closed = true;
            if (waiting) {
              const resolve = waiting;
              waiting = null;
              waitingReject = null;
              resolve({ done: true, value: undefined });
            }
          });
        });
        watcher.unref();
        logger.info({ path }, "follow mode reader opened");
      } catch (err) {
        closed = true;
        initError = err instanceof Error ? err : new Error(String(err));
        logger.error({ error: initError.message, stack: initError.stack, path }, "follow mode init failed");
        if (waitingReject) {
          const reject = waitingReject;
          waiting = null;
          waitingReject = null;
          reject(initError);
        } else if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve({ done: true, value: undefined });
        }
      }
    })();
    return initPromise;
  }

  async function readNewContent(): Promise<void> {
    if (!fh || closed) return;

    // Detect file truncation before reading
    const stat = await fh.stat();
    if (stat.size < offset) {
      logger.warn({ path, previousOffset: offset, newSize: stat.size }, "JSONL file truncated — resetting read position");
      offset = 0;
      remainder = "";
    }
    if (stat.size <= offset) return;

    let totalRead = 0;
    let text = remainder;

    while (true) {
      const { bytesRead } = await fh.read(readBuf, 0, READ_BUFFER_SIZE, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      text += readBuf.toString("utf-8", 0, bytesRead);
      totalRead += bytesRead;
    }

    if (totalRead === 0) return;

    const lines = text.split("\n");

    // Last element may be incomplete — save for next read
    remainder = lines.pop() ?? "";

    // Guard against unbounded remainder growth. Surface as an error to the
    // iterator — silently dropping means the consumer sees a missing event
    // with no signal, which is exactly the failure mode callers can't detect.
    if (remainder.length > MAX_LINE_BYTES) {
      const err = new Error(
        `JSONL line exceeds ${MAX_LINE_BYTES} bytes (file: ${path}); discarding pending remainder`,
      );
      logger.error({ path, remainderBytes: remainder.length }, "follow mode: oversized line");
      remainder = "";
      if (waitingReject) {
        const reject = waitingReject;
        waiting = null;
        waitingReject = null;
        reject(err);
      } else {
        pendingError = err;
      }
    }

    for (const line of lines) {
      if (line.trim() === "") continue;
      const parsed = parseLine<T>(line, keepMeta, path);
      if (parsed === null) continue;

      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: false, value: parsed });
      } else {
        buffer.push(parsed);
      }
    }
  }

  return {
    async next(): Promise<IteratorResult<T>> {
      await init();

      if (initError) {
        return Promise.reject(initError);
      }

      // Surface any error accumulated between next() calls (e.g., oversized line)
      if (pendingError) {
        const err = pendingError;
        pendingError = null;
        return Promise.reject(err);
      }

      // Return buffered item if available
      if (buffer.length > 0) {
        return { done: false, value: buffer.shift()! };
      }

      if (closed) {
        return { done: true, value: undefined };
      }

      // Wait for the next event from the file watcher
      return new Promise<IteratorResult<T>>((resolve, reject) => {
        waiting = resolve;
        waitingReject = reject;
      });
    },

    async return(): Promise<IteratorResult<T>> {
      closed = true;
      if (watcher) {
        try { watcher.close(); } catch (err) { logger.warn({ error: String(err) }, "cleanup error"); }
        watcher = null;
      }
      if (fh) {
        try { await fh.close(); } catch (err) { logger.warn({ error: String(err) }, "cleanup error"); }
        fh = null;
      }
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        waitingReject = null;
        resolve({ done: true, value: undefined });
      }
      return { done: true, value: undefined };
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

/** Parse a JSONL line, optionally stripping the `_ts` metadata field. */
function parseLine<T>(line: string, keepMeta: boolean, path: string): T | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  try {
    const raw: unknown = JSON.parse(trimmed);

    // Type guard: only accept plain objects
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      logger.warn({ path, line: trimmed.slice(0, 120) }, "skipping non-object JSONL line");
      return null;
    }

    const parsed = raw as Record<string, unknown>;

    // Handle wrapper format { _ts, event: ... } from updated jsonl.ts
    if ("event" in parsed) {
      const event = parsed["event"];
      if (keepMeta) {
        return { _ts: parsed["_ts"], ...(event as object) } as T;
      }
      return event as T;
    }

    // Legacy spread format (backwards compatibility)
    if (!keepMeta && "_ts" in parsed) {
      const { _ts, ...rest } = parsed;
      void _ts;
      return rest as T;
    }

    return parsed as T;
  } catch {
    logger.warn({ path, line: trimmed.slice(0, 120) }, "skipping malformed JSONL line");
    return null;
  }
}
