/**
 * Facts Resource Tests
 *
 * Tests for the FactsResource SDK pattern.
 * Facts are bi-temporal versioned key-value pairs with point-in-time queries
 * and full version history.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type { Fact } from "../../src/resources/facts.js";

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

// ============================================================================
// Fixtures
// ============================================================================

const FACT_ID = "00000000-0000-4000-8000-000000000001";

const mockFact: Fact = {
  id: FACT_ID,
  key: "user.preferences.theme",
  value: { mode: "dark" },
  validFrom: "2026-01-01T00:00:00Z",
  validTo: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ============================================================================
// Test Setup
// ============================================================================

describe("FactsResource", () => {
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
  // facts.create()
  // ==========================================================================

  describe("facts.create", () => {
    it("should POST to /v1/facts", async () => {
      mockFetch = mockFetchResponse({ data: mockFact }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.create({
        key: "user.preferences.theme",
        value: { mode: "dark" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/facts",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            key: "user.preferences.theme",
            value: { mode: "dark" },
          }),
        })
      );

      expect(result.id).toBe(FACT_ID);
      expect(result.key).toBe("user.preferences.theme");
      expect(result.value).toEqual({ mode: "dark" });
    });

    it("throws EngramError on validation failure", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "VALIDATION_FAILED", message: "key is required" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.facts.create({ key: "", value: {} })
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // ==========================================================================
  // facts.get()
  // ==========================================================================

  describe("facts.get", () => {
    it("should GET /v1/facts/:id", async () => {
      mockFetch = mockFetchResponse({ data: mockFact });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.get(FACT_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/facts/${FACT_ID}`,
        expect.objectContaining({ method: "GET" })
      );

      expect(result.id).toBe(FACT_ID);
      expect(result.key).toBe("user.preferences.theme");
    });

    it("should GET /v1/facts/:id?asOf=... with asOf query param", async () => {
      const asOf = "2026-03-15T00:00:00Z";
      const historicalFact: Fact = {
        ...mockFact,
        value: { mode: "light" },
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2026-02-01T00:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: historicalFact });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.get(FACT_ID, { asOf });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`/v1/facts/${FACT_ID}`);
      expect(calledUrl).toContain(`asOf=${encodeURIComponent(asOf)}`);

      expect(result.value).toEqual({ mode: "light" });
    });

    it("throws EngramError on 404", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "NOT_FOUND", message: "Fact not found" } },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.facts.get(FACT_ID)).rejects.toBeInstanceOf(
        EngramError
      );
    });
  });

  // ==========================================================================
  // facts.getByKey()
  // ==========================================================================

  describe("facts.getByKey", () => {
    it("should GET /v1/facts?key=...", async () => {
      mockFetch = mockFetchResponse({ data: mockFact });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.getByKey("user.preferences.theme");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/facts?");
      expect(calledUrl).toContain("key=user.preferences.theme");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "GET" })
      );

      expect(result.key).toBe("user.preferences.theme");
    });

    it("throws EngramError on 404", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "NOT_FOUND", message: "Fact not found" } },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.facts.getByKey("nonexistent.key")
      ).rejects.toBeInstanceOf(EngramError);
    });
  });

  // ==========================================================================
  // facts.update()
  // ==========================================================================

  describe("facts.update", () => {
    it("should PATCH /v1/facts/:id", async () => {
      const updatedFact: Fact = {
        ...mockFact,
        value: { mode: "light" },
        updatedAt: "2026-02-01T00:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: updatedFact });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.update(FACT_ID, {
        value: { mode: "light" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/facts/${FACT_ID}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ value: { mode: "light" } }),
        })
      );

      expect(result.value).toEqual({ mode: "light" });
    });
  });

  // ==========================================================================
  // facts.getHistory()
  // ==========================================================================

  describe("facts.getHistory", () => {
    it("should GET /v1/facts/:id/history", async () => {
      const versions: Fact[] = [
        { ...mockFact, value: { mode: "dark" }, validFrom: "2026-02-01T00:00:00Z", validTo: null },
        { ...mockFact, value: { mode: "light" }, validFrom: "2026-01-01T00:00:00Z", validTo: "2026-02-01T00:00:00Z" },
      ];

      mockFetch = mockFetchResponse({
        data: versions,
        meta: { pagination: { total: 2, limit: 50, offset: 0, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.getHistory(FACT_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/facts/${FACT_ID}/history`,
        expect.objectContaining({ method: "GET" })
      );

      expect(result.versions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should pass validFrom, validTo, limit, and offset as query params", async () => {
      mockFetch = mockFetchResponse({
        data: [mockFact],
        meta: { pagination: { total: 5, limit: 10, offset: 2, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.facts.getHistory(FACT_ID, {
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2026-03-01T00:00:00Z",
        limit: 10,
        offset: 2,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`/v1/facts/${FACT_ID}/history?`);
      expect(calledUrl).toContain("validFrom=2026-01-01T00%3A00%3A00Z");
      expect(calledUrl).toContain("validTo=2026-03-01T00%3A00%3A00Z");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=2");

      expect(result.versions).toHaveLength(1);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });
  });
});
