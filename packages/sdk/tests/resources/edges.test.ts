/**
 * Edges Resource Tests
 *
 * Tests for the EdgesResource SDK pattern (engram Knowledge API).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";

// Helper to create mock fetch response
function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("EdgesResource", () => {
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

  describe("edges.create", () => {
    it("should POST to /v1/edges", async () => {
      const mockEdge = {
        id: "edge-123",
        sourceId: "knowledge-1",
        targetId: "knowledge-2",
        relationship: "derived_from",
        metadata: { reason: "Test relationship" },
        createdAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockEdge }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const edge = await client.edges.create({
        sourceId: "knowledge-1",
        targetId: "knowledge-2",
        relationship: "derived_from",
        metadata: { reason: "Test relationship" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/edges",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sourceId: "knowledge-1",
            targetId: "knowledge-2",
            relationship: "derived_from",
            metadata: { reason: "Test relationship" },
          }),
        })
      );

      expect(edge.id).toBe(mockEdge.id);
      expect(edge.relationship).toBe("derived_from");
    });
  });

  describe("edges.get", () => {
    it("should GET /v1/edges/:id", async () => {
      const mockEdge = {
        id: "edge-123",
        sourceId: "knowledge-1",
        targetId: "knowledge-2",
        relationship: "related_to",
        metadata: {},
        createdAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockEdge });
      vi.stubGlobal("fetch", mockFetch);

      const edge = await client.edges.get("edge-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/edges/edge-123",
        expect.objectContaining({ method: "GET" })
      );

      expect(edge.id).toBe("edge-123");
      expect(edge.relationship).toBe("related_to");
    });
  });

  describe("edges.list", () => {
    it("should GET /v1/edges with query params", async () => {
      const mockEdges = [
        { id: "e1", sourceId: "k1", targetId: "k2", relationship: "derived_from" },
        { id: "e2", sourceId: "k1", targetId: "k3", relationship: "derived_from" },
      ];

      mockFetch = mockFetchResponse({
        data: mockEdges,
        meta: { pagination: { total: 2, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.edges.list({
        sourceId: "k1",
        relationship: "derived_from",
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/edges?"),
        expect.objectContaining({ method: "GET" })
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("sourceId=k1");
      expect(calledUrl).toContain("relationship=derived_from");
      expect(calledUrl).toContain("limit=10");

      expect(result.edges).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter by targetId", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.edges.list({
        targetId: "target-123",
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("targetId=target-123");
    });

    it("should handle pagination", async () => {
      mockFetch = mockFetchResponse({
        data: [{ id: "e1" }],
        meta: { pagination: { total: 100, limit: 10, offset: 20, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.edges.list({
        limit: 10,
        offset: 20,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=20");

      expect(result.total).toBe(100);
      expect(result.hasMore).toBe(true);
    });
  });

  describe("edges.update", () => {
    it("should PATCH /v1/edges/:id", async () => {
      const mockEdge = {
        id: "edge-123",
        sourceId: "k1",
        targetId: "k2",
        relationship: "derived_from",
        metadata: { updated: true },
        createdAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockEdge });
      vi.stubGlobal("fetch", mockFetch);

      const edge = await client.edges.update("edge-123", {
        metadata: { updated: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/edges/edge-123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            metadata: { updated: true },
          }),
        })
      );

      expect(edge.metadata).toEqual({ updated: true });
    });
  });

  describe("edges.delete", () => {
    it("should DELETE /v1/edges/:id", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.edges.delete("edge-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/edges/edge-123",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
