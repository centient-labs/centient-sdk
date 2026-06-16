/**
 * Crystal Dedup-Merge Resource Tests
 *
 * Tests for the deferred-merge review lifecycle exposed on CrystalsResource
 * (issue #81): pendingMerges(), reviewMerge(), mergeHistory(). These routes
 * return BARE `{ success, ... }` objects — NOT the standard `{ data }`
 * envelope — so the tests assert both the request wire-shape and that the
 * non-enveloped payload is parsed (and shape-guarded) correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type {
  PendingMerge,
  MergeRecord,
} from "../../src/resources/crystals.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data) ?? ""),
  });
}

const MERGE_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const mockPendingMerge: PendingMerge = {
  mergeId: MERGE_ID,
  sourceId: "source-1",
  targetId: "target-1",
  sourceType: "session_note",
  targetType: "knowledge_crystal",
  confidence: 0.92,
  mergeMethod: "semantic",
  mergeOutcomeStrategy: "oldest_wins",
  createdAt: "2026-06-13T10:00:00Z",
};

const mockMergeRecord: MergeRecord = {
  id: "merge-record-1",
  sourceNoteId: "source-1",
  sourceCrystalId: null,
  targetCrystalId: "target-1",
  mergeMethod: "semantic",
  mergeOutcomeStrategy: "oldest_wins",
  similarityScore: 0.92,
  mergeReason: "coherence_gate",
  mergedContentSnapshot: { title: "merged" },
  mergedBy: "agent-1",
  mergedAt: "2026-06-13T10:00:00Z",
  reversible: true,
  reverseRecordId: null,
  createdAt: "2026-06-13T10:00:00Z",
};

describe("CrystalsResource dedup-merge lifecycle", () => {
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
  // crystals.pendingMerges()
  // ==========================================================================

  describe("crystals.pendingMerges", () => {
    it("GETs /v1/crystals/merges/pending and unwraps the bare payload", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        pending: [mockPendingMerge],
        total: 1,
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.pendingMerges();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/merges/pending",
        expect.objectContaining({ method: "GET" })
      );
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].mergeId).toBe(MERGE_ID);
      expect(result.total).toBe(1);
    });

    it("passes session_id and limit as query params", async () => {
      mockFetch = mockFetchResponse({ success: true, pending: [], total: 0 });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.pendingMerges({ sessionId: "sess-1", limit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/merges/pending?session_id=sess-1&limit=50",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("throws when the pending array is missing (contract drift)", async () => {
      mockFetch = mockFetchResponse({ success: true, total: 0 });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.crystals.pendingMerges()).rejects.toBeInstanceOf(
        EngramError
      );
    });

    it("throws EngramError on 500", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INTERNAL_ERROR", message: "boom" } },
        500
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.crystals.pendingMerges()).rejects.toBeInstanceOf(
        EngramError
      );
    });
  });

  // ==========================================================================
  // crystals.reviewMerge()
  // ==========================================================================

  describe("crystals.reviewMerge", () => {
    it("POSTs the decision to /merges/:id/review", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        decision: "approve",
        targetCrystalId: "target-1",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.reviewMerge(MERGE_ID, {
        decision: "approve",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/crystals/merges/${MERGE_ID}/review`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ decision: "approve" }),
        })
      );
      expect(result.decision).toBe("approve");
      expect(result.targetCrystalId).toBe("target-1");
    });

    it("maps mergedContent to the snake_case merged_content wire field", async () => {
      mockFetch = mockFetchResponse({ success: true, decision: "modify" });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.reviewMerge(MERGE_ID, {
        decision: "modify",
        mergedContent: "resolved text",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            decision: "modify",
            merged_content: "resolved text",
          }),
        })
      );
    });

    it("throws EngramError on 400 (invalid decision)", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INVALID_DECISION", message: "bad" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.reviewMerge(MERGE_ID, { decision: "approve" })
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("throws EngramError on 409 (merge no longer pending)", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "MERGE_REVIEW_ERROR", message: "not in pending" } },
        409
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.reviewMerge(MERGE_ID, { decision: "reject" })
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // ==========================================================================
  // crystals.mergeHistory()
  // ==========================================================================

  describe("crystals.mergeHistory", () => {
    it("GETs /merges/history/:id and unwraps the bare chain", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        id: ITEM_ID,
        merge_chain: [mockMergeRecord],
        total: 1,
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.mergeHistory(ITEM_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/crystals/merges/history/${ITEM_ID}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result.id).toBe(ITEM_ID);
      expect(result.mergeChain).toHaveLength(1);
      expect(result.mergeChain[0].targetCrystalId).toBe("target-1");
      expect(result.total).toBe(1);
    });

    it("throws when merge_chain is missing (contract drift)", async () => {
      mockFetch = mockFetchResponse({ success: true, id: ITEM_ID, total: 0 });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.mergeHistory(ITEM_ID)
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("throws EngramError on 400 (invalid UUID)", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "INVALID_ID", message: "not a uuid" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.mergeHistory("not-a-uuid")
      ).rejects.toBeInstanceOf(EngramError);
    });
  });
});
