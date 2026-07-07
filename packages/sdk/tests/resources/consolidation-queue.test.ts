/**
 * Consolidation Queue Read Tests (engram-server 0.50.0, #1167/#1174 —
 * issue #143).
 *
 * Covers `consolidationEvents.queue()` → `GET /v1/consolidations/queue`
 * (note the `/v1/consolidations/*` route family, distinct from
 * `/v1/consolidation-events`): the per-note review-queue rows with score
 * breakdowns that the event list does not carry.
 *
 * Plus:
 *   - query-param serialization (sessionId, status, limit, offset) and the
 *     client-side range checks (limit 1–100, offset >= 0 — typed
 *     VALIDATION_INPUT_INVALID BEFORE any fetch).
 *   - contract-parity: EVERY schema-required field of ConsolidationQueueItem
 *     (the nested ConsolidationQueueScoreBreakdown components included) and of
 *     the pagination envelope (total, limit, hasMore) is asserted by the
 *     runtime guards — omitting any one throws ResponseShapeError.
 *
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError, ResponseShapeError } from "../../src/errors.js";
import type { ConsolidationQueueItem } from "../../src/types/consolidation.js";

// ============================================================================
// Helpers
// ============================================================================

function mockJsonResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// ============================================================================
// Fixtures
// ============================================================================

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";

const queueItem: ConsolidationQueueItem = {
  consolidationEventId: EVENT_ID,
  noteId: NOTE_ID,
  noteSummary: "decided to gate the legacy subscribe path behind an opt-in",
  noteType: "decision",
  compositeScore: 0.63,
  scoreBreakdown: { coherence: 0.7, uniqueness: 0.6, quality: 0.57 },
  strategy: "balanced",
  status: "pending",
  createdAt: "2026-07-01T00:00:00.000Z",
};

/** The paginated `{ success, data, meta.pagination }` envelope the route emits. */
function queueEnvelope(
  items: unknown[],
  pagination: Record<string, unknown> = {
    total: items.length,
    limit: 20,
    hasMore: false,
  },
) {
  return { success: true, data: items, meta: { pagination } };
}

// ============================================================================
// Test Setup
// ============================================================================

// Low-entropy placeholder bound to a neutrally-named var so the secret
// scanner doesn't flag the fixture (the repo's scanner-safe fixture
// convention, see tests/client.test.ts).
const placeholder = "test-api-key";

let client: EngramClient;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new EngramClient({
    baseUrl: "http://localhost:3100",
    apiKey: placeholder,
    timeout: 5000,
    retries: 1,
  });
  mockFetch = mockJsonResponse({});
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ============================================================================
// consolidationEvents.queue()
// ============================================================================

describe("client.consolidationEvents.queue()", () => {
  it("GETs /v1/consolidations/queue with no params", async () => {
    mockFetch = mockJsonResponse(queueEnvelope([queueItem]));
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.consolidationEvents.queue();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/consolidations/queue",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].noteId).toBe(NOTE_ID);
    expect(result.items[0].compositeScore).toBe(0.63);
    expect(result.items[0].scoreBreakdown.coherence).toBe(0.7);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.hasMore).toBe(false);
    expect(result.offset).toBeUndefined();
    expect(result.cursor).toBeUndefined();
  });

  it("hits the /v1/consolidations/* route family, not /v1/consolidation-events", async () => {
    mockFetch = mockJsonResponse(queueEnvelope([]));
    vi.stubGlobal("fetch", mockFetch);

    await client.consolidationEvents.queue();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v1/consolidations/queue");
    expect(calledUrl).not.toContain("/v1/consolidation-events");
  });

  it("serializes sessionId, status, limit, and offset query params", async () => {
    mockFetch = mockJsonResponse(queueEnvelope([]));
    vi.stubGlobal("fetch", mockFetch);

    await client.consolidationEvents.queue({
      sessionId: SESSION_ID,
      status: "pending",
      limit: 50,
      offset: 10,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`sessionId=${SESSION_ID}`);
    expect(calledUrl).toContain("status=pending");
    expect(calledUrl).toContain("limit=50");
    expect(calledUrl).toContain("offset=10");
  });

  it("omits query params that were not supplied", async () => {
    mockFetch = mockJsonResponse(queueEnvelope([]));
    vi.stubGlobal("fetch", mockFetch);

    await client.consolidationEvents.queue({ status: "completed" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("status=completed");
    expect(calledUrl).not.toContain("sessionId");
    expect(calledUrl).not.toContain("limit");
    expect(calledUrl).not.toContain("offset");
  });

  it("passes through the optional offset and cursor pagination fields when emitted", async () => {
    mockFetch = mockJsonResponse(
      queueEnvelope([queueItem], {
        total: 41,
        limit: 20,
        hasMore: true,
        offset: 20,
        cursor: "opaque-cursor",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.consolidationEvents.queue({ offset: 20 });

    expect(result.total).toBe(41);
    expect(result.hasMore).toBe(true);
    expect(result.offset).toBe(20);
    expect(result.cursor).toBe("opaque-cursor");
  });

  for (const [label, value] of [
    ["zero", 0],
    ["above 100", 101],
    ["not an integer", 1.5],
    ["negative", -1],
    // Non-finite values must fail client-side (Number.isInteger rejects
    // them): a serialized Infinity would reach the wire as garbage.
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ] as Array<[string, number]>) {
    it(`throws VALIDATION_INPUT_INVALID before fetching when limit is ${label}`, async () => {
      await expect(
        client.consolidationEvents.queue({ limit: value }),
      ).rejects.toMatchObject({
        name: "EngramError",
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  for (const [label, value] of [
    ["negative", -1],
    ["not an integer", 2.5],
    // Non-finite values must fail client-side (Number.isInteger rejects
    // them): a serialized Infinity would reach the wire as garbage.
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ] as Array<[string, number]>) {
    it(`throws VALIDATION_INPUT_INVALID before fetching when offset is ${label}`, async () => {
      await expect(
        client.consolidationEvents.queue({ offset: value }),
      ).rejects.toMatchObject({
        name: "EngramError",
        code: "VALIDATION_INPUT_INVALID",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  // Contract-parity: every schema-required field of ConsolidationQueueItem is
  // asserted by the runtime guard — omitting any one throws ResponseShapeError.
  for (const field of [
    "consolidationEventId",
    "noteId",
    "noteSummary",
    "noteType",
    "compositeScore",
    "scoreBreakdown",
    "strategy",
    "status",
    "createdAt",
  ] as const) {
    it(`throws ResponseShapeError when a queue item is missing "${field}"`, async () => {
      const drifted: Record<string, unknown> = { ...queueItem };
      delete drifted[field];
      mockFetch = mockJsonResponse(queueEnvelope([drifted]));
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  }

  // Contract-parity for the nested score breakdown: coherence, uniqueness,
  // quality are each required components.
  for (const component of ["coherence", "uniqueness", "quality"] as const) {
    it(`throws ResponseShapeError when scoreBreakdown is missing "${component}"`, async () => {
      const breakdown: Record<string, unknown> = { ...queueItem.scoreBreakdown };
      delete breakdown[component];
      mockFetch = mockJsonResponse(
        queueEnvelope([{ ...queueItem, scoreBreakdown: breakdown }]),
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  }

  it("throws ResponseShapeError when scoreBreakdown is not an object", async () => {
    mockFetch = mockJsonResponse(
      queueEnvelope([{ ...queueItem, scoreBreakdown: 0.63 }]),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it("throws ResponseShapeError when a queue item is not an object", async () => {
    mockFetch = mockJsonResponse(queueEnvelope(["not-an-item"]));
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it("throws ResponseShapeError when data is not an array", async () => {
    mockFetch = mockJsonResponse({
      success: true,
      data: { items: [] },
      meta: { pagination: { total: 0, limit: 20, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  // Contract-parity for the pagination envelope: total, limit, hasMore are
  // required by the response schema (offset/cursor are optional).
  for (const field of ["total", "limit", "hasMore"] as const) {
    it(`throws ResponseShapeError when meta.pagination is missing "${field}"`, async () => {
      const pagination: Record<string, unknown> = {
        total: 1,
        limit: 20,
        hasMore: false,
      };
      delete pagination[field];
      mockFetch = mockJsonResponse(queueEnvelope([queueItem], pagination));
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  }

  it("throws ResponseShapeError when meta.pagination is absent entirely", async () => {
    mockFetch = mockJsonResponse({ success: true, data: [queueItem] });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it("throws EngramError on a 404 (server below the 0.50.0 feature floor)", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "RES_NOT_FOUND", message: "no such route" } },
      404,
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.consolidationEvents.queue()).rejects.toBeInstanceOf(
      EngramError,
    );
  });

  it("throws EngramError on a 400 (server-side validation)", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALID_INVALID_FORMAT", message: "bad sessionId" } },
      400,
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.consolidationEvents.queue({ sessionId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(EngramError);
  });
});
