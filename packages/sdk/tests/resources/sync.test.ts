/**
 * Sync Resource Tests
 *
 * Tests for the SyncResource and SyncPeersResource SDK patterns (engram Knowledge API).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError, NetworkError, TimeoutError } from "../../src/errors.js";

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

describe("SyncResource", () => {
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

  describe("sync.push", () => {
    it("should POST NDJSON to /v1/sync/push", async () => {
      const mockResult = {
        counts: {
          knowledge_crystals: { inserted: 3, updated: 0, skipped: 0 },
          knowledge_crystal_edges: { inserted: 0, updated: 0, skipped: 0 },
          sessions: { inserted: 0, updated: 0, skipped: 0 },
          session_notes: { inserted: 7, updated: 1, skipped: 0 },
        },
        conflicts: 0,
        duration: 150,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const changes = [
        {
          seq: "10",
          entityType: "knowledge_crystals" as const,
          entityId: "c-1",
          operation: "insert" as const,
          changedFields: { title: "Auth" },
          previousValues: null,
          createdAt: "2026-06-03T00:00:00Z",
        },
      ];

      const result = await client.sync.push(changes);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/push",
        expect.objectContaining({
          method: "POST",
          body: changes.map((c) => JSON.stringify(c)).join("\n") + "\n",
          headers: expect.objectContaining({
            "Content-Type": "application/x-ndjson",
          }),
        })
      );

      expect(result.conflicts).toBe(0);
      expect(result.counts.knowledge_crystals.inserted).toBe(3);
      expect(result.counts.session_notes.updated).toBe(1);
    });

    it("should send an empty body when no changes are supplied", async () => {
      const zero = { inserted: 0, updated: 0, skipped: 0 };
      mockFetch = mockFetchResponse({
        data: {
          counts: {
            knowledge_crystals: zero,
            knowledge_crystal_edges: zero,
            sessions: zero,
            session_notes: zero,
          },
          conflicts: 0,
          duration: 1,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.push();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/push",
        expect.objectContaining({ method: "POST", body: "" })
      );

      // Round-trip: the zero-entry response still parses and passes the
      // assertFullCounts guard.
      expect(result.conflicts).toBe(0);
      expect(result.counts.knowledge_crystals.inserted).toBe(0);
      expect(result.counts.session_notes.skipped).toBe(0);
    });
  });

  // push() is the public path that exercises EngramClient._requestRawBody, so
  // its retry / timeout / network-failure branches are covered here.
  describe("_requestRawBody error handling (via sync.push)", () => {
    const fullCounts = {
      knowledge_crystals: { inserted: 0, updated: 0, skipped: 0 },
      knowledge_crystal_edges: { inserted: 0, updated: 0, skipped: 0 },
      sessions: { inserted: 0, updated: 0, skipped: 0 },
      session_notes: { inserted: 0, updated: 0, skipped: 0 },
    };

    function jsonResponse(ok: boolean, status: number, body: unknown) {
      return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: new Headers({ "content-type": "application/json" }),
      };
    }

    it("retries a 5xx response and succeeds on the next attempt", async () => {
      const retryClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 5000,
        retries: 3,
        retryDelay: 1,
      });
      const mock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(false, 503, { error: { code: "SVC_UNAVAILABLE", message: "down" } })
        )
        .mockResolvedValueOnce(
          jsonResponse(true, 200, { data: { counts: fullCounts, conflicts: 0, duration: 1 } })
        );
      vi.stubGlobal("fetch", mock);

      const result = await retryClient.sync.push();

      expect(result.conflicts).toBe(0);
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it("throws an EngramError once the retry budget is exhausted on persistent 5xx", async () => {
      const retryClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 5000,
        retries: 2,
        retryDelay: 1,
      });
      const mock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse(false, 500, { error: { code: "INTERNAL_ERROR", message: "boom" } })
        );
      vi.stubGlobal("fetch", mock);

      await expect(retryClient.sync.push()).rejects.toBeInstanceOf(EngramError);
    });

    it("maps an AbortError to TimeoutError", async () => {
      const mock = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
      vi.stubGlobal("fetch", mock);

      await expect(client.sync.push()).rejects.toBeInstanceOf(TimeoutError);
    });

    it("maps a generic fetch failure to NetworkError", async () => {
      const mock = vi.fn().mockRejectedValue(new TypeError("network down"));
      vi.stubGlobal("fetch", mock);

      await expect(client.sync.push()).rejects.toBeInstanceOf(NetworkError);
    });

    it("throws NetworkError without retrying on a non-JSON 2xx body", async () => {
      // A 200 OK whose body is not JSON is a deterministic failure — it must
      // surface as NetworkError immediately, NOT consume the retry budget.
      const retryClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 5000,
        retries: 3,
        retryDelay: 1,
      });
      const mock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("<html>Bad Gateway</html>"),
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        headers: new Headers({ "content-type": "text/html" }),
      });
      vi.stubGlobal("fetch", mock);

      await expect(retryClient.sync.push()).rejects.toBeInstanceOf(NetworkError);
      // No retry — called exactly once despite retries: 3.
      expect(mock).toHaveBeenCalledTimes(1);
    });
  });

  describe("sync.pull", () => {
    it("should POST to /v1/sync/pull and parse the NDJSON stream", async () => {
      const entries = [
        {
          seq: "10",
          entityType: "knowledge_crystals",
          entityId: "c-1",
          operation: "insert",
          changedFields: { title: "Auth" },
          previousValues: null,
          createdAt: "2026-06-03T00:00:00Z",
        },
        {
          seq: "11",
          entityType: "session_notes",
          entityId: "n-1",
          operation: "update",
          changedFields: { content: "y" },
          previousValues: { content: "z" },
          createdAt: "2026-06-03T00:00:01Z",
        },
      ];
      const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(ndjson),
        json: () => Promise.resolve({}),
        headers: new Headers({ "content-type": "application/x-ndjson" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.pull({ sinceSeq: null });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/pull",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sinceSeq: null }),
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0].seq).toBe("10");
      expect(result[1].operation).toBe("update");
    });

    it("should send sinceSeq and entityTypes in the request body", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        headers: new Headers({ "content-type": "application/x-ndjson" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.pull({
        sinceSeq: "42",
        entityTypes: ["knowledge_crystals", "session_notes"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/pull",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sinceSeq: "42",
            entityTypes: ["knowledge_crystals", "session_notes"],
          }),
        })
      );

      // empty stream → empty array (no blank-line entries)
      expect(result).toEqual([]);
    });

    it("should return [] for a whitespace-only / blank-line stream", async () => {
      // The server terminates each NDJSON record with a newline, so an
      // empty result still arrives as "\n" (or several blank lines). These
      // must be filtered, never parsed into spurious SyncChange entries.
      for (const body of ["\n", "  \n  ", "\n\n\n"]) {
        const mock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(body),
          json: () => Promise.resolve({}),
          headers: new Headers({ "content-type": "application/x-ndjson" }),
        });
        vi.stubGlobal("fetch", mock);

        const result = await client.sync.pull({ sinceSeq: null });
        expect(result).toEqual([]);
      }
    });

    it("should throw a NetworkError on a malformed NDJSON line", async () => {
      const valid = JSON.stringify({
        seq: "10",
        entityType: "knowledge_crystals",
        entityId: "c-1",
        operation: "insert",
        changedFields: { title: "Auth" },
        previousValues: null,
        createdAt: "2026-06-03T00:00:00Z",
      });
      // one valid line followed by a truncated/garbage line
      const ndjson = `${valid}\n{"seq":"11","entityType":\n`;

      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(ndjson),
        json: () => Promise.resolve({}),
        headers: new Headers({ "content-type": "application/x-ndjson" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.pull({ sinceSeq: null })).rejects.toBeInstanceOf(
        NetworkError
      );
    });

    it("should propagate a 409 SYNC_SCHEMA_VERSION_MISMATCH with details", async () => {
      // Keep json() and text() consistent so the test passes regardless of
      // whether the client reads the error body via json()- or text()-first.
      const errorBody = {
        error: {
          code: "SYNC_SCHEMA_VERSION_MISMATCH",
          message: "Schema version mismatch",
          details: { peerVersion: "2.0.0", ourVersion: "1.0.0" },
        },
      };
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: () => Promise.resolve(errorBody),
        text: () => Promise.resolve(JSON.stringify(errorBody)),
        headers: new Headers({ "content-type": "application/json" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.sync
        .pull({ sinceSeq: null })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("SYNC_SCHEMA_VERSION_MISMATCH");
      expect((err as EngramError).statusCode).toBe(409);
      expect((err as EngramError).details).toEqual({
        peerVersion: "2.0.0",
        ourVersion: "1.0.0",
      });
    });
  });

  // pull() exercises EngramClient._requestRaw (NDJSON path), distinct from
  // push()'s _requestRawBody — so its retry / timeout / network branches are
  // covered separately here.
  describe("_requestRaw error handling (via sync.pull)", () => {
    function ndjsonResponse(ok: boolean, status: number, body: unknown) {
      const isString = typeof body === "string";
      return {
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        text: () => Promise.resolve(isString ? (body as string) : JSON.stringify(body)),
        json: () => Promise.resolve(isString ? {} : body),
        headers: new Headers({
          "content-type": ok ? "application/x-ndjson" : "application/json",
        }),
      };
    }

    it("retries a 5xx response and then parses the NDJSON stream", async () => {
      const retryClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 5000,
        retries: 3,
        retryDelay: 1,
      });
      const entry = JSON.stringify({
        seq: "10",
        entityType: "knowledge_crystals",
        entityId: "c-1",
        operation: "insert",
        changedFields: null,
        previousValues: null,
        createdAt: "2026-06-05T00:00:00Z",
      });
      const mock = vi
        .fn()
        .mockResolvedValueOnce(
          ndjsonResponse(false, 503, { error: { code: "SVC_UNAVAILABLE", message: "down" } })
        )
        .mockResolvedValueOnce(ndjsonResponse(true, 200, `${entry}\n`));
      vi.stubGlobal("fetch", mock);

      const result = await retryClient.sync.pull({ sinceSeq: null });

      expect(result).toHaveLength(1);
      expect(result[0].seq).toBe("10");
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it("maps an AbortError to TimeoutError", async () => {
      const mock = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
      vi.stubGlobal("fetch", mock);

      await expect(client.sync.pull({ sinceSeq: null })).rejects.toBeInstanceOf(
        TimeoutError
      );
    });

    it("maps a generic fetch failure to NetworkError", async () => {
      const mock = vi.fn().mockRejectedValue(new TypeError("network down"));
      vi.stubGlobal("fetch", mock);

      await expect(client.sync.pull({ sinceSeq: null })).rejects.toBeInstanceOf(
        NetworkError
      );
    });
  });

  describe("sync.getStatus", () => {
    it("should GET /v1/sync/status", async () => {
      const mockStatus = {
        instanceId: "inst-1",
        schemaVersion: "1.0.0",
        peersCount: 2,
        activeLinksCount: 1,
        changelogSize: 42,
      };

      mockFetch = mockFetchResponse({ data: mockStatus });
      vi.stubGlobal("fetch", mockFetch);

      const status = await client.sync.getStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/status",
        expect.objectContaining({ method: "GET" })
      );

      expect(status.instanceId).toBe("inst-1");
      expect(status.schemaVersion).toBe("1.0.0");
      expect(status.changelogSize).toBe(42);
    });

    it("throws EngramError on a malformed response (null data)", async () => {
      mockFetch = mockFetchResponse({ data: null });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.getStatus()).rejects.toBeInstanceOf(EngramError);
    });

    it("throws EngramError when a required field has the wrong type", async () => {
      // schemaVersion as a number must hit the typeof guard, not just the null path.
      mockFetch = mockFetchResponse({
        data: {
          instanceId: "inst-1",
          schemaVersion: 1,
          peersCount: 2,
          activeLinksCount: 1,
          changelogSize: 42,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.getStatus()).rejects.toBeInstanceOf(EngramError);
    });

    it("throws EngramError when instanceId is missing", async () => {
      mockFetch = mockFetchResponse({
        data: {
          schemaVersion: "1.0.0",
          peersCount: 2,
          activeLinksCount: 1,
          changelogSize: 42,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.getStatus()).rejects.toBeInstanceOf(EngramError);
    });
  });

  describe("sync.pushTo", () => {
    it("should POST to /v1/sync/push-to with peer query param", async () => {
      const mockResult = {
        counts: {
          knowledge_crystals: { inserted: 2, updated: 0, skipped: 0 },
          knowledge_crystal_edges: { inserted: 0, updated: 0, skipped: 0 },
          sessions: { inserted: 0, updated: 0, skipped: 0 },
          session_notes: { inserted: 0, updated: 0, skipped: 0 },
        },
        conflicts: 0,
        duration: 80,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.pushTo("my-peer");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/push-to?peer=my-peer",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.counts.knowledge_crystals.inserted).toBe(2);
      expect(result.conflicts).toBe(0);
    });
  });

  describe("sync.pullFrom", () => {
    it("should POST to /v1/sync/pull-from with peer query param", async () => {
      const mockResult = {
        entriesStreamed: 5,
        maxSeq: "120",
        duration: 90,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.pullFrom("my-peer");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/pull-from?peer=my-peer",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.entriesStreamed).toBe(5);
      expect(result.maxSeq).toBe("120");
    });

    it("throws EngramError when entriesStreamed/duration are missing", async () => {
      mockFetch = mockFetchResponse({ data: { maxSeq: "120" } });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.pullFrom("my-peer")).rejects.toBeInstanceOf(
        EngramError
      );
    });

    it("throws EngramError on null data", async () => {
      mockFetch = mockFetchResponse({ data: null });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.pullFrom("my-peer")).rejects.toBeInstanceOf(
        EngramError
      );
    });

    it("throws EngramError when entriesStreamed has the wrong type", async () => {
      mockFetch = mockFetchResponse({
        data: { entriesStreamed: "five", maxSeq: "120", duration: 90 },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.pullFrom("my-peer")).rejects.toBeInstanceOf(
        EngramError
      );
    });

    it("throws EngramError when maxSeq is a non-string/non-null value", async () => {
      mockFetch = mockFetchResponse({
        data: { entriesStreamed: 5, maxSeq: 42, duration: 90 },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.sync.pullFrom("my-peer")).rejects.toBeInstanceOf(
        EngramError
      );
    });
  });

  describe("sync.listConflicts", () => {
    it("should GET /v1/sync/conflicts", async () => {
      const mockConflicts = [
        {
          id: "conflict-1",
          entityType: "crystal",
          entityId: "c-1",
          fieldName: "title",
          localValue: "Local Title",
          remoteValue: "Remote Title",
          winner: "local",
          resolution: "auto_lww",
          resolvedAt: null,
          createdAt: "2026-01-25T10:00:00Z",
        },
      ];

      mockFetch = mockFetchResponse({
        data: { conflicts: mockConflicts, total: 1 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.listConflicts();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/conflicts",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.conflicts).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should pass unresolved query param when specified", async () => {
      mockFetch = mockFetchResponse({
        data: { conflicts: [], total: 0 },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.listConflicts({ unresolved: true });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/sync/conflicts?");
      expect(calledUrl).toContain("unresolved=true");
    });
  });

  describe("sync.resolveConflict", () => {
    it("should POST to /v1/sync/conflicts/:id/resolve", async () => {
      const mockResolved = {
        id: "conflict-1",
        entityType: "crystal",
        entityId: "c-1",
        fieldName: "title",
        localValue: "Local Title",
        remoteValue: "Remote Title",
        localUpdatedAt: null,
        remoteUpdatedAt: null,
        winner: "local",
        resolution: "manual",
        resolvedAt: "2026-01-25T12:00:00Z",
        createdAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ data: mockResolved });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.resolveConflict("conflict-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/conflicts/conflict-1/resolve",
        expect.objectContaining({ method: "POST" })
      );

      expect(result.id).toBe("conflict-1");
      expect(result.resolvedAt).toBe("2026-01-25T12:00:00Z");
    });

    it("throws EngramError when the resolved conflict has no id", async () => {
      mockFetch = mockFetchResponse({ data: {} });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.sync.resolveConflict("conflict-1")
      ).rejects.toBeInstanceOf(EngramError);
    });

    it("throws EngramError when a nullable timestamp has the wrong type", async () => {
      // localUpdatedAt must be string | null — a number must be rejected.
      mockFetch = mockFetchResponse({
        data: {
          id: "conflict-1",
          entityType: "crystal",
          entityId: "c-1",
          fieldName: "title",
          localValue: "L",
          remoteValue: "R",
          localUpdatedAt: 42,
          remoteUpdatedAt: null,
          resolvedAt: null,
          winner: "local",
          resolution: "manual",
          createdAt: "2026-01-25T10:00:00Z",
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.sync.resolveConflict("conflict-1")
      ).rejects.toBeInstanceOf(EngramError);
    });
  });
});

describe("SyncPeersResource", () => {
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

  describe("sync.peers.create", () => {
    it("should POST to /v1/sync/peers", async () => {
      const mockPeer = {
        id: "peer-1",
        name: "staging-node",
        url: "https://staging.engram.local",
        lastPushAt: null,
        lastPullAt: null,
        lastPushSeq: null,
        lastPullSeq: null,
        linkEnabled: false,
        linkIntervalSeconds: 300,
        linkLastSyncAt: null,
        linkLastError: null,
        linkPaused: false,
        createdAt: "2026-01-25T10:00:00Z",
        updatedAt: "2026-01-25T10:00:00Z",
      };

      mockFetch = mockFetchResponse({ peer: mockPeer }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const createParams = {
        name: "staging-node",
        url: "https://staging.engram.local",
      };

      const peer = await client.sync.peers.create(createParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(createParams),
        })
      );

      expect(peer.name).toBe("staging-node");
      expect(peer.url).toBe("https://staging.engram.local");
    });
  });

  describe("sync.peers.list", () => {
    it("should GET /v1/sync/peers", async () => {
      const mockPeers = [
        { id: "peer-1", name: "staging-node", url: "https://staging.engram.local" },
        { id: "peer-2", name: "prod-node", url: "https://prod.engram.local" },
      ];

      mockFetch = mockFetchResponse({ peers: mockPeers });
      vi.stubGlobal("fetch", mockFetch);

      const peers = await client.sync.peers.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers",
        expect.objectContaining({ method: "GET" })
      );

      expect(peers).toHaveLength(2);
    });
  });

  describe("sync.peers.get", () => {
    it("should GET /v1/sync/peers/:name", async () => {
      const mockPeer = {
        id: "peer-1",
        name: "staging-node",
        url: "https://staging.engram.local",
        linkEnabled: true,
        linkPaused: false,
      };

      mockFetch = mockFetchResponse({ peer: mockPeer });
      vi.stubGlobal("fetch", mockFetch);

      const peer = await client.sync.peers.get("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node",
        expect.objectContaining({ method: "GET" })
      );

      expect(peer.name).toBe("staging-node");
    });
  });

  describe("sync.peers.delete", () => {
    it("should DELETE /v1/sync/peers/:name", async () => {
      mockFetch = mockFetchResponse({ removed: true, name: "staging-node" });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.peers.delete("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node",
        expect.objectContaining({ method: "DELETE" })
      );

      expect(result.removed).toBe(true);
      expect(result.name).toBe("staging-node");
    });
  });

  describe("sync.peers.link", () => {
    it("should POST to /v1/sync/peers/:name/link", async () => {
      mockFetch = mockFetchResponse({
        peer: {
          id: "peer-1",
          name: "staging-node",
          url: "https://staging.engram.local",
          linkEnabled: true,
          linkPaused: false,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.peers.link("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node/link",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("sync.peers.unlink", () => {
    it("should DELETE /v1/sync/peers/:name/link", async () => {
      mockFetch = mockFetchResponse({
        peer: {
          id: "peer-1",
          name: "staging-node",
          url: "https://staging.engram.local",
          linkEnabled: true,
          linkPaused: false,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.peers.unlink("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node/link",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("sync.peers.pause", () => {
    it("should POST to /v1/sync/peers/:name/link/pause", async () => {
      mockFetch = mockFetchResponse({
        peer: {
          id: "peer-1",
          name: "staging-node",
          url: "https://staging.engram.local",
          linkEnabled: true,
          linkPaused: false,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.peers.pause("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node/link/pause",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("sync.peers.resume", () => {
    it("should POST to /v1/sync/peers/:name/link/resume", async () => {
      mockFetch = mockFetchResponse({
        peer: {
          id: "peer-1",
          name: "staging-node",
          url: "https://staging.engram.local",
          linkEnabled: true,
          linkPaused: false,
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.peers.resume("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node/link/resume",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
