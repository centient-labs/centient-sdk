/**
 * Sessions Resource Tests
 *
 * Tests for the resource-based SDK pattern (engram Knowledge API).
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

describe("SessionsResource", () => {
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

  describe("sessions.create", () => {
    it("should POST to /v1/sessions", async () => {
      const mockSession = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        externalId: "test-session",
        projectPath: "/test/project",
        status: "active",
        startedAt: "2026-01-24T10:00:00Z",
        endedAt: null,
        metadata: {},
        createdAt: "2026-01-24T10:00:00Z",
        updatedAt: "2026-01-24T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockSession }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const session = await client.sessions.create({
        externalId: "test-session",
        projectPath: "/test/project",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            externalId: "test-session",
            projectPath: "/test/project",
          }),
        })
      );

      expect(session.id).toBe(mockSession.id);
      expect(session.externalId).toBe("test-session");
    });
  });

  describe("sessions.get", () => {
    it("should GET /v1/sessions/:id", async () => {
      const mockSession = {
        id: "123",
        externalId: "test-session",
        projectPath: "/test",
        status: "active",
      };

      mockFetch = mockFetchResponse({ data: mockSession });
      vi.stubGlobal("fetch", mockFetch);

      const session = await client.sessions.get("test-session");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/test-session",
        expect.objectContaining({ method: "GET" })
      );

      expect(session.externalId).toBe("test-session");
    });
  });

  describe("sessions.list", () => {
    it("should GET /v1/sessions with query params", async () => {
      const mockSessions = [
        { id: "1", externalId: "s1", projectPath: "/test" },
        { id: "2", externalId: "s2", projectPath: "/test" },
      ];

      mockFetch = mockFetchResponse({
        data: mockSessions,
        meta: { pagination: { total: 2, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sessions.list({
        projectPath: "/test",
        status: "active",
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/sessions?"),
        expect.objectContaining({ method: "GET" })
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("projectPath=%2Ftest");
      expect(calledUrl).toContain("status=active");
      expect(calledUrl).toContain("limit=10");

      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("sessions.update", () => {
    it("should PATCH /v1/sessions/:id", async () => {
      const mockSession = {
        id: "123",
        externalId: "test-session",
        status: "finalized",
      };

      mockFetch = mockFetchResponse({ data: mockSession });
      vi.stubGlobal("fetch", mockFetch);

      const session = await client.sessions.update("test-session", {
        status: "finalized",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/test-session",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "finalized" }),
        })
      );

      expect(session.status).toBe("finalized");
    });
  });

  describe("sessions.delete", () => {
    it("should DELETE /v1/sessions/:id", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sessions.delete("test-session");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/test-session",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

describe("SessionNotesResource", () => {
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

  describe("sessions.notes(id).create", () => {
    it("should POST to /v1/sessions/:id/notes", async () => {
      const mockNote = {
        id: "note-123",
        sessionId: "session-123",
        type: "decision",
        content: "Use PostgreSQL",
        embeddingStatus: "pending",
        metadata: {},
      };

      mockFetch = mockFetchResponse({ data: mockNote }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const note = await client.sessions.notes("session-123").create({
        type: "decision",
        content: "Use PostgreSQL",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/session-123/notes",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            type: "decision",
            content: "Use PostgreSQL",
          }),
        })
      );

      expect(note.type).toBe("decision");
    });
  });

  describe("sessions.notes(id).list", () => {
    it("should GET /v1/sessions/:id/notes", async () => {
      const mockNotes = [
        { id: "1", type: "decision", content: "Note 1" },
        { id: "2", type: "hypothesis", content: "Note 2" },
      ];

      mockFetch = mockFetchResponse({
        data: mockNotes,
        meta: { pagination: { total: 2, limit: 100, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sessions.notes("session-123").list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/session-123/notes",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.notes).toHaveLength(2);
    });

    it("should filter by type", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 100, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sessions.notes("session-123").list({ type: "decision" });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("type=decision");
    });
  });

  describe("sessions.notes(id).search", () => {
    it("should POST to /v1/sessions/:id/notes/search", async () => {
      const mockResults = [
        { id: "1", type: "decision", content: "Database", score: 0.95 },
      ];

      mockFetch = mockFetchResponse({ data: mockResults });
      vi.stubGlobal("fetch", mockFetch);

      const results = await client.sessions.notes("session-123").search({
        query: "database",
        limit: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/session-123/notes/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "database", limit: 5 }),
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
    });
  });
});

describe("NotesResource", () => {
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

  describe("notes.get", () => {
    it("should GET /v1/notes/:id", async () => {
      const mockNote = {
        id: "note-123",
        sessionId: "session-123",
        type: "decision",
        content: "Test note",
      };

      mockFetch = mockFetchResponse({ data: mockNote });
      vi.stubGlobal("fetch", mockFetch);

      const note = await client.notes.get("note-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/notes/note-123",
        expect.objectContaining({ method: "GET" })
      );

      expect(note.id).toBe("note-123");
    });
  });

  describe("notes.update", () => {
    it("should PATCH /v1/notes/:id", async () => {
      const mockNote = {
        id: "note-123",
        type: "decision",
        content: "Updated content",
      };

      mockFetch = mockFetchResponse({ data: mockNote });
      vi.stubGlobal("fetch", mockFetch);

      const note = await client.notes.update("note-123", {
        content: "Updated content",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/notes/note-123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ content: "Updated content" }),
        })
      );

      expect(note.content).toBe("Updated content");
    });
  });

  describe("notes.delete", () => {
    it("should DELETE /v1/notes/:id", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.notes.delete("note-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/notes/note-123",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("notes.search", () => {
    it("should POST to /v1/notes/search for global search", async () => {
      const mockResults = [
        { id: "1", sessionId: "s1", type: "decision", score: 0.9 },
        { id: "2", sessionId: "s2", type: "learning", score: 0.8 },
      ];

      mockFetch = mockFetchResponse({ data: mockResults });
      vi.stubGlobal("fetch", mockFetch);

      const results = await client.notes.search({
        query: "test query",
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/notes/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "test query", limit: 10 }),
        })
      );

      expect(results).toHaveLength(2);
    });
  });
});

describe("SessionsResource lifecycle stats", () => {
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

  describe("sessions.getLifecycleStats", () => {
    it("should GET /v1/sessions/:id/lifecycle-stats and return a status histogram", async () => {
      const mockStats = {
        draft: 1,
        active: 5,
        finalized: 2,
        archived: 0,
        superseded: 0,
        merged: 0,
      };
      mockFetch = mockFetchResponse({ data: mockStats });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sessions.getLifecycleStats("session-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sessions/session-1/lifecycle-stats",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(mockStats);
    });

    it("should include all six lifecycle statuses in the returned histogram", async () => {
      // Pin the full key set. If the server adds a new LifecycleStatus
      // variant, this test catches the SDK type drifting from the server.
      const mockStats = {
        draft: 0,
        active: 0,
        finalized: 0,
        archived: 0,
        superseded: 0,
        merged: 0,
      };
      mockFetch = mockFetchResponse({ data: mockStats });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sessions.getLifecycleStats("any-session");
      expect(Object.keys(result).sort()).toEqual(
        ["active", "archived", "draft", "finalized", "merged", "superseded"],
      );
    });
  });
});
