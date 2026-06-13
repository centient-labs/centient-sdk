/**
 * Events Resource Tests (P19 — Real-Time Event Streaming)
 *
 * Focused on subscribeWithFetch error handling: the void-launched run() loop
 * must never produce an unhandled rejection, must mark the subscription
 * closed on failure, and must release the stream reader on every exit path.
 *
 * Every test runs with a process-level unhandledRejection trap active so a
 * silently-vanishing rejection fails the suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEventListeners } from "node:events";
import { EngramClient } from "../../src/client.js";
import {
  EventStreamOverflowError,
  InsecureEventSourceError,
} from "../../src/errors.js";
import type { BaseEngramStreamEvent } from "../../src/resources/events.js";

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(id: string): BaseEngramStreamEvent {
  return {
    id,
    type: "crystal.created",
    timestamp: "2026-06-11T00:00:00Z",
    entity_type: "crystal",
    entity_id: `crystal-${id}`,
    summary: `event ${id}`,
    data: {},
  };
}

function sseChunk(event: BaseEngramStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

type ReadStep =
  | { value: Uint8Array }
  | { done: true }
  | { reject: Error };

interface MockReader {
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

/**
 * A mock ReadableStreamDefaultReader fed from a fixed list of steps.
 * When the steps are exhausted the next read() hangs forever (an open
 * stream with no pending data).
 */
function createMockReader(steps: ReadStep[]): MockReader {
  let i = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockImplementation(() => {
    const step = steps[i++];
    if (!step) return new Promise(() => {}); // open stream, no data
    if ("reject" in step) return Promise.reject(step.reject);
    if ("done" in step) return Promise.resolve({ done: true, value: undefined });
    return Promise.resolve({ done: false, value: step.value });
  });
  return { read, cancel };
}

interface MockSseResponse {
  response: Response;
  reader: MockReader;
  getReader: ReturnType<typeof vi.fn>;
}

function mockSseResponse(steps: ReadStep[], status = 200): MockSseResponse {
  const reader = createMockReader(steps);
  const getReader = vi.fn().mockReturnValue(reader);
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    body: { getReader },
  } as unknown as Response;
  return { response, reader, getReader };
}

/** Let microtasks + the unhandledRejection tick drain. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * A push-driven mock reader: the test feeds chunks via `push()` / ends via
 * `end()`. Each pending `read()` resolves when a chunk is available, letting a
 * test pump events into the stream faster than a slow consumer drains them
 * (needed for the overflow case).
 */
interface PushReader {
  reader: MockReader;
  getReader: ReturnType<typeof vi.fn>;
  /** A fetch stub that wires the SDK's AbortSignal into the reader, mirroring
   *  the platform: aborting the controller rejects the pending `read()`. */
  fetch: ReturnType<typeof vi.fn>;
  push(chunk: Uint8Array): void;
  end(): void;
}

function pushReader(status = 200): PushReader {
  const chunks: Array<{ value?: Uint8Array; done?: boolean }> = [];
  let resolveWaiting: ((r: { value?: Uint8Array; done?: boolean }) => void) | null =
    null;
  let rejectWaiting: ((err: unknown) => void) | null = null;

  const deliver = (item: { value?: Uint8Array; done?: boolean }): void => {
    if (resolveWaiting) {
      const w = resolveWaiting;
      resolveWaiting = null;
      rejectWaiting = null;
      w(item);
    } else {
      chunks.push(item);
    }
  };

  const read = vi.fn().mockImplementation(() => {
    const next = chunks.shift();
    if (next) {
      return Promise.resolve(
        next.done ? { done: true, value: undefined } : { done: false, value: next.value }
      );
    }
    return new Promise((resolve, reject) => {
      resolveWaiting = (item) =>
        resolve(
          item.done ? { done: true, value: undefined } : { done: false, value: item.value }
        );
      rejectWaiting = reject;
    });
  });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const reader: MockReader = { read, cancel };
  const getReader = vi.fn().mockReturnValue(reader);
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    body: { getReader },
  } as unknown as Response;

  const fetchStub = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          // Platform behaviour: an aborted fetch rejects the in-flight read.
          if (rejectWaiting) {
            const r = rejectWaiting;
            resolveWaiting = null;
            rejectWaiting = null;
            r(new DOMException("The operation was aborted.", "AbortError"));
          }
        },
        { once: true }
      );
    }
    return Promise.resolve(response);
  });

  return {
    reader,
    getReader,
    fetch: fetchStub,
    push: (chunk) => deliver({ value: chunk }),
    end: () => deliver({ done: true }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("EventsResource.subscribeWithFetch", () => {
  let client: EngramClient;
  let unhandledRejections: unknown[];
  const trap = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  // Low-entropy placeholder bound to a neutrally-named var so the secret
  // scanner doesn't flag the fixture; the header-propagation test asserts
  // pass-through of the variable, not the literal.
  const placeholder = "test-key";

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: placeholder,
      timeout: 5000,
      retries: 1,
    });
    unhandledRejections = [];
    process.on("unhandledRejection", trap);
  });

  afterEach(async () => {
    // Drain any pending rejection before removing the trap so it is
    // recorded (and asserted on) rather than escaping to vitest only.
    await flush();
    process.removeListener("unhandledRejection", trap);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    expect(unhandledRejections).toEqual([]);
  });

  describe("happy path", () => {
    it("delivers events, ends on stream done, and releases the reader", async () => {
      const { response, reader } = mockSseResponse([
        { value: sseChunk(makeEvent("1")) },
        { value: sseChunk(makeEvent("2")) },
        { done: true },
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn();
      const onError = vi.fn();
      const sub = client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalledTimes(2);
      });
      expect(onEvent).toHaveBeenNthCalledWith(1, makeEvent("1"));
      expect(onEvent).toHaveBeenNthCalledWith(2, makeEvent("2"));
      expect(onError).not.toHaveBeenCalled();

      // The finally block releases the stream even on a normal end.
      await vi.waitFor(() => {
        expect(reader.cancel).toHaveBeenCalled();
      });

      expect(() => sub.close()).not.toThrow();
    });

    it("reports a malformed frame and keeps streaming subsequent events", async () => {
      const malformed = new TextEncoder().encode("data: {not json\n\n");
      const { response } = mockSseResponse([
        { value: malformed },
        { value: sseChunk(makeEvent("1")) },
        { done: true },
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn();
      const onError = vi.fn();
      client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalledWith(makeEvent("1"));
      });
      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as Error).message).toContain("Malformed SSE frame");
    });

    it("a throwing onError on a malformed frame does not kill the stream", async () => {
      const malformed = new TextEncoder().encode("data: {not json\n\n");
      const { response } = mockSseResponse([
        { value: malformed },
        { value: sseChunk(makeEvent("1")) },
        { done: true },
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn();
      const onError = vi.fn().mockImplementation(() => {
        throw new Error("error handler boom");
      });
      client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalledWith(makeEvent("1"));
      });
      expect(onError).toHaveBeenCalledTimes(1);
      // afterEach asserts unhandledRejections is empty.
    });

    it("sends the API key and Accept headers", async () => {
      const { response } = mockSseResponse([{ done: true }]);
      const mockFetch = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", mockFetch);

      client.events.subscribeWithFetch(undefined, vi.fn(), vi.fn());

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/events",
          expect.objectContaining({
            headers: expect.objectContaining({
              Accept: "text/event-stream",
              "X-API-Key": placeholder,
            }),
          })
        );
      });
    });
  });

  describe("onEvent throws", () => {
    it("reports via onError, closes the subscription, cancels the reader, no unhandled rejection", async () => {
      const boom = new Error("consumer boom");
      const { response, reader } = mockSseResponse([
        { value: sseChunk(makeEvent("1")) },
        { value: sseChunk(makeEvent("2")) }, // must never be delivered
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn().mockImplementation(() => {
        throw boom;
      });
      const onError = vi.fn();
      const sub = client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(boom);
      });
      expect(onError).toHaveBeenCalledTimes(1);

      // Subscription is closed: the loop exited, so the second chunk is
      // never delivered even though the mock reader still has it queued.
      await flush();
      expect(onEvent).toHaveBeenCalledTimes(1);

      // The reader is released on the error exit path.
      expect(reader.cancel).toHaveBeenCalled();

      // close() after failure is idempotent — no double-cancel throw.
      expect(() => sub.close()).not.toThrow();
      expect(() => sub.close()).not.toThrow();
    });
  });

  describe("onError throws", () => {
    it("swallows the onError failure — subscription closed, no unhandled rejection", async () => {
      const { response, reader } = mockSseResponse([
        { value: sseChunk(makeEvent("1")) },
        { value: sseChunk(makeEvent("2")) },
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn().mockImplementation(() => {
        throw new Error("consumer boom");
      });
      const onError = vi.fn().mockImplementation(() => {
        throw new Error("error handler boom");
      });
      const sub = client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });

      // Subscription closed: loop exited after the failure.
      await flush();
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(reader.cancel).toHaveBeenCalled();

      expect(() => sub.close()).not.toThrow();
      expect(() => sub.close()).not.toThrow();
      // afterEach asserts unhandledRejections is empty.
    });

    it("does not leak when onError throws on a fetch failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      const onError = vi.fn().mockImplementation(() => {
        throw new Error("error handler boom");
      });
      const sub = client.events.subscribeWithFetch(undefined, vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });
      expect(() => sub.close()).not.toThrow();
      // afterEach asserts unhandledRejections is empty.
    });
  });

  describe("fetch rejects before the read loop", () => {
    it("reports via onError; reader is never allocated", async () => {
      const netErr = new Error("network down");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(netErr));

      const onEvent = vi.fn();
      const onError = vi.fn();
      const sub = client.events.subscribeWithFetch(undefined, onEvent, onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(netErr);
      });
      expect(onEvent).not.toHaveBeenCalled();
      expect(() => sub.close()).not.toThrow();
    });

    it("non-ok response: reports via onError without ever allocating a reader", async () => {
      const { response, getReader } = mockSseResponse([], 503);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onError = vi.fn();
      const sub = client.events.subscribeWithFetch(undefined, vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((onError.mock.calls[0]?.[0] as Error).message).toContain("SSE fetch failed: 503");
      expect(getReader).not.toHaveBeenCalled();
      expect(() => sub.close()).not.toThrow();
    });
  });

  describe("reader.read() rejects mid-loop", () => {
    it("reports via onError and cancels the reader", async () => {
      const readErr = new Error("read boom");
      const { response, reader } = mockSseResponse([
        { value: sseChunk(makeEvent("1")) },
        { reject: readErr },
      ]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onEvent = vi.fn();
      const onError = vi.fn();
      const sub = client.events.subscribeWithFetch(["crystal.created"], onEvent, onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(readErr);
      });
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(makeEvent("1"));

      // The reader is cancelled on the rejecting-read exit path.
      expect(reader.cancel).toHaveBeenCalled();

      expect(() => sub.close()).not.toThrow();
      expect(() => sub.close()).not.toThrow();
    });

    it("a rejecting reader.cancel() never escapes", async () => {
      const readErr = new Error("read boom");
      const { response, reader } = mockSseResponse([{ reject: readErr }]);
      reader.cancel.mockRejectedValue(new Error("cancel boom"));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const onError = vi.fn();
      client.events.subscribeWithFetch(undefined, vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(readErr);
      });
      expect(reader.cancel).toHaveBeenCalled();
      // afterEach asserts unhandledRejections is empty.
    });
  });
});

// ============================================================================
// Deprecated subscribe() — silent-credential-drop gate (Initiative 7 step 1)
// ============================================================================

describe("EventsResource.subscribe (deprecated EventSource path)", () => {
  let client: EngramClient;

  // Low-entropy placeholder bound to a neutrally-named var (ADR-006 gate).
  const placeholder = "test-key";

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: placeholder,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws InsecureEventSourceError when the opt-in flag is absent", () => {
    expect(() =>
      client.events.subscribe(["crystal.created"], vi.fn(), vi.fn())
    ).toThrow(InsecureEventSourceError);
  });

  it("throws when allowInsecureEventSource is explicitly false", () => {
    expect(() =>
      client.events.subscribe(["crystal.created"], vi.fn(), vi.fn(), {
        allowInsecureEventSource: false,
      })
    ).toThrow(InsecureEventSourceError);
  });

  it("never constructs an EventSource on the throwing path", () => {
    const EventSourceCtor = vi.fn();
    vi.stubGlobal("EventSource", EventSourceCtor);
    expect(() => client.events.subscribe(undefined, vi.fn())).toThrow(
      InsecureEventSourceError
    );
    expect(EventSourceCtor).not.toHaveBeenCalled();
  });

  it("constructs the EventSource when the caller opts in", () => {
    const close = vi.fn();
    const urls: string[] = [];
    class FakeEventSource {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(url: string) {
        urls.push(url);
      }
      close = close;
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    const sub = client.events.subscribe(["crystal.created"], vi.fn(), vi.fn(), {
      allowInsecureEventSource: true,
    });

    expect(urls).toEqual(["http://localhost:3100/events?types=crystal.created"]);
    expect(() => sub.close()).not.toThrow();
    expect(close).toHaveBeenCalled();
  });
});

// ============================================================================
// subscribeIter() — AsyncIterable delivery (Initiative 7 step 2)
// ============================================================================

describe("EventsResource.subscribeIter", () => {
  let client: EngramClient;
  let unhandledRejections: unknown[];
  const trap = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  // Low-entropy placeholder bound to a neutrally-named var (ADR-006 gate).
  const placeholder = "test-key";

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: placeholder,
    });
    unhandledRejections = [];
    process.on("unhandledRejection", trap);
  });

  afterEach(async () => {
    await flush();
    process.removeListener("unhandledRejection", trap);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    expect(unhandledRejections).toEqual([]);
  });

  it("yields parsed events from the SSE stream, then completes on done", async () => {
    const { response } = mockSseResponse([
      { value: sseChunk(makeEvent("1")) },
      { value: sseChunk(makeEvent("2")) },
      { value: sseChunk(makeEvent("3")) },
      { done: true },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const received: BaseEngramStreamEvent[] = [];
    for await (const event of client.events.subscribeIter(["crystal.created"])) {
      received.push(event);
    }

    expect(received).toEqual([makeEvent("1"), makeEvent("2"), makeEvent("3")]);
  });

  it("reassembles a data frame split across two chunks", async () => {
    const full = `data: ${JSON.stringify(makeEvent("split"))}\n\n`;
    const cut = Math.floor(full.length / 2);
    const part1 = new TextEncoder().encode(full.slice(0, cut));
    const part2 = new TextEncoder().encode(full.slice(cut));

    const { response } = mockSseResponse([
      { value: part1 },
      { value: part2 },
      { done: true },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const received: BaseEngramStreamEvent[] = [];
    for await (const event of client.events.subscribeIter()) {
      received.push(event);
    }

    expect(received).toEqual([makeEvent("split")]);
  });

  it("terminates cleanly when aborted via AbortSignal (no throw, no leak)", async () => {
    const feed = pushReader();
    vi.stubGlobal("fetch", feed.fetch);

    const ac = new AbortController();
    const received: BaseEngramStreamEvent[] = [];

    feed.push(sseChunk(makeEvent("1")));

    const consume = (async () => {
      for await (const event of client.events.subscribeIter(undefined, {
        signal: ac.signal,
      })) {
        received.push(event);
        if (received.length === 1) ac.abort();
      }
    })();

    await consume; // resolves (no rejection) on abort
    expect(received).toEqual([makeEvent("1")]);
    // The underlying fetch was aborted — reader released.
    await vi.waitFor(() => {
      expect(feed.reader.cancel).toHaveBeenCalled();
    });
  });

  it("throws EventStreamOverflowError when the consumer falls behind", async () => {
    const feed = pushReader();
    vi.stubGlobal("fetch", feed.fetch);

    const iterable = client.events.subscribeIter(undefined, { highWaterMark: 2 });
    const iterator = iterable[Symbol.asyncIterator]();

    // Pull once to kick off the fetch/read loop, draining one event.
    feed.push(sseChunk(makeEvent("a")));
    const first = await iterator.next();
    expect(first.value).toEqual(makeEvent("a"));

    // Now flood past the high-water mark without consuming. With hwm=2, the
    // third buffered event (d) trips the overflow and tears the stream down.
    feed.push(sseChunk(makeEvent("b")));
    feed.push(sseChunk(makeEvent("c")));
    feed.push(sseChunk(makeEvent("d")));
    await flush();

    // Already-buffered events are still delivered first (no silent loss); the
    // overflow surfaces once the queue drains.
    let overflow: unknown = null;
    const drained: BaseEngramStreamEvent[] = [];
    try {
      // Bounded loop: at most a handful of pulls before the error surfaces.
      for (let i = 0; i < 10; i++) {
        const r = await iterator.next();
        if (r.done) break;
        drained.push(r.value);
      }
    } catch (err) {
      overflow = err;
    }

    expect(overflow).toBeInstanceOf(EventStreamOverflowError);
    // Every event buffered before the overflow tripped was delivered, not
    // dropped — the failure is surfaced after the queue drains.
    expect(drained).toEqual([makeEvent("b"), makeEvent("c"), makeEvent("d")]);
  });

  it("surfaces a fetch failure as a thrown error on the iterator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const iterator = client.events
      .subscribeIter(undefined)
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("network down");
  });

  it("surfaces a malformed frame as a thrown error on the iterator", async () => {
    const malformed = new TextEncoder().encode("data: {not json\n\n");
    const { response } = mockSseResponse([{ value: malformed }, { done: true }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const iterator = client.events
      .subscribeIter(undefined)
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("Malformed SSE frame");
  });

  it("breaking out of the loop tears the subscription down", async () => {
    const feed = pushReader();
    vi.stubGlobal("fetch", feed.fetch);

    feed.push(sseChunk(makeEvent("1")));

    const received: BaseEngramStreamEvent[] = [];
    for await (const event of client.events.subscribeIter()) {
      received.push(event);
      break; // .return() should abort the fetch and release the reader
    }

    expect(received).toEqual([makeEvent("1")]);
    await vi.waitFor(() => {
      expect(feed.reader.cancel).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression: a terminal error delivered to a PARKED consumer (queue empty,
  // next() already awaiting) must surface exactly once. The synchronous next()
  // branch reset terminalError to null after rejecting; settleNext() (the
  // parked branch) did not — so the same error was thrown a second time on the
  // following next() instead of the contractual { done: true }.
  // ──────────────────────────────────────────────────────────────────────────
  it("surfaces a terminal error to a parked consumer exactly once, then completes", async () => {
    const feed = pushReader();
    vi.stubGlobal("fetch", feed.fetch);

    const iterator = client.events.subscribeIter()[Symbol.asyncIterator]();

    // Park the consumer: call next() while the queue is empty and the stream
    // has produced nothing yet.
    const pending = iterator.next();

    // Now produce a malformed frame, which fails the stream and rejects the
    // parked promise.
    feed.push(new TextEncoder().encode("data: {not json\n\n"));
    await expect(pending).rejects.toThrow("Malformed SSE frame");

    // Contract: the error is surfaced once. The very next pull must complete
    // the iterator, NOT re-throw the same terminal error.
    const after = await iterator.next();
    expect(after).toEqual({ value: undefined, done: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression: the AbortSignal "abort" listener was only removed inside
  // return() (early break). When the iterator drains to normal completion
  // (server done) the listener leaked, so a long-lived caller signal kept a
  // dead listener — and this iterator's whole closure — reachable per
  // completed subscription.
  // ──────────────────────────────────────────────────────────────────────────
  it("removes its AbortSignal listener on normal completion (no leak)", async () => {
    const { response } = mockSseResponse([
      { value: sseChunk(makeEvent("1")) },
      { done: true },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const ac = new AbortController();
    const before = getEventListeners(ac.signal, "abort").length;

    const received: BaseEngramStreamEvent[] = [];
    for await (const event of client.events.subscribeIter(undefined, {
      signal: ac.signal,
    })) {
      received.push(event);
    }

    expect(received).toEqual([makeEvent("1")]);
    // The listener registered for the duration of the subscription is gone.
    expect(getEventListeners(ac.signal, "abort").length).toBe(before);
  });

  it("removes its AbortSignal listener after a terminal stream error (no leak)", async () => {
    const malformed = new TextEncoder().encode("data: {not json\n\n");
    const { response } = mockSseResponse([{ value: malformed }, { done: true }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const ac = new AbortController();
    const before = getEventListeners(ac.signal, "abort").length;

    const iterator = client.events
      .subscribeIter(undefined, { signal: ac.signal })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("Malformed SSE frame");

    await vi.waitFor(() => {
      expect(getEventListeners(ac.signal, "abort").length).toBe(before);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Concurrent iteration: each [Symbol.asyncIterator]() call returns a fresh
  // iterator with its own queue, AbortController, and underlying SSE fetch.
  // Multiple consumers of the SAME AsyncIterable must not share state or steal
  // each other's events.
  // ──────────────────────────────────────────────────────────────────────────
  describe("concurrent iteration over the same AsyncIterable", () => {
    it("gives each Symbol.asyncIterator call an independent iterator + fetch", async () => {
      // Each fetch call gets its OWN reader (independent stream state); both
      // emit the same logical events so we can assert each consumer drains its
      // own copy rather than racing over a shared queue.
      const fetchStub = vi.fn().mockImplementation(() => {
        const { response } = mockSseResponse([
          { value: sseChunk(makeEvent("1")) },
          { value: sseChunk(makeEvent("2")) },
          { done: true },
        ]);
        return Promise.resolve(response);
      });
      vi.stubGlobal("fetch", fetchStub);

      const iterable = client.events.subscribeIter(["crystal.created"]);

      const receivedA: BaseEngramStreamEvent[] = [];
      const receivedB: BaseEngramStreamEvent[] = [];

      // Drive both iterators concurrently off the same AsyncIterable.
      await Promise.all([
        (async () => {
          for await (const ev of iterable) receivedA.push(ev);
        })(),
        (async () => {
          for await (const ev of iterable) receivedB.push(ev);
        })(),
      ]);

      // Each consumer received the full, independent stream — no stealing.
      expect(receivedA).toEqual([makeEvent("1"), makeEvent("2")]);
      expect(receivedB).toEqual([makeEvent("1"), makeEvent("2")]);
      // One fetch (= one SSE connection) was opened per iterator.
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it("one iterator failing does not affect a concurrent healthy iterator", async () => {
      const malformed = new TextEncoder().encode("data: {not json\n\n");
      // First fetch (failing iterator) yields a malformed frame; second
      // (healthy iterator) yields a clean event then ends.
      const fetchStub = vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve(mockSseResponse([{ value: malformed }, { done: true }]).response)
        )
        .mockImplementationOnce(() =>
          Promise.resolve(
            mockSseResponse([{ value: sseChunk(makeEvent("ok")) }, { done: true }]).response
          )
        );
      vi.stubGlobal("fetch", fetchStub);

      const iterable = client.events.subscribeIter();

      const failing = iterable[Symbol.asyncIterator]();
      const healthy = iterable[Symbol.asyncIterator]();

      await expect(failing.next()).rejects.toThrow("Malformed SSE frame");

      // The healthy iterator is unaffected by the other's terminal error.
      const first = await healthy.next();
      expect(first).toEqual({ value: makeEvent("ok"), done: false });
      const end = await healthy.next();
      expect(end).toEqual({ value: undefined, done: true });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // highWaterMark edge cases: zero, negative, and other invalid values must
  // fall back to DEFAULT_HIGH_WATER_MARK (1024) rather than producing a
  // zero/negative bound that would overflow on the first event.
  // ──────────────────────────────────────────────────────────────────────────
  describe("highWaterMark defaulting", () => {
    for (const hwm of [0, -1, -1000, Number.NaN]) {
      it(`defaults to 1024 for an invalid highWaterMark (${String(hwm)}) — no spurious overflow`, async () => {
        // Buffer several events without consuming. With the default 1024 bound
        // these all fit; a broken default of 0/negative would trip overflow on
        // the first event and reject instead of delivering cleanly.
        const { response } = mockSseResponse([
          { value: sseChunk(makeEvent("1")) },
          { value: sseChunk(makeEvent("2")) },
          { value: sseChunk(makeEvent("3")) },
          { done: true },
        ]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

        const received: BaseEngramStreamEvent[] = [];
        for await (const ev of client.events.subscribeIter(undefined, {
          highWaterMark: hwm,
        })) {
          received.push(ev);
        }

        expect(received).toEqual([makeEvent("1"), makeEvent("2"), makeEvent("3")]);
      });
    }
  });
});
