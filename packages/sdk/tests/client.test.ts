/**
 * EngramClient Tests
 *
 * Tests for all SDK client methods, mocking fetch to verify correct API calls.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient, createEngramClient } from "../src/client.js";
import {
  EngramError,
  NetworkError,
  NotFoundError,
  TimeoutError,
} from "../src/errors.js";

// Helper to create mock fetch response
function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data) ?? ""),
  });
}

describe("EngramClient", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-api-key",
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

  describe("Constructor", () => {
    it("should create client with config", () => {
      const client = new EngramClient({
        baseUrl: "http://test:3100",
        apiKey: "key",
      });
      expect(client).toBeInstanceOf(EngramClient);
    });

    it("should remove trailing slash from base URL", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100/",
      });
      mockFetch = mockFetchResponse({ status: "ok", version: "1.0.0" });
      vi.stubGlobal("fetch", mockFetch);

      await client.health();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/health",
        expect.any(Object)
      );
    });

    it("keeps apiKey readable but non-enumerable (excluded from serialization)", () => {
      // Low-entropy placeholder bound to a neutrally-named var so the secret
      // scanner doesn't flag the fixture; the assertions below check
      // enumerability, not the literal value.
      const placeholder = "test-key";
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        apiKey: placeholder,
      });

      // Readable for internal use…
      expect(client.apiKey).toBe(placeholder);
      // …but non-enumerable, so excluded from enumeration / spread (the paths a
      // structured logger or serializer would walk).
      expect(Object.getOwnPropertyDescriptor(client, "apiKey")?.enumerable).toBe(
        false
      );
      expect(Object.keys(client)).not.toContain("apiKey");
      expect(Object.entries(client).map(([k]) => k)).not.toContain("apiKey");
      expect({ ...client }).not.toHaveProperty("apiKey");
    });
  });

  describe("createEngramClient", () => {
    it("should create client from environment variables", () => {
      process.env.ENGRAM_URL = "http://env-url:3100";
      process.env.ENGRAM_API_KEY = "env-api-key";

      const client = createEngramClient();
      expect(client).toBeInstanceOf(EngramClient);

      delete process.env.ENGRAM_URL;
      delete process.env.ENGRAM_API_KEY;
    });

    it("should use overrides over environment", () => {
      process.env.ENGRAM_URL = "http://env-url:3100";

      const client = createEngramClient({ baseUrl: "http://override:3100" });
      expect(client).toBeInstanceOf(EngramClient);

      delete process.env.ENGRAM_URL;
    });
  });

  // ============================================
  // Session Operations
  // ============================================

  describe("Session Operations", () => {
    describe("createSession", () => {
      it("should POST to /v1/sessions", async () => {
        mockFetch = mockFetchResponse(
          {
            id: "test-session",
            projectPath: "/test",
            collectionName: "test-collection",
            embeddingPreset: "balanced",
            createdAt: "2026-01-18T10:00:00Z",
          },
          201
        );
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.createSession({
          sessionId: "test-session",
          projectPath: "/test",
          embeddingPreset: "balanced",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              "X-API-Key": "test-api-key",
            }),
            body: JSON.stringify({
              sessionId: "test-session",
              projectPath: "/test",
              embeddingPreset: "balanced",
            }),
          })
        );
        expect(result.id).toBe("test-session");
      });
    });

    describe("getSession", () => {
      it("should GET /v1/sessions/:sessionId", async () => {
        mockFetch = mockFetchResponse({
          id: "test-session",
          projectPath: "/test",
          stats: { totalNotes: 5 },
        });
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.getSession("test-session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session",
          expect.objectContaining({ method: "GET" })
        );
        expect(result.id).toBe("test-session");
      });

      it("should encode session ID in URL", async () => {
        mockFetch = mockFetchResponse({ id: "test/session" });
        vi.stubGlobal("fetch", mockFetch);

        await client.getSession("test/session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test%2Fsession",
          expect.any(Object)
        );
      });
    });

    describe("deleteSession", () => {
      it("should DELETE /v1/sessions/:sessionId", async () => {
        mockFetch = mockFetchResponse(undefined, 204);
        vi.stubGlobal("fetch", mockFetch);

        await client.deleteSession("test-session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session",
          expect.objectContaining({ method: "DELETE" })
        );
      });
    });
  });

  // ============================================
  // Note Operations
  // ============================================

  describe("Note Operations", () => {
    describe("createNote", () => {
      it("should POST to /v1/sessions/:sessionId/notes", async () => {
        mockFetch = mockFetchResponse(
          { id: 1, type: "decision", content: "Test" },
          201
        );
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.createNote("test-session", {
          type: "decision",
          content: "Test decision",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              type: "decision",
              content: "Test decision",
            }),
          })
        );
        expect(result.id).toBe(1);
      });
    });

    describe("listNotes", () => {
      it("should GET /v1/sessions/:sessionId/notes", async () => {
        mockFetch = mockFetchResponse({ notes: [], total: 0 });
        vi.stubGlobal("fetch", mockFetch);

        await client.listNotes("test-session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes",
          expect.any(Object)
        );
      });

      it("should include type filter in query params", async () => {
        mockFetch = mockFetchResponse({ notes: [], total: 0 });
        vi.stubGlobal("fetch", mockFetch);

        await client.listNotes("test-session", { type: "decision" });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes?type=decision",
          expect.any(Object)
        );
      });

      it("should include limit in query params", async () => {
        mockFetch = mockFetchResponse({ notes: [], total: 0 });
        vi.stubGlobal("fetch", mockFetch);

        await client.listNotes("test-session", { limit: 10 });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes?limit=10",
          expect.any(Object)
        );
      });
    });

    describe("getNote", () => {
      it("should GET /v1/sessions/:sessionId/notes/:noteId", async () => {
        mockFetch = mockFetchResponse({ id: 1, content: "Test" });
        vi.stubGlobal("fetch", mockFetch);

        await client.getNote("test-session", 1);

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes/1",
          expect.any(Object)
        );
      });
    });

    describe("addRelationship", () => {
      it("should POST to /v1/sessions/:sessionId/notes/:noteId/relationships", async () => {
        mockFetch = mockFetchResponse({ success: true }, 201);
        vi.stubGlobal("fetch", mockFetch);

        await client.addRelationship("test-session", 1, {
          targetNoteId: 2,
          relationship: "caused_by",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes/1/relationships",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              targetNoteId: 2,
              relationship: "caused_by",
            }),
          })
        );
      });
    });

    describe("getCausalChain", () => {
      it("should GET /v1/sessions/:sessionId/notes/:noteId/causal-chain", async () => {
        mockFetch = mockFetchResponse({ chain: [], startNoteId: 1, maxDepth: 5 });
        vi.stubGlobal("fetch", mockFetch);

        await client.getCausalChain("test-session", 1);

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/notes/1/causal-chain?maxDepth=5",
          expect.any(Object)
        );
      });

      it("should use custom maxDepth", async () => {
        mockFetch = mockFetchResponse({ chain: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.getCausalChain("test-session", 1, 3);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("maxDepth=3"),
          expect.any(Object)
        );
      });
    });
  });

  // ============================================
  // Search Operations
  // ============================================

  describe("Search Operations", () => {
    describe("search", () => {
      it("should POST to /v1/sessions/:sessionId/search", async () => {
        mockFetch = mockFetchResponse({ results: [], query: "test", took: 50 });
        vi.stubGlobal("fetch", mockFetch);

        await client.search("test-session", { query: "test query", limit: 5 });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/search",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ query: "test query", limit: 5 }),
          })
        );
      });
    });

    describe("checkDuplicate", () => {
      it("should POST to /v1/sessions/:sessionId/duplicate-check", async () => {
        mockFetch = mockFetchResponse({ hasDuplicates: false, duplicates: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.checkDuplicate("test-session", {
          description: "Test task",
          threshold: 0.75,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/duplicate-check",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Drift Operations
  // ============================================

  describe("Drift Operations", () => {
    describe("getDrift", () => {
      it("should GET /v1/sessions/:sessionId/drift", async () => {
        mockFetch = mockFetchResponse({ sessionId: "test", noteCount: 5 });
        vi.stubGlobal("fetch", mockFetch);

        await client.getDrift("test-session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/drift",
          expect.any(Object)
        );
      });

      it("should include query params for options", async () => {
        mockFetch = mockFetchResponse({ sessionId: "test" });
        vi.stubGlobal("fetch", mockFetch);

        await client.getDrift("test-session", {
          includeHistory: true,
          includePerTypeAnalysis: false,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("includeHistory=true"),
          expect.any(Object)
        );
      });
    });
  });

  // ============================================
  // Constraint Operations
  // ============================================

  describe("Constraint Operations", () => {
    describe("createConstraint", () => {
      it("should POST to /v1/sessions/:sessionId/constraints", async () => {
        mockFetch = mockFetchResponse({ id: "c-1", content: "No APIs" }, 201);
        vi.stubGlobal("fetch", mockFetch);

        await client.createConstraint("test-session", {
          content: "No external APIs",
          scope: "session",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/constraints",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("listConstraints", () => {
      it("should GET /v1/sessions/:sessionId/constraints", async () => {
        mockFetch = mockFetchResponse({ constraints: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.listConstraints("test-session");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/constraints",
          expect.any(Object)
        );
      });
    });

    describe("liftConstraint", () => {
      it("should DELETE /v1/sessions/:sessionId/constraints/:id", async () => {
        mockFetch = mockFetchResponse(undefined, 204);
        vi.stubGlobal("fetch", mockFetch);

        await client.liftConstraint("test-session", "constraint-1");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/constraints/constraint-1",
          expect.objectContaining({ method: "DELETE" })
        );
      });
    });

    describe("checkViolation", () => {
      it("should POST to /v1/sessions/:sessionId/check-violation", async () => {
        mockFetch = mockFetchResponse({ violated: false, violations: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.checkViolation("test-session", {
          proposedAction: "Call external API",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/sessions/test-session/check-violation",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Memory Bank Operations
  // ============================================

  describe("Memory Bank Operations", () => {
    describe("searchMemoryBank", () => {
      it("should POST to /v1/memory-bank/search", async () => {
        mockFetch = mockFetchResponse({ memories: [], query: "test" });
        vi.stubGlobal("fetch", mockFetch);

        await client.searchMemoryBank({
          query: "auth decisions",
          projectName: "test-project",
          topK: 5,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/memory-bank/search",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("listMemories", () => {
      it("should GET /v1/memory-bank/:projectName/memories", async () => {
        mockFetch = mockFetchResponse({ memories: [], total: 0 });
        vi.stubGlobal("fetch", mockFetch);

        await client.listMemories("test-project");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/memory-bank/test-project/memories",
          expect.any(Object)
        );
      });

      it("should include limit in query params", async () => {
        mockFetch = mockFetchResponse({ memories: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.listMemories("test-project", { limit: 25 });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/memory-bank/test-project/memories?limit=25",
          expect.any(Object)
        );
      });
    });

    describe("pushToMemoryBank", () => {
      it("should POST to /v1/memory-bank/:projectName/push", async () => {
        mockFetch = mockFetchResponse({ pushed: 5 });
        vi.stubGlobal("fetch", mockFetch);

        await client.pushToMemoryBank("test-project", {
          finalizationPackPath: "/path/to/pack.json",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/memory-bank/test-project/push",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Pattern Operations
  // ============================================

  describe("Pattern Operations", () => {
    describe("searchPatterns", () => {
      it("should GET /v1/patterns/search", async () => {
        mockFetch = mockFetchResponse({ patterns: [], total: 0 });
        vi.stubGlobal("fetch", mockFetch);

        await client.searchPatterns({ keyword: "auth" });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/patterns/search?keyword=auth",
          expect.any(Object)
        );
      });

      it("should include all query params", async () => {
        mockFetch = mockFetchResponse({ patterns: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.searchPatterns({
          keyword: "auth",
          category: "security",
          limit: 10,
          includeExecutable: true,
        });

        const call = mockFetch.mock.calls[0][0];
        expect(call).toContain("keyword=auth");
        expect(call).toContain("category=security");
        expect(call).toContain("limit=10");
        expect(call).toContain("includeExecutable=true");
      });
    });

    describe("getPattern", () => {
      it("should GET /v1/patterns/:patternId", async () => {
        mockFetch = mockFetchResponse({ id: "security/auth" });
        vi.stubGlobal("fetch", mockFetch);

        await client.getPattern("security/auth");

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/patterns/security%2Fauth",
          expect.any(Object)
        );
      });

      it("should include options in query params", async () => {
        mockFetch = mockFetchResponse({ id: "security/auth", code: "..." });
        vi.stubGlobal("fetch", mockFetch);

        await client.getPattern("security/auth", {
          includeCode: true,
          version: "1.0.0",
        });

        const call = mockFetch.mock.calls[0][0];
        expect(call).toContain("includeCode=true");
        expect(call).toContain("version=1.0.0");
      });
    });

    describe("trackPatternUsage", () => {
      it("should POST to /v1/patterns/:patternId/usage", async () => {
        mockFetch = mockFetchResponse({ usageCount: 5 });
        vi.stubGlobal("fetch", mockFetch);

        await client.trackPatternUsage("security/auth", {
          outcome: "success",
          context: "Used in auth module",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/patterns/security%2Fauth/usage",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Retrieval Operations
  // ============================================

  describe("Retrieval Operations", () => {
    describe("retrieve", () => {
      it("should POST to /v1/retrieve", async () => {
        mockFetch = mockFetchResponse({ answer: "...", confidence: 0.9 });
        vi.stubGlobal("fetch", mockFetch);

        await client.retrieve({
          query: "How to implement auth?",
          sessionId: "test-session",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/retrieve",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("expandQuery", () => {
      it("should POST to /v1/expand", async () => {
        mockFetch = mockFetchResponse({ original: "test", expansions: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.expandQuery({ query: "database security" });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/expand",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("synthesize", () => {
      it("should POST to /v1/synthesize", async () => {
        mockFetch = mockFetchResponse({ answer: "...", confidence: 0.8 });
        vi.stubGlobal("fetch", mockFetch);

        await client.synthesize({
          query: "test",
          results: [{ content: "Result 1" }],
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/synthesize",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Graph Operations
  // ============================================

  describe("Graph Operations", () => {
    describe("queryGraph", () => {
      it("should POST to /v1/graph/query", async () => {
        mockFetch = mockFetchResponse({ nodes: [], edges: [] });
        vi.stubGlobal("fetch", mockFetch);

        await client.queryGraph({
          queryType: "causal_chain",
          sessionId: "test-session",
          startNode: 1,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/graph/query",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("linkSessions", () => {
      it("should POST to /v1/graph/sessions/link", async () => {
        mockFetch = mockFetchResponse({ success: true });
        vi.stubGlobal("fetch", mockFetch);

        await client.linkSessions({
          sourceSession: "session-2",
          targetSession: "session-1",
          relationship: "builds_on",
          projectPath: "/path",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/graph/sessions/link",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    describe("createGraphRelationship", () => {
      it("should POST to /v1/graph/notes/:noteId/relationships", async () => {
        mockFetch = mockFetchResponse({ success: true });
        vi.stubGlobal("fetch", mockFetch);

        await client.createGraphRelationship(5, {
          sessionId: "test-session",
          targetNoteId: 3,
          relationship: "caused_by",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/graph/notes/5/relationships",
          expect.objectContaining({ method: "POST" })
        );
      });
    });
  });

  // ============================================
  // Admin Operations
  // ============================================

  describe("Admin Operations", () => {
    describe("getAdminStats", () => {
      it("should GET /v1/admin/stats", async () => {
        mockFetch = mockFetchResponse({
          redis: {
            sessionCount: 5,
            health: { connected: true, latencyMs: 2 },
          },
          localCache: {
            sessionCount: 3,
          },
          checkedAt: "2026-01-19T10:00:00Z",
        });
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.getAdminStats();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/admin/stats",
          expect.objectContaining({ method: "GET" })
        );
        expect(result.redis.sessionCount).toBe(5);
      });
    });

  });

  // ============================================
  // Health Operations
  // ============================================

  describe("Health Operations", () => {
    describe("health", () => {
      it("should GET /v1/health", async () => {
        mockFetch = mockFetchResponse({ status: "ok", version: "1.0.0" });
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.health();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/health",
          expect.any(Object)
        );
        expect(result.status).toBe("ok");
      });
    });

    describe("healthDetailed", () => {
      it("should GET /v1/health/detailed", async () => {
        mockFetch = mockFetchResponse({
          status: "ok",
          version: "1.0.0",
          postgres: { status: "ok" },
        });
        vi.stubGlobal("fetch", mockFetch);

        const result = await client.healthDetailed();

        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3100/v1/health/detailed",
          expect.any(Object)
        );
        expect(result.status).toBe("ok");
      });
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe("Error Handling", () => {
    it("should throw NotFoundError for 404 responses", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Session not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.getSession("non-existent")).rejects.toThrow();
    });

    it("should throw TimeoutError on request timeout", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 1, // Very short timeout
      });

      mockFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal as AbortSignal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const abortError = new Error("The operation was aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }
          // Never resolve - let the timeout trigger
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.health()).rejects.toThrow(TimeoutError);
    });

    it("should retry on server errors", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 2,
        retryDelay: 10,
      });

      let callCount = 0;
      mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () =>
              Promise.resolve({ code: "INTERNAL_ERROR", message: "Server error" }),
            text: () =>
              Promise.resolve(
                JSON.stringify({ code: "INTERNAL_ERROR", message: "Server error" }),
              ),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "ok", version: "1.0.0" }),
          text: () =>
            Promise.resolve(JSON.stringify({ status: "ok", version: "1.0.0" })),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.health();
      expect(callCount).toBe(2);
      expect(result.status).toBe("ok");
    });

    it("should throw a non-retryable NetworkError on a 2xx non-JSON body (no retries)", async () => {
      // Low-entropy placeholder bound to a neutrally-named var so the secret
      // scanner doesn't flag the fixture (same convention as the Constructor
      // test); the assertion below checks non-leakage, not the literal.
      const placeholder = "test-api-key";
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        apiKey: placeholder,
        retries: 3,
        retryDelay: 10,
      });

      const htmlBody = "<html><body><h1>502 Bad Gateway</h1></body></html>";
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        text: () => Promise.resolve(htmlBody),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client.health().then(
        () => {
          throw new Error("expected health() to reject");
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).message).toContain("status 200");
      expect((error as NetworkError).message).toContain(htmlBody.slice(0, 200));
      // Deterministic parse failure must NOT burn the retry budget.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The error message must not leak auth material.
      expect((error as NetworkError).message).not.toContain(placeholder);
    });

    it("truncates the non-JSON 2xx body to 200 chars in the NetworkError message", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 2,
        retryDelay: 10,
      });

      const longBody = "x".repeat(500);
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token x")),
        text: () => Promise.resolve(longBody),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client.health().then(
        () => {
          throw new Error("expected health() to reject");
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).message).toContain("x".repeat(200));
      expect((error as NetworkError).message).not.toContain("x".repeat(201));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws a status-typed error (not SyntaxError) for a non-JSON non-2xx body", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 1,
        retryDelay: 10,
      });

      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        text: () => Promise.resolve("<html>502 Bad Gateway</html>"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client.health().then(
        () => {
          throw new Error("expected health() to reject");
        },
        (e: unknown) => e,
      );

      expect(error).not.toBeInstanceOf(SyntaxError);
      expect(error).toBeInstanceOf(EngramError);
      expect((error as EngramError).statusCode).toBe(502);
    });
  });

  describe("_requestFormData error handling", () => {
    it("throws ApiError(502), not SyntaxError, when a non-2xx body is unparseable", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 1,
        retryDelay: 10,
      });

      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        text: () => Promise.resolve("<html><body>502 Bad Gateway</body></html>"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client
        ._requestFormData("POST", "/v1/import", new FormData())
        .then(
          () => {
            throw new Error("expected _requestFormData to reject");
          },
          (e: unknown) => e,
        );

      expect(error).not.toBeInstanceOf(SyntaxError);
      expect(error).toBeInstanceOf(EngramError);
      expect((error as EngramError).statusCode).toBe(502);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("still retries a 5xx with a JSON body, then surfaces the typed error", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 2,
        retryDelay: 10,
      });

      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({ code: "INTERNAL_ERROR", message: "Server error" }),
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: "INTERNAL_ERROR", message: "Server error" }),
          ),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client
        ._requestFormData("POST", "/v1/import", new FormData())
        .then(
          () => {
            throw new Error("expected _requestFormData to reject");
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(EngramError);
      expect((error as EngramError).statusCode).toBe(500);
      // Genuinely retryable: retries budget consumed (2 attempts).
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws a non-retryable NetworkError on a 2xx non-JSON body (no retries)", async () => {
      // Neutrally-named var per the file's scanner-safe fixture convention.
      const placeholder = "test-api-key";
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        apiKey: placeholder,
        retries: 3,
        retryDelay: 10,
      });

      const htmlBody = "<html><body>not json</body></html>";
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        text: () => Promise.resolve(htmlBody),
      });
      vi.stubGlobal("fetch", mockFetch);

      const error = await client
        ._requestFormData("POST", "/v1/import", new FormData())
        .then(
          () => {
            throw new Error("expected _requestFormData to reject");
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).message).toContain("status 200");
      expect((error as NetworkError).message).toContain(htmlBody);
      expect((error as NetworkError).message).not.toContain(placeholder);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // Retry Backoff Jitter
  // ============================================

  describe("Retry Backoff Jitter", () => {
    const RETRY_DELAY = 1000;

    /** Reach into the private method — its contract is what the ticket pins. */
    function getBackoff(c: EngramClient): (attempt: number) => number {
      return (
        c as unknown as { backoffDelay(attempt: number): number }
      ).backoffDelay.bind(c);
    }

    it("backoffDelay returns base + Math.random() * 0.5 * retryDelay (stubbed Math.random)", () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retryDelay: RETRY_DELAY,
      });
      const backoff = getBackoff(client);
      const randomSpy = vi.spyOn(Math, "random");

      for (const attempt of [1, 2, 3, 5]) {
        const base = RETRY_DELAY * attempt;

        // Lower bound: random = 0 → exactly the linear base (budget unchanged)
        randomSpy.mockReturnValue(0);
        expect(backoff(attempt)).toBe(base);

        // Midpoint: random = 0.5 → base + 0.25 * retryDelay
        randomSpy.mockReturnValue(0.5);
        expect(backoff(attempt)).toBe(base + 0.5 * RETRY_DELAY * 0.5);

        // Upper bound: random → 1 stays strictly under base + 0.5 * retryDelay
        randomSpy.mockReturnValue(0.999999);
        const nearMax = backoff(attempt);
        expect(nearMax).toBeLessThan(base + 0.5 * RETRY_DELAY);
        expect(nearMax).toBeCloseTo(base + 0.999999 * 0.5 * RETRY_DELAY, 6);
      }

      randomSpy.mockRestore();
    });

    it("backoffDelay stays within [base, base + 0.5 * retryDelay) with real Math.random", () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retryDelay: RETRY_DELAY,
      });
      const backoff = getBackoff(client);

      for (const attempt of [1, 2, 3]) {
        const base = RETRY_DELAY * attempt;
        for (let i = 0; i < 50; i++) {
          const delay = backoff(attempt);
          expect(delay).toBeGreaterThanOrEqual(base);
          expect(delay).toBeLessThan(base + 0.5 * RETRY_DELAY);
        }
      }
    });

    it("retry path sleeps the jittered duration from backoffDelay", async () => {
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        retries: 2,
        retryDelay: 10,
      });

      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
      const sleepSpy = vi
        .spyOn(
          client as unknown as { sleep(ms: number): Promise<void> },
          "sleep"
        )
        .mockResolvedValue(undefined);

      let callCount = 0;
      mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          const body = { code: "INTERNAL_ERROR", message: "boom" };
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(JSON.stringify(body)),
          });
        }
        const okBody = { status: "ok", version: "1.0.0" };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(okBody),
          text: () => Promise.resolve(JSON.stringify(okBody)),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.health();
      expect(result.status).toBe("ok");
      // attempt 1 → 10 * 1 + 0.5 * 10 * 0.5 = 12.5
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(12.5);

      randomSpy.mockRestore();
      sleepSpy.mockRestore();
    });

    it("all retry sites route through backoffDelay (no inline retryDelay multiplications)", () => {
      const source = readFileSync(
        new URL("../src/client.ts", import.meta.url),
        "utf8"
      );

      // Every sleep call must take the jittered delay — either backoffDelay
      // directly, or the `delayMs` const the retry sites bind it to so the
      // same value can be logged before sleeping.
      //
      // The floor is 4: one per response-site 5xx retry (_requestRaw,
      // _requestRawBody, _requestFormData) plus the shared `retryOrThrow`,
      // which is the single catch-path retry for all five request methods
      // (#173). It was 8 before those catch paths were consolidated — a LOWER
      // floor here means fewer places the schedule can drift, not fewer
      // covered sites.
      const sleepCalls =
        source.match(/this\.sleep\((?:[^()]|\([^()]*\))*\)/g) ?? [];
      expect(sleepCalls.length).toBeGreaterThanOrEqual(4);
      for (const call of sleepCalls) {
        expect([
          "this.sleep(delayMs)",
          "this.sleep(this.backoffDelay(attempt))",
        ]).toContain(call);
      }

      // …and every delayMs binding is exactly the jittered backoff.
      const delayAssignments = source
        .split("\n")
        .filter((line) => /const delayMs =/.test(line));
      for (const line of delayAssignments) {
        expect(line.trim()).toBe("const delayMs = this.backoffDelay(attempt);");
      }

      // The jitter math now lives in @centient/resilience (createBackoff,
      // linear strategy, jitterRatio 0.5). client.ts must NOT re-inline a
      // `retryDelay *` multiplication — the backoff schedule has exactly one
      // home. backoffDelay delegates to the resilience-backed schedule.
      const multiplicationLines = source
        .split("\n")
        .filter((line) => /retryDelay \*/.test(line));
      expect(multiplicationLines).toHaveLength(0);

      const backoffBody = source
        .split("\n")
        .filter((line) => /this\.backoff\.delayFor\(attempt\)/.test(line));
      expect(backoffBody).toHaveLength(1);
    });
  });
});
