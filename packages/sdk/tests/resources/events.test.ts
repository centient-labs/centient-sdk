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
import { EngramClient } from "../../src/client.js";
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

// ============================================================================
// Tests
// ============================================================================

describe("EventsResource.subscribeWithFetch", () => {
  let client: EngramClient;
  let unhandledRejections: unknown[];
  const trap = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
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
              "X-API-Key": "test-key",
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
