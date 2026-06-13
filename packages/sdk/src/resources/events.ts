/**
 * Events Resource (P19 — Real-Time Event Streaming)
 *
 * Provides a typed SSE client for the engram GET /events endpoint.
 *
 * @example
 * ```typescript
 * const sub = client.events.subscribeWithFetch(
 *   ["crystal.created", "note.created"],
 *   (event) => { console.log(event.type, event.entity_id); }
 * );
 *
 * // Later — close the connection
 * sub.close();
 * ```
 */

import type { EngramClient } from "../client.js";
import {
  EventStreamOverflowError,
  InsecureEventSourceError,
} from "../errors.js";
import { BaseResource } from "./base.js";

// ============================================================================
// Types (mirrors engram/src/types/events.ts)
// ============================================================================

export type EngramEventType =
  | "crystal.created"
  | "crystal.updated"
  | "crystal.deleted"
  | "note.created"
  | "note.updated"
  | "note.deleted"
  | "session.started"
  | "session.ended"
  | "coherence.contradiction_detected";

export interface BaseEngramStreamEvent {
  id: string;
  type: EngramEventType;
  timestamp: string;
  entity_type: "crystal" | "note" | "session" | "coherence";
  entity_id: string;
  summary: string;
  data: Record<string, unknown>;
}

export type EngramStreamEventCallback = (event: BaseEngramStreamEvent) => void;

/**
 * An active SSE subscription. Call `.close()` to disconnect.
 */
export interface EventSubscription {
  /** Close the SSE connection and clean up resources. */
  close(): void;
}

/**
 * Opt-in options for the deprecated {@link EventsResource.subscribe} path.
 */
export interface SubscribeOptions {
  /**
   * Acknowledge that the `EventSource` transport cannot send the `X-API-Key`
   * header — the API key is silently dropped, so this path only works against
   * unauthenticated endpoints. Must be set to `true` or `subscribe()` throws
   * {@link import("../errors.js").InsecureEventSourceError}.
   *
   * @default false
   */
  allowInsecureEventSource?: boolean;
}

/**
 * Options for {@link EventsResource.subscribeIter}.
 */
export interface SubscribeIterOptions {
  /**
   * Maximum number of parsed-but-undelivered events the internal queue will
   * buffer before the iterator throws
   * {@link import("../errors.js").EventStreamOverflowError}. Bounds memory when
   * the server outpaces the consumer; overflow is surfaced explicitly rather
   * than dropping events silently (P2).
   *
   * @default 1024
   */
  highWaterMark?: number;

  /**
   * Optional abort signal. Aborting terminates the underlying SSE fetch and
   * ends the iterator cleanly (the `for await` loop completes without throwing).
   */
  signal?: AbortSignal;
}

/** Default high-water mark for {@link EventsResource.subscribeIter}. */
const DEFAULT_HIGH_WATER_MARK = 1024;

// ============================================================================
// Resource
// ============================================================================

export class EventsResource extends BaseResource {
  constructor(client: EngramClient) {
    super(client);
  }

  /**
   * Subscribe to a real-time SSE stream from the engram server using the
   * browser/Node `EventSource` API.
   *
   * **BROKEN BY DESIGN — silent auth failure.** `EventSource` cannot send
   * custom request headers, so the API key is computed but never transmitted:
   * authentication silently fails against any authenticated endpoint (P2: No
   * Silent Degradation). Because reaching this path by default would re-expose
   * that defect, this method **throws
   * {@link import("../errors.js").InsecureEventSourceError} unless you pass
   * `{ allowInsecureEventSource: true }`** to explicitly acknowledge the
   * unauthenticated-only behaviour.
   *
   * Use {@link subscribeWithFetch} (callback) or {@link subscribeIter}
   * (AsyncIterable) instead — both send `X-API-Key` correctly. The Python SDK
   * exposes the same iterator surface as `events.subscribe_iter`.
   *
   * @deprecated EventSource cannot send the API key header; use
   *   {@link subscribeWithFetch} or {@link subscribeIter}. Throws unless
   *   `allowInsecureEventSource: true` is passed. Reserved for removal in 3.0.
   * @param types - Event types to filter for. Pass empty array or omit to receive all events.
   * @param onEvent - Callback invoked for each received event.
   * @param onError - Optional callback invoked on connection errors.
   * @param options - Must set `allowInsecureEventSource: true` to opt in.
   * @returns An `EventSubscription` with a `.close()` method.
   * @throws {InsecureEventSourceError} if `allowInsecureEventSource` is not `true`.
   */
  subscribe(
    types: EngramEventType[] | undefined,
    onEvent: EngramStreamEventCallback,
    onError?: (err: Error) => void,
    options?: SubscribeOptions
  ): EventSubscription {
    if (options?.allowInsecureEventSource !== true) {
      throw new InsecureEventSourceError();
    }

    const baseUrl = this.client.baseUrl.replace(/\/$/, "");
    const query = types && types.length > 0 ? `?types=${types.join(",")}` : "";
    const url = `${baseUrl}/events${query}`;

    const apiKey = this.client.apiKey;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const source = new EventSource(url);
    let closed = false;

    source.onmessage = (ev) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(ev.data) as BaseEngramStreamEvent;
        onEvent(parsed);
      } catch (parseErr) {
        onError?.(
          new Error(
            `Malformed SSE frame: failed to parse event data as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          )
        );
      }
    };

    source.onerror = (ev) => {
      if (closed) return;
      onError?.(new Error(`SSE connection error: ${JSON.stringify(ev)}`));
    };

    return {
      close() {
        closed = true;
        source.close();
      },
    };
  }

  /**
   * Subscribe to a real-time SSE stream using the Fetch API.
   *
   * This is the **recommended** method for subscribing to events. Unlike
   * {@link subscribe}, this method correctly sends authentication headers
   * (`X-API-Key`) and works in both browser and Node.js environments.
   *
   * @param types - Event types to filter for. Pass empty array or omit to receive all events.
   * @param onEvent - Callback invoked for each received event.
   * @param onError - Optional callback invoked on errors.
   * @returns An `EventSubscription` with a `.close()` method.
   */
  subscribeWithFetch(
    types: EngramEventType[] | undefined,
    onEvent: EngramStreamEventCallback,
    onError?: (err: Error) => void
  ): EventSubscription {
    const baseUrl = this.client.baseUrl.replace(/\/$/, "");
    const query = types && types.length > 0 ? `?types=${types.join(",")}` : "";
    const url = `${baseUrl}/events${query}`;

    const apiKey = this.client.apiKey;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const controller = new AbortController();
    const state = { closed: false };

    /**
     * Last-resort error reporter. Guards the user-supplied onError callback:
     * if onError itself throws, the failure is recorded here (nothing further
     * can be done — the SDK has no logger of its own) and swallowed so it can
     * never escape as an unhandled rejection.
     */
    const reportError = (err: unknown): void => {
      try {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } catch {
        // onError threw. Recorded: the error reporter itself failed; there is
        // no safe channel left, so swallow — never let it escape.
      }
    };

    void this.runSseLoop(url, headers, controller.signal, state, {
      // A throwing onEvent is a consumer failure, not a malformed frame. The
      // loop lets it propagate to the terminal handler, which reports the
      // actual error — preserving the pre-existing callback contract.
      onEvent: (event) => onEvent(event),
      onParseError: (err) => reportError(err),
      onTerminalError: (err) => reportError(err),
    }).catch((err: unknown) => {
      // Last resort: runSseLoop's own catch/finally handle all paths, but a
      // void-launched async must never produce an unhandled rejection.
      state.closed = true;
      reportError(err);
    });

    return {
      close() {
        state.closed = true;
        controller.abort();
      },
    };
  }

  /**
   * Subscribe to a real-time SSE stream as an `AsyncIterable` of events.
   *
   * Pull-based counterpart to {@link subscribeWithFetch}: a thin adapter that
   * drives the same hand-rolled SSE parser and bridges its push callbacks into
   * an async iterator backed by a bounded internal queue. Sends `X-API-Key`
   * correctly (unlike the deprecated {@link subscribe}). The Python SDK exposes
   * the symmetric `events.subscribe_iter`.
   *
   * Backpressure is bounded, not silent: if the server pushes events faster
   * than the `for await` consumer drains them and the buffer exceeds
   * `highWaterMark`, the iterator **throws**
   * {@link import("../errors.js").EventStreamOverflowError} rather than dropping
   * events (P2: No Silent Degradation). Aborting via `options.signal` ends the
   * iterator cleanly (the loop completes without throwing); breaking out of the
   * `for await` loop (or calling `.return()`) tears the subscription down.
   *
   * Zero new dependencies — this does not use `@centient/events`.
   *
   * @example
   * ```typescript
   * const ac = new AbortController();
   * for await (const event of client.events.subscribeIter(
   *   ["crystal.created"],
   *   { signal: ac.signal, highWaterMark: 256 }
   * )) {
   *   console.log(event.type, event.entity_id);
   *   if (someCondition) break; // tears down the subscription
   * }
   * ```
   *
   * @param types - Event types to filter for. Pass empty array or omit to receive all events.
   * @param options - High-water mark and optional `AbortSignal`.
   * @returns An `AsyncIterable<BaseEngramStreamEvent>`.
   * @throws {EventStreamOverflowError} on the iterator if the buffer overflows.
   */
  subscribeIter(
    types?: EngramEventType[],
    options?: SubscribeIterOptions
  ): AsyncIterable<BaseEngramStreamEvent> {
    const baseUrl = this.client.baseUrl.replace(/\/$/, "");
    const query = types && types.length > 0 ? `?types=${types.join(",")}` : "";
    const url = `${baseUrl}/events${query}`;

    const apiKey = this.client.apiKey;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const highWaterMark =
      options?.highWaterMark && options.highWaterMark > 0
        ? options.highWaterMark
        : DEFAULT_HIGH_WATER_MARK;

    const runSseLoop = this.runSseLoop.bind(this);

    return {
      [Symbol.asyncIterator](): AsyncIterator<BaseEngramStreamEvent> {
        const controller = new AbortController();
        const state = { closed: false };

        // Bounded FIFO of parsed-but-undelivered events.
        const queue: BaseEngramStreamEvent[] = [];
        // A pending consumer waiting on next() when the queue is empty.
        let pendingResolve: ((r: IteratorResult<BaseEngramStreamEvent>) => void) | null =
          null;
        let pendingReject: ((err: unknown) => void) | null = null;
        // Set when the producer finishes (stream end) or fails (terminal error).
        let finished = false;
        let terminalError: unknown = null;

        const settleNext = (): void => {
          if (!pendingResolve || !pendingReject) return;
          if (queue.length > 0) {
            const resolve = pendingResolve;
            pendingResolve = null;
            pendingReject = null;
            resolve({ value: queue.shift() as BaseEngramStreamEvent, done: false });
            return;
          }
          if (terminalError !== null) {
            const reject = pendingReject;
            pendingResolve = null;
            pendingReject = null;
            reject(terminalError);
            return;
          }
          if (finished) {
            const resolve = pendingResolve;
            pendingResolve = null;
            pendingReject = null;
            resolve({ value: undefined, done: true });
          }
        };

        const fail = (err: unknown): void => {
          if (terminalError === null) terminalError = err;
          finished = true;
          state.closed = true;
          settleNext();
        };

        // Bridge an external abort signal: ending cleanly, not as an error.
        const onAbort = (): void => {
          finished = true;
          state.closed = true;
          controller.abort();
          settleNext();
        };
        if (options?.signal) {
          if (options.signal.aborted) {
            finished = true;
            state.closed = true;
          } else {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        // Drive the shared SSE loop. Push callbacks feed the queue; the
        // terminal handler resolves the iterator (clean end) or rejects it.
        void runSseLoop(url, headers, controller.signal, state, {
          onEvent: (event) => {
            if (state.closed) return;
            queue.push(event);
            if (queue.length > highWaterMark) {
              // Overflow: consumer cannot keep up. Surface explicitly and tear
              // the subscription down — never drop silently.
              controller.abort();
              fail(new EventStreamOverflowError(highWaterMark));
              return;
            }
            settleNext();
          },
          // A malformed frame is non-fatal in the callback API; for the
          // iterator it is a stream error the consumer must see.
          onParseError: (err) => fail(err),
          onTerminalError: (err) => fail(err),
          onDone: () => {
            finished = true;
            settleNext();
          },
        }).catch((err: unknown) => {
          // Defense in depth: runSseLoop should not escape, but a void-launched
          // async must never produce an unhandled rejection.
          fail(err);
        });

        const cleanup = (): void => {
          if (options?.signal) {
            options.signal.removeEventListener("abort", onAbort);
          }
        };

        return {
          next(): Promise<IteratorResult<BaseEngramStreamEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({
                value: queue.shift() as BaseEngramStreamEvent,
                done: false,
              });
            }
            if (terminalError !== null) {
              const err = terminalError;
              terminalError = null; // surface once; further next() => done
              finished = true;
              return Promise.reject(err);
            }
            if (finished) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise<IteratorResult<BaseEngramStreamEvent>>(
              (resolve, reject) => {
                pendingResolve = resolve;
                pendingReject = reject;
              }
            );
          },
          return(): Promise<IteratorResult<BaseEngramStreamEvent>> {
            // Consumer broke out of the loop (or called .return()). Tear down.
            finished = true;
            state.closed = true;
            controller.abort();
            cleanup();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  /**
   * Shared SSE driver. Fetches the stream, splits frames across chunk
   * boundaries (so a `data:` line spanning two reads is reassembled), parses
   * each `data:` frame, and dispatches via the supplied sinks. The single
   * implementation backs both {@link subscribeWithFetch} (push callbacks) and
   * {@link subscribeIter} (pull iterator).
   *
   * Contract: this method's returned promise never rejects — every exit path
   * (normal end, fetch failure, read failure, abort) routes through a sink and
   * releases the reader in `finally`. `state.closed` is the cooperative stop
   * flag both public entry points flip on teardown.
   */
  private async runSseLoop(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    state: { closed: boolean },
    sinks: {
      onEvent: (event: BaseEngramStreamEvent) => void;
      onParseError: (err: Error) => void;
      onTerminalError: (err: unknown) => void;
      onDone?: () => void;
    }
  ): Promise<void> {
    // Hoisted so the finally block can release the stream on every exit path.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, { headers, signal });

      if (!response.ok || !response.body) {
        throw new Error(`SSE fetch failed: ${response.status} ${response.statusText}`);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!state.closed) {
        const { done, value } = await reader.read();
        if (done) {
          sinks.onDone?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (state.closed) break;
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: BaseEngramStreamEvent;
            try {
              event = JSON.parse(jsonStr) as BaseEngramStreamEvent;
            } catch (parseErr) {
              sinks.onParseError(
                new Error(
                  `Malformed SSE frame: failed to parse event data as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
                )
              );
              continue; // Skip the malformed frame; keep streaming.
            }
            // A throwing onEvent is a consumer failure: let it propagate to
            // the outer catch, which closes the subscription and reports it.
            sinks.onEvent(event);
          }
        }
      }
    } catch (err) {
      if (state.closed) return; // Normal close / abort.
      state.closed = true; // The stream is dead — mark the subscription closed.
      sinks.onTerminalError(err);
    } finally {
      // Release the stream on every exit path (normal end, error, close()).
      // cancel() may reject (e.g. after an abort or an errored stream) —
      // suppress, since this is best-effort cleanup.
      void reader?.cancel().catch(() => {});
    }
  }
}
