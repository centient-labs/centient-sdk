/**
 * EventStream Core Implementation
 *
 * Generic event stream with fan-out to multiple subscribers.
 * Supports both AsyncIterable (for-await-of) and callback-based
 * subscribers. Per-subscriber bounded buffers with configurable
 * backpressure policy.
 *
 * Lifecycle:
 * 1. Create a stream via `createEventStream<T>()`
 * 2. Attach subscribers via `subscribe()` or `tee()`
 * 3. Emit events via `emit()` — delivered to all subscribers
 * 4. Call `close()` to flush, signal completion, and clean up
 */

import type {
  EventStream,
  EventStreamOptions,
  EventSubscriber,
  SubscribeOptions,
  BackpressurePolicy,
} from "./types.js";
import { type EventsLogger, resolveLogger } from "./logging.js";
import { createJsonlSubscriber } from "./jsonl.js";

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** State for an AsyncIterable subscriber. */
interface IterableSubscriber<T> {
  buffer: T[];
  bufferSize: number;
  /** Resolve function for the pending next() call, if the consumer is waiting. */
  waiting: ((result: IteratorResult<T>) => void) | null;
  closed: boolean;
  /** Optional filter — only events passing this predicate are delivered. */
  filter?: (event: T) => boolean;
  /** Count of events dropped due to backpressure. */
  droppedCount: number;
}

/** State for a tee'd (callback-based) subscriber. */
interface TeeSubscriber<T> {
  name: string;
  subscriber: EventSubscriber<T>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new EventStream.
 *
 * @param opts - Stream options (backpressure policy, default buffer size)
 * @returns A typed EventStream instance
 */
export function createEventStream<T>(opts?: EventStreamOptions): EventStream<T> {
  const backpressure: BackpressurePolicy = opts?.backpressure ?? "drop-oldest";
  const defaultBufferSize = opts?.defaultBufferSize ?? 1000;
  // Preserve the raw injected logger (may be undefined) separately from the
  // resolved one: stream-internal paths use `logger` (resolved default), but
  // the JSONL subscriber must only receive an *injected* logger. Forwarding
  // the resolved default would override the subscriber's own `events:jsonl`
  // component, changing default-path log output (it would emit under
  // `events` instead of `events:jsonl`).
  const injectedLogger = opts?.logger;
  const logger = resolveLogger(injectedLogger);

  const iterableSubs = new Set<IterableSubscriber<T>>();
  const teeSubs = new Map<string, TeeSubscriber<T>>();
  /** JSONL dispose functions keyed by file path for cleanup on close. */
  const jsonlDisposers = new Map<string, () => Promise<void>>();
  let closed = false;

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  function emit(event: T): void {
    if (closed) {
      logger.warn("emit() called on closed stream — event dropped");
      return;
    }

    // Deliver to AsyncIterable subscribers
    for (const sub of iterableSubs) {
      if (sub.filter) {
        try {
          if (!sub.filter(event)) continue;
        } catch (err) {
          logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            "subscriber filter threw — event skipped for this subscriber",
          );
          continue;
        }
      }
      deliverToIterable(sub, event, backpressure, logger);
    }

    // Deliver to tee'd subscribers (fire-and-forget for async)
    for (const teeSub of teeSubs.values()) {
      deliverToTee(teeSub, event, logger);
    }
  }

  // -------------------------------------------------------------------------
  // Subscribe (AsyncIterable)
  // -------------------------------------------------------------------------

  function subscribe(subOpts?: SubscribeOptions<T>): AsyncIterable<T> {
    if (closed) {
      logger.warn("subscribe() called on closed stream — iterable will be immediately done");
      // Return an immediately-done iterable
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return { done: true, value: undefined };
            },
          };
        },
      };
    }

    const bufferSize = subOpts?.bufferSize ?? defaultBufferSize;
    const sub: IterableSubscriber<T> = {
      buffer: [],
      bufferSize,
      waiting: null,
      closed: false,
      filter: subOpts?.filter,
      droppedCount: 0,
    };
    iterableSubs.add(sub);

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            // If there's a buffered item, return it immediately
            const item = sub.buffer.shift();
            if (item !== undefined) {
              return Promise.resolve({ done: false, value: item });
            }

            // If the stream is closed and buffer is empty, we're done
            if (sub.closed) {
              iterableSubs.delete(sub);
              return Promise.resolve({ done: true, value: undefined });
            }

            // Otherwise, wait for the next event
            return new Promise<IteratorResult<T>>((resolve) => {
              sub.waiting = resolve;
            });
          },

          return(): Promise<IteratorResult<T>> {
            sub.closed = true;
            if (sub.waiting) {
              const resolve = sub.waiting;
              sub.waiting = null;
              resolve({ done: true, value: undefined });
            }
            iterableSubs.delete(sub);
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
  }

  // -------------------------------------------------------------------------
  // Tee (callback-based)
  // -------------------------------------------------------------------------

  function tee(name: string, subscriber: EventSubscriber<T>): () => void {
    if (closed) {
      logger.warn({ subscriberName: name }, "tee() called on closed stream — subscriber not added");
      return () => {};
    }

    if (teeSubs.has(name)) {
      logger.warn({ subscriberName: name }, "tee() overwriting existing subscriber with same name");
    }

    teeSubs.set(name, { name, subscriber });
    logger.debug({ subscriberName: name }, "subscriber added via tee()");

    return () => {
      teeSubs.delete(name);
      logger.debug({ subscriberName: name }, "subscriber removed");
    };
  }

  // -------------------------------------------------------------------------
  // JSONL
  // -------------------------------------------------------------------------

  function jsonl(filePath: string): () => void {
    const { subscriber, flush } = createJsonlSubscriber<T>(filePath, { logger: injectedLogger });
    const dispose = tee(`jsonl:${filePath}`, subscriber);
    jsonlDisposers.set(filePath, flush);

    return () => {
      const flushFn = jsonlDisposers.get(filePath);
      if (flushFn) {
        flushFn().catch((err) => {
          logger.error({ error: String(err) }, "JSONL flush error on dispose");
        });
      }
      dispose();
      jsonlDisposers.delete(filePath);
    };
  }

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;

    // Flush all JSONL buffers
    const flushPromises = Array.from(jsonlDisposers.values()).map((flush) =>
      flush().catch((err) => {
        logger.error(
          { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
          "JSONL flush error on close",
        );
      }),
    );
    await Promise.all(flushPromises);
    jsonlDisposers.clear();

    // Signal completion to all AsyncIterable subscribers
    for (const sub of iterableSubs) {
      sub.closed = true;
      if (sub.waiting) {
        sub.waiting({ done: true, value: undefined });
        sub.waiting = null;
      }
    }
    iterableSubs.clear();

    // Notify tee'd subscribers and await async onClose handlers
    const closePromises: Promise<void>[] = [];
    for (const teeSub of teeSubs.values()) {
      try {
        const result = teeSub.subscriber.onClose?.() as void | Promise<void>;
        if (result instanceof Promise) {
          closePromises.push(result.catch((err) => {
            logger.error(
              { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
              `onClose error in subscriber '${teeSub.name}'`,
            );
          }));
        }
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
          `onClose error in subscriber '${teeSub.name}'`,
        );
      }
    }
    await Promise.all(closePromises);

    teeSubs.clear();
    logger.debug("stream closed");
  }

  // -------------------------------------------------------------------------
  // Public Interface
  // -------------------------------------------------------------------------

  logger.debug({ backpressure, defaultBufferSize }, "stream created");

  return {
    emit,
    subscribe,
    tee,
    jsonl,
    get subscriberCount() {
      return iterableSubs.size + teeSubs.size;
    },
    close,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Deliver an event to an AsyncIterable subscriber, respecting backpressure. */
function deliverToIterable<T>(
  sub: IterableSubscriber<T>,
  event: T,
  policy: BackpressurePolicy,
  logger: EventsLogger,
): void {
  // If the consumer is waiting, resolve immediately (no buffering needed)
  if (sub.waiting) {
    const resolve = sub.waiting;
    sub.waiting = null;
    resolve({ done: false, value: event });
    return;
  }

  // Buffer the event
  if (sub.buffer.length < sub.bufferSize) {
    sub.buffer.push(event);
    return;
  }

  // Buffer is full — apply backpressure policy
  switch (policy) {
    case "drop-oldest":
      sub.buffer.shift();
      sub.buffer.push(event);
      sub.droppedCount++;
      if (sub.droppedCount === 1) {
        logger.warn("subscriber buffer full — dropping oldest events (backpressure: drop-oldest)");
      }
      break;
    case "drop-newest":
      // New event is dropped — buffer stays intact
      sub.droppedCount++;
      if (sub.droppedCount === 1) {
        logger.warn("subscriber buffer full — dropping newest events (backpressure: drop-newest)");
      }
      break;
  }
}

/** Deliver an event to a tee'd subscriber. Errors are isolated. */
function deliverToTee<T>(teeSub: TeeSubscriber<T>, event: T, logger: EventsLogger): void {
  try {
    const result = teeSub.subscriber.onEvent(event);
    // If onEvent returns a Promise, catch errors from it
    if (result instanceof Promise) {
      result.catch((err) => {
        handleTeeError(teeSub, err, logger);
      });
    }
  } catch (err) {
    handleTeeError(teeSub, err, logger);
  }
}

/** Forward an error to a tee'd subscriber's onError callback. */
function handleTeeError<T>(teeSub: TeeSubscriber<T>, err: unknown, logger: EventsLogger): void {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error(
    { error: error.message, stack: error.stack },
    `subscriber '${teeSub.name}' onEvent error`,
  );
  try {
    teeSub.subscriber.onError?.(error);
  } catch (onErrorErr) {
    logger.error(
      { error: onErrorErr instanceof Error ? onErrorErr.message : String(onErrorErr), stack: onErrorErr instanceof Error ? onErrorErr.stack : undefined },
      `subscriber '${teeSub.name}' onError handler threw`,
    );
  }
}
