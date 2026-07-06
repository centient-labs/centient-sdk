/**
 * Consolidation-events Resource Tests (engram-server #938/#939).
 *
 * Covers the three reads (list-by-session, list-by-status/review-queue,
 * get-one), the two constrained writes (consolidate dry-run|live, undo), the
 * status query-param serialization, 404 → NotFoundError on get, 403 →
 * AUTH_FORBIDDEN on a read-only key writing, 409 → RES_CONFLICT on a
 * not-undoable event, and ResponseShapeError on envelope/contract drift.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError, NotFoundError, ResponseShapeError } from "../../src/errors.js";
import type {
  ConsolidationEvent,
  ConsolidationResult,
  ConsolidationUndoResult,
} from "../../src/types/consolidation.js";

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** The nested `{ error: { code, message, details? } }` envelope engram emits. */
function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

// ============================================================================
// Fixtures
// ============================================================================

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

const completedEvent: ConsolidationEvent = {
  id: EVENT_ID,
  sessionId: SESSION_ID,
  strategy: "balanced",
  status: "completed",
  triggeredBy: "manual",
  promotedCount: 2,
  queuedCount: 1,
  droppedCount: 0,
  promotedItemIds: ["note-a", "note-b"],
  queuedItemIds: ["note-c"],
  droppedItemIds: [],
  dryRun: false,
  undoneAt: null,
  undoneBy: null,
  deferredUntil: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  completedAt: "2026-07-01T00:00:05.000Z",
};

const pendingEvent: ConsolidationEvent = {
  ...completedEvent,
  id: "33333333-3333-4333-8333-333333333333",
  status: "pending",
  completedAt: null,
};

const dryRunResult: ConsolidationResult = {
  consolidationId: "dry-run",
  status: "pending",
  promotedCount: 2,
  queuedCount: 1,
  droppedCount: 0,
  promotedItemIds: ["note-a", "note-b"],
  queuedItemIds: ["note-c"],
  droppedItemIds: [],
  dryRun: true,
  promotionAdvisory: {
    autoPromoted: ["note-a", "note-b"],
    queued: ["note-c"],
    dropped: [],
    strategyUsed: "balanced",
    dryRun: true,
  },
};

const liveResult: ConsolidationResult = {
  ...dryRunResult,
  consolidationId: EVENT_ID,
  status: "in_progress",
  dryRun: false,
  promotionAdvisory: { ...dryRunResult.promotionAdvisory, dryRun: false },
};

const undoResult: ConsolidationUndoResult = {
  consolidationId: EVENT_ID,
  undoneAt: "2026-07-05T00:00:00.000Z",
  restoredNoteCount: 2,
  archivedCrystalCount: 2,
};

/** The paginated envelope the list routes emit. */
function paginated(events: ConsolidationEvent[]) {
  return {
    success: true,
    data: events,
    meta: { pagination: { total: events.length, limit: events.length, hasMore: false } },
  };
}

// ============================================================================
// Test Setup
// ============================================================================

describe("ConsolidationEventsResource", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      retries: 1,
    });
    mockFetch = mockFetchResponse({});
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // listBySession()
  // ==========================================================================

  describe("consolidationEvents.listBySession", () => {
    it("GETs a session's events and returns them with pagination", async () => {
      mockFetch = mockFetchResponse(paginated([completedEvent, pendingEvent]));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.listBySession(SESSION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/sessions/${SESSION_ID}/consolidation-events`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.events).toHaveLength(2);
      expect(result.events[0].id).toBe(EVENT_ID);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("throws ResponseShapeError when data is not an array", async () => {
      const bad = mockFetchResponse({ success: true, data: { not: "an array" } });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.listBySession(SESSION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when the data envelope is missing", async () => {
      const bad = mockFetchResponse({ success: true, events: [] });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.listBySession(SESSION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // listByStatus()  — review queue
  // ==========================================================================

  describe("consolidationEvents.listByStatus", () => {
    it("serializes the status query param and returns the queue", async () => {
      mockFetch = mockFetchResponse(paginated([pendingEvent]));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.listByStatus("pending");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        "http://localhost:3100/v1/consolidation-events?status=pending",
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0].status).toBe("pending");
    });

    it("passes through other lifecycle statuses (e.g. undone)", async () => {
      mockFetch = mockFetchResponse(paginated([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.consolidationEvents.listByStatus("undone");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("status=undone");
    });

    it("surfaces hasMore:true unchanged from meta.pagination", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: [pendingEvent],
        meta: { pagination: { total: 1, limit: 1, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.listByStatus("pending");
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(1);
    });

    it("throws ResponseShapeError when meta.pagination is absent (no silent data.length fallback)", async () => {
      // The consolidation list routes use the STRICT paginated envelope —
      // total/hasMore are always emitted, so their absence is contract drift.
      const bad = mockFetchResponse({ success: true, data: [pendingEvent] });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.listByStatus("pending"),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when meta.pagination.total is missing", async () => {
      const bad = mockFetchResponse({
        success: true,
        data: [pendingEvent],
        meta: { pagination: { limit: 1, hasMore: false } },
      });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.listByStatus("pending"),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // get()
  // ==========================================================================

  describe("consolidationEvents.get", () => {
    it("GETs a single event by id", async () => {
      mockFetch = mockFetchResponse({ success: true, data: completedEvent });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.get(EVENT_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/consolidation-events/${EVENT_ID}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.id).toBe(EVENT_ID);
      expect(result.status).toBe("completed");
    });

    it("throws NotFoundError (404 RES_NOT_FOUND) on an absent event", async () => {
      mockFetch = mockFetchResponse(
        errorBody("RES_NOT_FOUND", `No consolidation event with id "${EVENT_ID}"`),
        404,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.consolidationEvents.get(EVENT_ID).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("RES_NOT_FOUND");
      expect((err as NotFoundError).statusCode).toBe(404);
    });

    it("throws ResponseShapeError when a contract field is missing", async () => {
      // `data` present but missing `status` — a drifted body must fail loudly.
      const { status, ...withoutStatus } = completedEvent;
      void status;
      const bad = mockFetchResponse({ success: true, data: withoutStatus });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.get(EVENT_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // consolidate()
  // ==========================================================================

  describe("consolidationEvents.consolidate", () => {
    it("POSTs a bare dry-run preview (empty body) and returns the advisory", async () => {
      mockFetch = mockFetchResponse({ success: true, data: dryRunResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.consolidate(SESSION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/sessions/${SESSION_ID}/consolidate`,
        expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
      );
      expect(result.consolidationId).toBe("dry-run");
      expect(result.dryRun).toBe(true);
      expect(result.promotionAdvisory.autoPromoted).toEqual(["note-a", "note-b"]);
    });

    it("POSTs a live run with strategy and dryRun:false", async () => {
      mockFetch = mockFetchResponse({ success: true, data: liveResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.consolidate(SESSION_ID, {
        strategy: "aggressive",
        dryRun: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ strategy: "aggressive", dryRun: false }),
        }),
      );
      expect(result.consolidationId).toBe(EVENT_ID);
      expect(result.status).toBe("in_progress");
    });

    it("sends only strategy when dryRun is omitted (server defaults dryRun:true)", async () => {
      mockFetch = mockFetchResponse({ success: true, data: dryRunResult });
      vi.stubGlobal("fetch", mockFetch);

      await client.consolidationEvents.consolidate(SESSION_ID, {
        strategy: "aggressive",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ strategy: "aggressive" }),
        }),
      );
    });

    it("sends only dryRun when strategy is omitted (server defaults balanced)", async () => {
      mockFetch = mockFetchResponse({ success: true, data: liveResult });
      vi.stubGlobal("fetch", mockFetch);

      await client.consolidationEvents.consolidate(SESSION_ID, { dryRun: false });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ dryRun: false }),
        }),
      );
    });

    it("throws a 403 EngramError (AUTH_FORBIDDEN) for a read-only key", async () => {
      mockFetch = mockFetchResponse(
        errorBody("AUTH_FORBIDDEN", "Write permission required"),
        403,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.consolidationEvents
        .consolidate(SESSION_ID, { dryRun: false })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("AUTH_FORBIDDEN");
      expect((err as EngramError).statusCode).toBe(403);
    });

    it("throws ResponseShapeError when consolidationId is missing", async () => {
      const { consolidationId, ...rest } = dryRunResult;
      void consolidationId;
      const bad = mockFetchResponse({ success: true, data: rest });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.consolidate(SESSION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when promotionAdvisory is missing", async () => {
      const { promotionAdvisory, ...rest } = dryRunResult;
      void promotionAdvisory;
      const bad = mockFetchResponse({ success: true, data: rest });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.consolidate(SESSION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when a promotionAdvisory sub-field is reshaped", async () => {
      // autoPromoted arrives as a string instead of an id array — the nested
      // contract is validated with the same rigor as the top-level fields.
      const bad = mockFetchResponse({
        success: true,
        data: {
          ...dryRunResult,
          promotionAdvisory: {
            ...dryRunResult.promotionAdvisory,
            autoPromoted: "note-a,note-b",
          },
        },
      });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.consolidate(SESSION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // undo()
  // ==========================================================================

  describe("consolidationEvents.undo", () => {
    it("POSTs the undo action and returns the revert counts", async () => {
      mockFetch = mockFetchResponse({ success: true, data: undoResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.consolidationEvents.undo(EVENT_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/consolidation-events/${EVENT_ID}/undo`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.consolidationId).toBe(EVENT_ID);
      expect(result.restoredNoteCount).toBe(2);
      expect(result.archivedCrystalCount).toBe(2);
    });

    it("throws NotFoundError on a 404 (no such event)", async () => {
      mockFetch = mockFetchResponse(
        errorBody("RES_NOT_FOUND", "No consolidation event"),
        404,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.consolidationEvents.undo(EVENT_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws a 409 EngramError (RES_CONFLICT) when not undoable, carrying reason", async () => {
      mockFetch = mockFetchResponse(
        errorBody(
          "RES_CONFLICT",
          "This consolidation is not in an undoable state",
          { reason: "NOT_UNDOABLE" },
        ),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.consolidationEvents.undo(EVENT_ID).catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("RES_CONFLICT");
      expect((err as EngramError).statusCode).toBe(409);
      expect((err as EngramError).details).toMatchObject({ reason: "NOT_UNDOABLE" });
    });

    it("throws a 409 EngramError when the 60-day window has expired", async () => {
      mockFetch = mockFetchResponse(
        errorBody(
          "RES_CONFLICT",
          "The 60-day undo window for this consolidation has expired",
          { reason: "UNDO_WINDOW_EXPIRED" },
        ),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.consolidationEvents.undo(EVENT_ID).catch((e) => e);
      expect((err as EngramError).details).toMatchObject({
        reason: "UNDO_WINDOW_EXPIRED",
      });
    });

    it("throws ResponseShapeError when a numeric count field is missing", async () => {
      const { restoredNoteCount, ...rest } = undoResult;
      void restoredNoteCount;
      const bad = mockFetchResponse({ success: true, data: rest });
      vi.stubGlobal("fetch", bad);

      await expect(
        client.consolidationEvents.undo(EVENT_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });
});
