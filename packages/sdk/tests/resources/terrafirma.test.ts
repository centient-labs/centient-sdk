/**
 * Terrafirma Resource Tests
 *
 * Tests for the SDK interface to filesystem-to-Engram synchronization (ADR-049).
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

describe("TerrafirmaResource", () => {
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

  describe("terrafirma.status", () => {
    it("should GET /v1/terrafirma/status", async () => {
      const mockStatus = {
        mode: "steady_state",
        watcher: {
          status: "running",
          uptimeSeconds: 3600,
          eventsProcessed24h: 150,
          lastEventAt: "2026-02-17T10:00:00Z",
        },
        reconciler: {
          status: "idle",
          lastRunAt: "2026-02-17T09:55:00Z",
          nextRunAt: "2026-02-17T10:05:00Z",
        },
        sync: {
          total: 100,
          synced: 95,
          pending: 2,
          syncing: 1,
          fsDirty: 1,
          conflict: 0,
          orphaned: 1,
          error: 0,
          lastSyncedAt: "2026-02-17T10:00:00Z",
        },
        suggestedActions: [],
      };

      mockFetch = mockFetchResponse({ data: mockStatus });
      vi.stubGlobal("fetch", mockFetch);

      const status = await client.terrafirma.status();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/status",
        expect.objectContaining({ method: "GET" })
      );

      expect(status.mode).toBe("steady_state");
      expect(status.watcher.status).toBe("running");
      expect(status.sync.total).toBe(100);
      expect(status.sync.synced).toBe(95);
    });
  });

  describe("terrafirma.fileInfo", () => {
    it("should GET /v1/terrafirma/files/:filePath with URL encoding", async () => {
      const mockFileInfo = {
        filePath: "docs/notes/meeting.md",
        syncStatus: "synced",
        contentHash: "sha256-abc123",
        lastModified: "2026-02-17T10:00:00Z",
        sizeBytes: 1024,
        entityId: "entity-123",
        crystalMemberships: [],
        engramItemId: "item-456",
        version: 1,
        lastSyncedAt: "2026-02-17T10:00:00Z",
        conflict: null,
      };

      mockFetch = mockFetchResponse({ data: mockFileInfo });
      vi.stubGlobal("fetch", mockFetch);

      const info = await client.terrafirma.fileInfo("docs/notes/meeting.md");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/files/docs%2Fnotes%2Fmeeting.md",
        expect.objectContaining({ method: "GET" })
      );

      expect(info).not.toBeNull();
      expect(info!.filePath).toBe("docs/notes/meeting.md");
      expect(info!.syncStatus).toBe("synced");
      expect(info!.conflict).toBeNull();
    });

    it("should return null for 404 responses", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { code: "RES_NOT_FOUND" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const info = await client.terrafirma.fileInfo("nonexistent/file.md");

      expect(info).toBeNull();
    });

    it("should throw for non-404 errors", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: { code: "SVC_INTERNAL_ERROR", message: "Server error" },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.terrafirma.fileInfo("some/file.md")
      ).rejects.toThrow();
    });
  });

  describe("terrafirma.sync", () => {
    it("should POST to /v1/terrafirma/sync with dry_run", async () => {
      const mockResult = {
        dryRun: true,
        filesTotal: 10,
        filesAffected: 3,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.terrafirma.sync({ dryRun: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ dry_run: true }),
        })
      );

      expect(result.dryRun).toBe(true);
    });

    it("should include optional scope, entity_id, and file_paths", async () => {
      mockFetch = mockFetchResponse({ data: { dryRun: false } });
      vi.stubGlobal("fetch", mockFetch);

      await client.terrafirma.sync({
        dryRun: false,
        scope: "errors",
        entityId: "entity-123",
        filePaths: ["file1.md", "file2.md"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            dry_run: false,
            scope: "errors",
            entity_id: "entity-123",
            file_paths: ["file1.md", "file2.md"],
          }),
        })
      );
    });
  });
});

describe("TerrafirmaMigrationsResource", () => {
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

  describe("terrafirma.migrations.current", () => {
    it("should GET /v1/terrafirma/migrations/current", async () => {
      const mockMigration = {
        status: "running",
        migrationId: "mig-001",
        filesTotal: 50,
        filesProcessed: 20,
        filesErrored: 1,
        filesRemaining: 29,
        currentEntity: "entity-abc",
        entitiesCompleted: ["entity-xyz"],
        entitiesRemaining: ["entity-abc", "entity-def"],
        startedAt: "2026-02-17T10:00:00Z",
        completedAt: null,
        elapsedSeconds: 120,
        checkpointId: "chk-001",
        errors: [],
      };

      mockFetch = mockFetchResponse({ data: mockMigration });
      vi.stubGlobal("fetch", mockFetch);

      const status = await client.terrafirma.migrations.current();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/migrations/current",
        expect.objectContaining({ method: "GET" })
      );

      expect(status.status).toBe("running");
      expect(status.migrationId).toBe("mig-001");
      expect(status.filesTotal).toBe(50);
      expect(status.filesProcessed).toBe(20);
    });
  });

  describe("terrafirma.migrations.start", () => {
    it("should POST to /v1/terrafirma/migrations with dry_run", async () => {
      const mockResult = {
        dryRun: true,
        filesTotal: 100,
      };

      mockFetch = mockFetchResponse({ data: mockResult });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.terrafirma.migrations.start({
        dryRun: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/migrations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ dry_run: true }),
        })
      );

      expect(result.dryRun).toBe(true);
    });

    it("should include entity_ids when provided", async () => {
      mockFetch = mockFetchResponse({ data: { dryRun: false } }, 201);
      vi.stubGlobal("fetch", mockFetch);

      await client.terrafirma.migrations.start({
        dryRun: false,
        entityIds: ["entity-1", "entity-2"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/terrafirma/migrations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            dry_run: false,
            entity_ids: ["entity-1", "entity-2"],
          }),
        })
      );
    });
  });
});
