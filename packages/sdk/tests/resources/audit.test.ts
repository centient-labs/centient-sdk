/**
 * Audit Resource Tests
 *
 * Tests for the AuditResource SDK pattern (engram Knowledge API).
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

describe("AuditResource", () => {
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

  describe("audit.ingest", () => {
    it("should POST to /v1/audit/ingest", async () => {
      mockFetch = mockFetchResponse({ data: { accepted: true } });
      vi.stubGlobal("fetch", mockFetch);

      const event = {
        level: "info" as const,
        component: "test-component",
        message: "Test audit event",
        eventType: "tool_call" as const,
      };

      const result = await client.audit.ingest(event);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/ingest",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(event),
        })
      );

      expect(result.accepted).toBe(true);
    });
  });

  describe("audit.ingestBatch", () => {
    it("should POST to /v1/audit/ingest/batch with events array", async () => {
      mockFetch = mockFetchResponse({ data: { accepted: 2 } });
      vi.stubGlobal("fetch", mockFetch);

      const events = [
        { level: "info" as const, component: "comp-a", message: "Event 1" },
        { level: "warn" as const, component: "comp-b", message: "Event 2" },
      ];

      const result = await client.audit.ingestBatch(events);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/ingest/batch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ events }),
        })
      );

      expect(result.accepted).toBe(2);
    });
  });

  describe("audit.flush", () => {
    it("should POST to /v1/audit/flush", async () => {
      mockFetch = mockFetchResponse({ data: { flushed: true } });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.audit.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/flush",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.flushed).toBe(true);
    });
  });

  describe("audit.listEvents", () => {
    it("should GET /v1/audit/events", async () => {
      const mockEvents = [
        { id: "evt-1", level: "info", component: "comp-a", message: "Event 1" },
        { id: "evt-2", level: "warn", component: "comp-b", message: "Event 2" },
      ];

      mockFetch = mockFetchResponse({
        data: mockEvents,
        meta: { pagination: { total: 2, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.audit.listEvents();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/events",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should pass query params including comma-joined arrays", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 10, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.audit.listEvents({
        level: ["info", "warn"],
        component: "test-comp",
        eventType: ["tool_call", "session_start"],
        since: "2026-01-01T00:00:00Z",
        until: "2026-12-31T23:59:59Z",
        limit: 10,
        offset: 5,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/audit/events?");
      expect(calledUrl).toContain("level=info%2Cwarn");
      expect(calledUrl).toContain("component=test-comp");
      expect(calledUrl).toContain("eventType=tool_call%2Csession_start");
      expect(calledUrl).toContain("since=2026-01-01T00%3A00%3A00Z");
      expect(calledUrl).toContain("until=2026-12-31T23%3A59%3A59Z");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=5");
    });
  });

  describe("audit.getEvent", () => {
    it("should GET /v1/audit/events/:id", async () => {
      const mockEvent = {
        id: "evt-123",
        level: "info",
        component: "test-comp",
        message: "Test event",
        timestamp: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockEvent });
      vi.stubGlobal("fetch", mockFetch);

      const event = await client.audit.getEvent("evt-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/events/evt-123",
        expect.objectContaining({ method: "GET" })
      );

      expect(event.id).toBe("evt-123");
      expect(event.message).toBe("Test event");
    });
  });

  describe("audit.getStats", () => {
    it("should GET /v1/audit/stats", async () => {
      const mockStats = {
        totalEvents: 150,
        eventsByType: { tool_call: 100, session_start: 50 },
        eventsByLevel: { info: 120, warn: 30 },
        recentActivity: [{ date: "2026-01-25", count: 42 }],
      };

      mockFetch = mockFetchResponse({ data: mockStats });
      vi.stubGlobal("fetch", mockFetch);

      const stats = await client.audit.getStats();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/stats",
        expect.objectContaining({ method: "GET" })
      );

      expect(stats.totalEvents).toBe(150);
      expect(stats.eventsByType.tool_call).toBe(100);
    });
  });

  describe("audit.prune", () => {
    it("should DELETE /v1/audit/prune with olderThanDays param", async () => {
      mockFetch = mockFetchResponse({ data: { deleted: 42 } });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.audit.prune(30);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/audit/prune?olderThanDays=30",
        expect.objectContaining({ method: "DELETE" })
      );

      expect(result.deleted).toBe(42);
    });
  });
});
