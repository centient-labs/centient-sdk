/**
 * Event Streaming Type Definitions
 *
 * Types for the typed event streaming library. Generic over the event
 * type — consumers define their own event shapes; this package provides
 * the streaming infrastructure.
 */

import type { EventsLogger } from "./logging.js";

export type { EventsLogger };

// ---------------------------------------------------------------------------
// Backpressure
// ---------------------------------------------------------------------------

/** Policy applied when a subscriber's buffer is full. */
export type BackpressurePolicy =
  | "drop-oldest"   // Drop oldest buffered event, add new one (default)
  | "drop-newest";  // Reject new event, keep buffer intact

// ---------------------------------------------------------------------------
// Subscribe Options
// ---------------------------------------------------------------------------

/** Options for `subscribe()`. Generic over the stream's event type. */
export interface SubscribeOptions<T = unknown> {
  /**
   * Buffer size for this subscriber (events queued if consumer is slow).
   * Default: inherited from EventStreamOptions.defaultBufferSize (1000).
   * When buffer is full, the stream-level backpressure policy applies.
   */
  bufferSize?: number;
  /**
   * Optional filter — only events passing this predicate are delivered
   * to this subscriber. Runs synchronously before buffering. Filtered-out
   * events never enter the buffer.
   */
  filter?: (event: T) => boolean;
}

// ---------------------------------------------------------------------------
// JSONL Rotation
// ---------------------------------------------------------------------------

/**
 * Size-based rotation settings for a JSONL subscriber.
 *
 * Rotation is **opt-in**: omitting the `rotation` option entirely leaves the
 * log un-rotated, exactly as before this option existed. Passing an (even
 * empty) object turns rotation on with the defaults below.
 *
 * The live file is renamed — never copy-truncated — to
 * `<file>.<UTC stamp>` (e.g. `events.jsonl.2026-07-02T10-15-30-123Z`, with a
 * `-N` suffix if that name is taken) at a flush boundary, and the next flush
 * recreates the canonical path. Rotated siblings beyond `maxFiles` are
 * deleted; only names matching the exact stamp shape are ever deleted, so
 * operator-made siblings (`events.jsonl.old`, `events.jsonl.1`) are never
 * swept.
 *
 * Rotation failures (a full disk, a read-only directory) are logged through
 * the subscriber's logger and never propagate — a hygiene failure must not
 * take the event stream down.
 */
export interface JsonlRotationOptions {
  /**
   * Rotate once the file has reached this size, checked before each flush.
   * Default: 104857600 (100 MiB). Must be a positive integer.
   *
   * Because the check runs before the append, the whole incoming batch lands
   * in the fresh file — so the live file is bounded at `maxSizeBytes` plus at
   * most one flush's worth of lines, not at `maxSizeBytes` exactly.
   */
  maxSizeBytes?: number;
  /**
   * Number of rotated files to retain; the oldest beyond this are deleted
   * after each rotation. Default: 5. Must be a non-negative integer — `0`
   * means "rotate and discard", keeping only the live file.
   */
  maxFiles?: number;
}

// ---------------------------------------------------------------------------
// JSONL Subscriber Options
// ---------------------------------------------------------------------------

/** Options for `createJsonlSubscriber()` and `EventStream.jsonl()`. */
export interface JsonlSubscriberOptions {
  /**
   * Optional logger for write/serialization/flush/rotation diagnostics.
   * Defaults to a `@centient/logger` component logger (`centient:events:jsonl`),
   * so omitting it preserves the pre-injection behavior.
   */
  logger?: EventsLogger;
  /**
   * Size-based log rotation. **Off by default** — omit for the historical
   * append-forever behavior. See {@link JsonlRotationOptions}.
   */
  rotation?: JsonlRotationOptions;
  /**
   * Clock seam for the subscriber: supplies both the `_ts` stamp on each
   * written line and the UTC stamp in rotated file names. Defaults to
   * `() => new Date()`, so omitting it changes nothing. Inject it to make
   * rotated names deterministic in tests.
   */
  clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Event Subscriber (callback-based)
// ---------------------------------------------------------------------------

/** Callback-based subscriber attached via `tee()`. */
export interface EventSubscriber<T> {
  /** Called for each emitted event. May be async. */
  onEvent(event: T): void | Promise<void>;
  /** Called when a subscriber-side error occurs. */
  onError?(error: Error): void;
  /** Called when the stream closes. May be async for cleanup. */
  onClose?(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Event Stream
// ---------------------------------------------------------------------------

/** Options for `createEventStream()`. */
export interface EventStreamOptions {
  /** Backpressure policy when a subscriber's buffer is full. Default: 'drop-oldest'. */
  backpressure?: BackpressurePolicy;
  /** Default buffer size for subscribers. Default: 1000. */
  defaultBufferSize?: number;
  /**
   * Optional logger for stream-internal diagnostics (backpressure drops,
   * closed-stream calls, subscriber/JSONL errors). Any object matching the
   * {@link EventsLogger} shape works — a `@centient/logger` `Logger`
   * satisfies it directly. Defaults to a `@centient/logger` component logger
   * (`centient:events`), so omitting it preserves the pre-injection behavior.
   * The logger is also forwarded to JSONL subscribers created via `jsonl()`.
   */
  logger?: EventsLogger;
  /**
   * Default JSONL rotation settings for subscribers created via `jsonl()`.
   * **Off by default.** A per-call `jsonl(path, { rotation })` overrides this,
   * including `jsonl(path, { rotation: undefined })` to leave one subscriber
   * un-rotated; see {@link EventStream.jsonl} and {@link JsonlRotationOptions}.
   */
  rotation?: JsonlRotationOptions;
}

/** The primary event streaming abstraction. Generic over event type T. */
export interface EventStream<T> {
  /** Emit an event to all subscribers. */
  emit(event: T): void;

  /** Subscribe to the event stream (AsyncIterable for async-for-of consumption). */
  subscribe(opts?: SubscribeOptions<T>): AsyncIterable<T>;

  /**
   * Fan-out: add a named subscriber that receives all events.
   * Returns a dispose function to remove the subscriber.
   */
  tee(name: string, subscriber: EventSubscriber<T>): () => void;

  /**
   * Convenience: add a JSONL file subscriber (appends events as JSON lines).
   * Returns a dispose function to remove the subscriber.
   *
   * `opts` is passed through to `createJsonlSubscriber()`. Anything omitted
   * falls back to the stream's own options — `logger` to the injected stream
   * logger, `rotation` to `EventStreamOptions.rotation`.
   *
   * For `rotation`, "omitted" means the **key is absent**, not that its value
   * is `undefined`. Passing `{ rotation: undefined }` explicitly turns rotation
   * OFF for this subscriber even when the stream sets a default — the way to
   * keep one log un-rotated (an external tailer, a compliance capture) under a
   * stream-wide rotation policy:
   *
   * ```ts
   * const stream = createEventStream<E>({ rotation: { maxSizeBytes: 1 << 26 } });
   * stream.jsonl("/var/log/app.jsonl");                            // rotates
   * stream.jsonl("/var/log/audit.jsonl", { rotation: undefined }); // never rotates
   * ```
   *
   * Note: This is a Node.js-specific convenience. Use tee() with
   * createJsonlSubscriber() directly for the same functionality.
   */
  jsonl(filePath: string, opts?: JsonlSubscriberOptions): () => void;

  /** Current number of active subscribers (both AsyncIterable and tee'd). */
  readonly subscriberCount: number;

  /** Close the stream — all subscribers receive completion signal. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Replay Options
// ---------------------------------------------------------------------------

/** Options for `fromJsonl()`. */
export interface FromJsonlOptions {
  /**
   * If true, continue watching for new lines after reaching EOF (like tail -f).
   * Default: false (read to EOF then complete).
   */
  follow?: boolean;
  /**
   * If true, keep the `_ts` metadata field in emitted events.
   * Default: false (strip `_ts` before yielding).
   */
  keepMeta?: boolean;
  /**
   * Optional logger for reader-internal diagnostics (open/close, malformed
   * or oversized lines, read errors). Defaults to a `@centient/logger`
   * component logger (`centient:events:replay`), so omitting it preserves
   * the pre-injection behavior.
   */
  logger?: EventsLogger;
}

// ---------------------------------------------------------------------------
// Event Envelope (optional helper)
// ---------------------------------------------------------------------------

/**
 * Typed envelope that consumers can use to standardize event metadata.
 * Optional — consumers can use any event type with EventStream.
 */
export interface EventEnvelope<T extends string, P> {
  /** Discriminant (e.g., "block:started"). */
  type: T;
  /** ISO 8601 timestamp (auto-set if not provided). */
  timestamp: string;
  /** Type-specific data. */
  payload: P;
}
