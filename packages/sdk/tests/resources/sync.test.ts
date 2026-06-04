/**
 * Sync Resource Tests
 *
 * Tests for the SyncResource and SyncPeersResource SDK patterns (engram Knowledge API).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError, NetworkError } from "../../src/errors.js";

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
          crystals: { inserted: 3, updated: 0, skipped: 0 },
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
          entityType: "crystals",
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
      expect(result.counts.crystals.inserted).toBe(3);
      expect(result.counts.session_notes.updated).toBe(1);
    });

    it("should send an empty body when no changes are supplied", async () => {
      mockFetch = mockFetchResponse({
        data: { counts: {}, conflicts: 0, duration: 1 },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.push();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/push",
        expect.objectContaining({ method: "POST", body: "" })
      );
    });
  });

  describe("sync.pull", () => {
    it("should POST to /v1/sync/pull and parse the NDJSON stream", async () => {
      const entries = [
        {
          seq: "10",
          entityType: "crystals",
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
        expect.objectContaining({ method: "POST" })
      );

      expect(result).toHaveLength(2);
      expect(result[0].seq).toBe("10");
      expect(result[1].operation).toBe("update");
    });

    it("should throw a NetworkError on a malformed NDJSON line", async () => {
      const valid = JSON.stringify({
        seq: "10",
        entityType: "crystals",
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
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: () =>
          Promise.resolve({
            error: {
              code: "SYNC_SCHEMA_VERSION_MISMATCH",
              message: "Schema version mismatch",
              details: { peerVersion: "2.0.0", ourVersion: "1.0.0" },
            },
          }),
        text: () => Promise.resolve(""),
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
  });

  describe("sync.pushTo", () => {
    it("should POST to /v1/sync/push-to with peer query param", async () => {
      const mockResult = {
        counts: { crystals: { inserted: 2, updated: 0, skipped: 0 } },
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

      expect(result.counts.crystals.inserted).toBe(2);
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

      mockFetch = mockFetchResponse({ data: mockPeer }, 201);
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

      mockFetch = mockFetchResponse({ data: mockPeers });
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

      mockFetch = mockFetchResponse({ data: mockPeer });
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
      mockFetch = mockFetchResponse({ data: { deleted: true } });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sync.peers.delete("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node",
        expect.objectContaining({ method: "DELETE" })
      );

      expect(result.deleted).toBe(true);
    });
  });

  describe("sync.peers.link", () => {
    it("should POST to /v1/sync/peers/:name/link", async () => {
      mockFetch = mockFetchResponse({ data: undefined });
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
      mockFetch = mockFetchResponse({ data: undefined });
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
      mockFetch = mockFetchResponse({ data: undefined });
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
      mockFetch = mockFetchResponse({ data: undefined });
      vi.stubGlobal("fetch", mockFetch);

      await client.sync.peers.resume("staging-node");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/sync/peers/staging-node/link/resume",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
