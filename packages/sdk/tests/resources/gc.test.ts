/**
 * GC (Garbage Collection) Resource Tests
 *
 * Tests for the GcResource SDK pattern (engram Knowledge API).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "../../src/client.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ "content-type": "application/json" }),
  });
}

describe("GcResource", () => {
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

  describe("gc.getCandidates", () => {
    it("should GET /v1/gc/candidates", async () => {
      const mockCandidates = [
        { id: "c-1", title: "Old Crystal", relevanceScore: 0.1, nodeType: "collection" },
        { id: "c-2", title: "Stale Note", relevanceScore: 0.2, nodeType: "note" },
      ];

      mockFetch = mockFetchResponse({
        data: { candidates: mockCandidates, threshold: 0.3, total: 5 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.gc.getCandidates();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/gc/candidates",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.candidates).toHaveLength(2);
      expect(result.threshold).toBe(0.3);
      expect(result.total).toBe(5);
    });

    it("should pass threshold and limit query params", async () => {
      mockFetch = mockFetchResponse({
        data: { candidates: [], threshold: 0.5, total: 0 },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.gc.getCandidates({ threshold: 0.5, limit: 10 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/gc/candidates?");
      expect(calledUrl).toContain("threshold=0.5");
      expect(calledUrl).toContain("limit=10");
    });
  });

  describe("gc.getAuditLog", () => {
    it("should GET /v1/gc/audit", async () => {
      const mockEntries = [
        {
          id: "gc-run-1",
          runAt: "2026-01-25T10:00:00Z",
          decayCurve: "exponential",
          threshold: 0.3,
          scannedCrystals: 100,
          archivedCrystals: 5,
          scannedNotes: 200,
          archivedNotes: 10,
          dryRun: false,
          details: {},
        },
        {
          id: "gc-run-2",
          runAt: "2026-01-24T10:00:00Z",
          decayCurve: "exponential",
          threshold: 0.3,
          scannedCrystals: 90,
          archivedCrystals: 3,
          scannedNotes: 180,
          archivedNotes: 7,
          dryRun: true,
          details: {},
        },
      ];

      mockFetch = mockFetchResponse({
        data: { entries: mockEntries, total: 2 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.gc.getAuditLog();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/gc/audit",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("gc.run", () => {
    it("should POST to /v1/gc/run", async () => {
      const mockResult = {
        scannedCrystals: 100,
        archivedCrystals: 5,
        scannedNotes: 200,
        archivedNotes: 10,
        dryRun: false,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.gc.run();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/gc/run",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.scannedCrystals).toBe(100);
      expect(result.archivedCrystals).toBe(5);
      expect(result.dryRun).toBe(false);
    });

    it("should pass dryRun as POST body when specified", async () => {
      const mockResult = {
        scannedCrystals: 100,
        archivedCrystals: 5,
        scannedNotes: 200,
        archivedNotes: 10,
        dryRun: true,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.gc.run({ dryRun: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/gc/run",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ dryRun: true }),
        })
      );

      expect(result.dryRun).toBe(true);
    });
  });
});
