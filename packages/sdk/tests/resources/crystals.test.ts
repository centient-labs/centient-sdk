/**
 * Crystals Resource Tests
 *
 * Tests for the CrystalsResource and CrystalItemsResource SDK patterns.
 * Crystals are curated collections of knowledge items.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { NotFoundError, ValidationFailedError } from "../../src/errors.js";
import type {
  KnowledgeCrystal,
  KnowledgeCrystalSearchResult,
  CrystalMembership,
  CrystalVersion,
} from "../../src/types/knowledge-crystal.js";

// Helper to create mock fetch response
function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

// Mock data factories
function createMockCrystal(overrides: Partial<KnowledgeCrystal> = {}): KnowledgeCrystal {
  return {
    id: "crystal-123e4567-e89b-12d3-a456-426614174000",
    slug: null,
    nodeType: "collection",
    title: "Test Crystal",
    summary: null,
    description: "A test crystal collection",
    tags: ["test", "sample"],
    contentRef: null,
    contentInline: null,
    embeddingStatus: "synced",
    embeddingUpdatedAt: null,
    confidence: null,
    verified: false,
    visibility: "private",
    license: null,
    ownerIds: ["user-1"],
    version: 1,
    forkCount: 0,
    starCount: 0,
    itemCount: 5,
    versionCount: 1,
    parentId: null,
    parentVersion: null,
    sourceType: null,
    sourceSessionId: null,
    sourceProject: "test-project",
    typeMetadata: {},
    path: null,
    createdAt: "2026-01-25T10:00:00Z",
    updatedAt: "2026-01-25T10:00:00Z",
    ...overrides,
  };
}

function createMockMembership(overrides: Partial<CrystalMembership> = {}): CrystalMembership {
  return {
    id: "membership-123",
    crystalId: "crystal-123",
    itemId: "knowledge-item-456",
    position: 0,
    addedBy: "manual",
    addedAt: "2026-01-25T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function createMockVersion(overrides: Partial<CrystalVersion> = {}): CrystalVersion {
  return {
    id: "version-123",
    crystalId: "crystal-123",
    version: 1,
    changelog: "Initial version",
    membershipSnapshot: [],
    crystalSnapshot: { title: "Test Crystal" },
    createdAt: "2026-01-25T10:00:00Z",
    ...overrides,
  };
}

describe("CrystalsResource", () => {
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

  // ========================================================================
  // crystals.create
  // ========================================================================
  describe("crystals.create", () => {
    it("should POST to /v1/crystals", async () => {
      const mockCrystal = createMockCrystal();

      mockFetch = mockFetchResponse({ data: mockCrystal }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.create({
        nodeType: "collection",
        title: "Test Crystal",
        description: "A test crystal",
        tags: ["test", "sample"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Test Crystal",
            description: "A test crystal",
            tags: ["test", "sample"],
            node_type: "collection",
          }),
        })
      );

      expect(crystal.id).toBe(mockCrystal.id);
      expect(crystal.title).toBe("Test Crystal");
      expect(crystal.nodeType).toBe("collection");
    });

    it("should create crystal with minimal params", async () => {
      const mockCrystal = createMockCrystal({ title: "Minimal Crystal" });

      mockFetch = mockFetchResponse({ data: mockCrystal }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.create({
        nodeType: "collection",
        title: "Minimal Crystal",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Minimal Crystal",
            node_type: "collection",
          }),
        })
      );

      expect(crystal.title).toBe("Minimal Crystal");
    });

    it("should create crystal with all optional params", async () => {
      const mockCrystal = createMockCrystal({
        title: "Full Crystal",
        nodeType: "session_artifact",
        visibility: "shared",
        sourceSessionId: "session-123",
        sourceProject: "my-project",
      });

      mockFetch = mockFetchResponse({ data: mockCrystal }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.create({
        nodeType: "session_artifact",
        title: "Full Crystal",
        description: "Session artifact crystal",
        visibility: "shared",
        tags: ["session", "artifact"],
        sourceSessionId: "session-123",
        sourceProject: "my-project",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Full Crystal",
            description: "Session artifact crystal",
            visibility: "shared",
            tags: ["session", "artifact"],
            sourceSessionId: "session-123",
            sourceProject: "my-project",
            node_type: "session_artifact",
          }),
        })
      );

      expect(crystal.visibility).toBe("shared");
      expect(crystal.sourceSessionId).toBe("session-123");
    });
  });

  // ========================================================================
  // crystals.get
  // ========================================================================
  describe("crystals.get", () => {
    it("should GET /v1/crystals/:id", async () => {
      const mockCrystal = createMockCrystal();

      mockFetch = mockFetchResponse({ data: mockCrystal });
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.get("crystal-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123",
        expect.objectContaining({ method: "GET" })
      );

      expect(crystal.id).toBe(mockCrystal.id);
      expect(crystal.title).toBe("Test Crystal");
    });

    it("should URL encode crystal ID", async () => {
      const mockCrystal = createMockCrystal();

      mockFetch = mockFetchResponse({ data: mockCrystal });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.get("crystal/with/slashes");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fwith%2Fslashes",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  // ========================================================================
  // crystals.list
  // ========================================================================
  describe("crystals.list", () => {
    it("should GET /v1/crystals without params", async () => {
      const mockCrystals = [
        createMockCrystal({ id: "c1", title: "Crystal 1" }),
        createMockCrystal({ id: "c2", title: "Crystal 2" }),
      ];

      mockFetch = mockFetchResponse({
        data: mockCrystals,
        meta: { pagination: { total: 2, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.crystals).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should apply node_type filter", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ nodeType: "session_artifact" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("node_type=session_artifact");
    });

    it("should apply visibility filter", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ visibility: "public" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("visibility=public");
    });

    it("should apply multiple tags as comma-separated value", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ tags: ["auth", "security"] });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("tags=auth%2Csecurity");
    });

    it("should apply source_project filter", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ sourceProject: "my-project" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("source_project=my-project");
    });

    it("should apply pagination params", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 100, limit: 10, offset: 20, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.list({ limit: 10, offset: 20 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=20");
      expect(result.hasMore).toBe(true);
    });

    it("should apply all filters together", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 5, limit: 10, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({
        nodeType: "domain",
        visibility: "shared",
        tags: ["database"],
        sourceProject: "centient",
        limit: 10,
        offset: 5, // Use non-zero offset since 0 is falsy and won't be added
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("node_type=domain");
      expect(calledUrl).toContain("visibility=shared");
      expect(calledUrl).toContain("tags=database");
      expect(calledUrl).toContain("source_project=centient");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=5");
    });

    it("should return total from pagination metadata", async () => {
      const mockCrystals = [createMockCrystal()];

      mockFetch = mockFetchResponse({
        data: mockCrystals,
        meta: { pagination: { total: 42, limit: 50, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.list();

      expect(result.total).toBe(42);
      expect(result.hasMore).toBe(true);
    });

    it("should default total to data length if no pagination metadata", async () => {
      const mockCrystals = [
        createMockCrystal({ id: "c1" }),
        createMockCrystal({ id: "c2" }),
        createMockCrystal({ id: "c3" }),
      ];

      mockFetch = mockFetchResponse({ data: mockCrystals });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.list();

      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });
  });

  // ========================================================================
  // crystals.update
  // ========================================================================
  describe("crystals.update", () => {
    it("should PATCH /v1/crystals/:id", async () => {
      const mockCrystal = createMockCrystal({
        title: "Updated Crystal",
        description: "Updated description",
      });

      mockFetch = mockFetchResponse({ data: mockCrystal });
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.update("crystal-123", {
        title: "Updated Crystal",
        description: "Updated description",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated Crystal",
            description: "Updated description",
          }),
        })
      );

      expect(crystal.title).toBe("Updated Crystal");
      expect(crystal.description).toBe("Updated description");
    });

    it("should update visibility", async () => {
      const mockCrystal = createMockCrystal({ visibility: "public" });

      mockFetch = mockFetchResponse({ data: mockCrystal });
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.update("crystal-123", {
        visibility: "public",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ visibility: "public" }),
        })
      );

      expect(crystal.visibility).toBe("public");
    });

    it("should update tags", async () => {
      const mockCrystal = createMockCrystal({ tags: ["new-tag", "another-tag"] });

      mockFetch = mockFetchResponse({ data: mockCrystal });
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.update("crystal-123", {
        tags: ["new-tag", "another-tag"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ tags: ["new-tag", "another-tag"] }),
        })
      );

      expect(crystal.tags).toEqual(["new-tag", "another-tag"]);
    });
  });

  // ========================================================================
  // crystals.delete
  // ========================================================================
  describe("crystals.delete", () => {
    it("should DELETE /v1/crystals/:id", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.delete("crystal-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("should URL encode crystal ID on delete", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.delete("crystal with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%20with%20spaces",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  // ========================================================================
  // crystals.search
  // ========================================================================
  describe("crystals.search", () => {
    it("should POST to /v1/crystals/search", async () => {
      const mockResults: KnowledgeCrystalSearchResult[] = [
        { item: createMockCrystal({ title: "Auth Crystal" }), score: 0.95 },
        { item: createMockCrystal({ title: "Security Crystal" }), score: 0.85 },
      ];

      mockFetch = mockFetchResponse({ data: mockResults });
      vi.stubGlobal("fetch", mockFetch);

      const results = await client.crystals.search({
        query: "authentication",
        limit: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "authentication",
            limit: 5,
          }),
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
      expect(results[0].item.title).toBe("Auth Crystal");
    });

    it("should search with nodeType filter", async () => {
      mockFetch = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "test",
        nodeType: "collection",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "test",
            node_type: "collection",
          }),
        })
      );
    });

    it("should search with visibility filter", async () => {
      mockFetch = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "public crystals",
        visibility: "public",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "public crystals",
            visibility: "public",
          }),
        })
      );
    });

    it("should search with tags filter", async () => {
      mockFetch = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "database patterns",
        tags: ["database", "postgres"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "database patterns",
            tags: ["database", "postgres"],
          }),
        })
      );
    });

    it("should search with all filters", async () => {
      mockFetch = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "best practices",
        nodeType: "domain",
        visibility: "shared",
        tags: ["architecture"],
        limit: 20,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "best practices",
            visibility: "shared",
            tags: ["architecture"],
            limit: 20,
            node_type: "domain",
          }),
        })
      );
    });
  });
});

// ============================================================================
// CrystalItemsResource Tests
// ============================================================================
describe("CrystalItemsResource", () => {
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

  // ========================================================================
  // crystals.items(id).add
  // ========================================================================
  describe("crystals.items(id).add", () => {
    it("should POST to /v1/crystals/:id/items", async () => {
      const mockMembership = createMockMembership();

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const membership = await client.crystals.items("crystal-123").add({
        itemId: "knowledge-item-456",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemId: "knowledge-item-456",
          }),
        })
      );

      expect(membership.itemId).toBe("knowledge-item-456");
    });

    it("should add item with position", async () => {
      const mockMembership = createMockMembership({ position: 5 });

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const membership = await client.crystals.items("crystal-123").add({
        itemId: "knowledge-item-456",
        position: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemId: "knowledge-item-456",
            position: 5,
          }),
        })
      );

      expect(membership.position).toBe(5);
    });

    it("should add item with addedBy", async () => {
      const mockMembership = createMockMembership({ addedBy: "promotion" });

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const membership = await client.crystals.items("crystal-123").add({
        itemId: "knowledge-item-456",
        addedBy: "promotion",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemId: "knowledge-item-456",
            addedBy: "promotion",
          }),
        })
      );

      expect(membership.addedBy).toBe("promotion");
    });

    it("should add item with all params", async () => {
      const mockMembership = createMockMembership({
        position: 10,
        addedBy: "finalization",
      });

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const membership = await client.crystals.items("crystal-123").add({
        itemId: "knowledge-item-456",
        position: 10,
        addedBy: "finalization",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemId: "knowledge-item-456",
            position: 10,
            addedBy: "finalization",
          }),
        })
      );

      expect(membership.position).toBe(10);
      expect(membership.addedBy).toBe("finalization");
    });

    it("should URL encode crystal ID", async () => {
      const mockMembership = createMockMembership();

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal/with/slashes").add({
        itemId: "item-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fwith%2Fslashes/items",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // ========================================================================
  // crystals.items(id).list
  // ========================================================================
  describe("crystals.items(id).list", () => {
    it("should GET /v1/crystals/:id/items", async () => {
      const mockMemberships = [
        createMockMembership({ id: "m1", position: 0 }),
        createMockMembership({ id: "m2", position: 1 }),
        createMockMembership({ id: "m3", position: 2 }),
      ];

      mockFetch = mockFetchResponse({
        data: mockMemberships,
        meta: { pagination: { total: 3, limit: 100, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.items("crystal-123").list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it("should apply limit param", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 10, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal-123").list({ limit: 10 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=10");
    });

    it("should apply offset param", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 50, limit: 20, offset: 20, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.items("crystal-123").list({
        limit: 20,
        offset: 20,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=20");
      expect(calledUrl).toContain("offset=20");
      expect(result.hasMore).toBe(true);
    });

    it("should default total to data length if no pagination metadata", async () => {
      const mockMemberships = [
        createMockMembership({ id: "m1" }),
        createMockMembership({ id: "m2" }),
      ];

      mockFetch = mockFetchResponse({ data: mockMemberships });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.items("crystal-123").list();

      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should URL encode crystal ID on list", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 100, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal with spaces").list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%20with%20spaces/items",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  // ========================================================================
  // crystals.items(id).remove
  // ========================================================================
  describe("crystals.items(id).remove", () => {
    it("should DELETE /v1/crystals/:id/items/:itemId", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal-123").remove("knowledge-item-456");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/items/knowledge-item-456",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("should URL encode both crystal ID and item ID", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal/id").remove("item/id");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fid/items/item%2Fid",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

// ============================================================================
// CrystalVersionsResource Tests
// ============================================================================
describe("CrystalVersionsResource", () => {
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

  // ========================================================================
  // crystals.versions(id).list
  // ========================================================================
  describe("crystals.versions(id).list", () => {
    it("should GET /v1/crystals/:id/versions", async () => {
      const mockVersions = [
        createMockVersion({ id: "v1", version: 1, changelog: "Initial" }),
        createMockVersion({ id: "v2", version: 2, changelog: "Added patterns" }),
      ];

      mockFetch = mockFetchResponse({
        data: mockVersions,
        meta: { pagination: { total: 2, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.versions("crystal-123").list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/versions",
        expect.objectContaining({ method: "GET" })
      );

      expect(result.versions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should apply limit param", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 10, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.versions("crystal-123").list({ limit: 10 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=10");
    });

    it("should apply offset param", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 20, limit: 10, offset: 10, hasMore: true } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.versions("crystal-123").list({
        limit: 10,
        offset: 10,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("offset=10");
      expect(result.hasMore).toBe(true);
    });

    it("should default total to data length if no pagination metadata", async () => {
      const mockVersions = [
        createMockVersion({ id: "v1", version: 1 }),
        createMockVersion({ id: "v2", version: 2 }),
        createMockVersion({ id: "v3", version: 3 }),
      ];

      mockFetch = mockFetchResponse({ data: mockVersions });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.versions("crystal-123").list();

      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it("should URL encode crystal ID", async () => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.versions("crystal/with/slashes").list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fwith%2Fslashes/versions",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  // ========================================================================
  // crystals.versions(id).get
  // ========================================================================
  describe("crystals.versions(id).get", () => {
    it("should GET /v1/crystals/:id/versions/:version", async () => {
      const mockVersion = createMockVersion({
        version: 2,
        changelog: "Added authentication patterns",
      });

      mockFetch = mockFetchResponse({ data: mockVersion });
      vi.stubGlobal("fetch", mockFetch);

      const version = await client.crystals.versions("crystal-123").get(2);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/versions/2",
        expect.objectContaining({ method: "GET" })
      );

      expect(version.version).toBe(2);
      expect(version.changelog).toBe("Added authentication patterns");
    });

    it("should get version 1", async () => {
      const mockVersion = createMockVersion({ version: 1, changelog: "Initial" });

      mockFetch = mockFetchResponse({ data: mockVersion });
      vi.stubGlobal("fetch", mockFetch);

      const version = await client.crystals.versions("crystal-123").get(1);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/versions/1",
        expect.objectContaining({ method: "GET" })
      );

      expect(version.version).toBe(1);
    });

    it("should URL encode crystal ID", async () => {
      const mockVersion = createMockVersion();

      mockFetch = mockFetchResponse({ data: mockVersion });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.versions("crystal with spaces").get(1);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%20with%20spaces/versions/1",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  // ========================================================================
  // crystals.versions(id).create
  // ========================================================================
  describe("crystals.versions(id).create", () => {
    it("should POST to /v1/crystals/:id/versions", async () => {
      const mockVersion = createMockVersion({
        version: 3,
        changelog: "Added new security patterns",
      });

      mockFetch = mockFetchResponse({ data: mockVersion }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const version = await client.crystals.versions("crystal-123").create({
        changelog: "Added new security patterns",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-123/versions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            changelog: "Added new security patterns",
          }),
        })
      );

      expect(version.version).toBe(3);
      expect(version.changelog).toBe("Added new security patterns");
    });

    it("should create version with detailed changelog", async () => {
      const mockVersion = createMockVersion({
        version: 2,
        changelog: "## Changes\n- Added 5 new patterns\n- Updated descriptions\n- Fixed ordering",
      });

      mockFetch = mockFetchResponse({ data: mockVersion }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const version = await client.crystals.versions("crystal-123").create({
        changelog: "## Changes\n- Added 5 new patterns\n- Updated descriptions\n- Fixed ordering",
      });

      expect(version.changelog).toContain("Added 5 new patterns");
    });

    it("should URL encode crystal ID", async () => {
      const mockVersion = createMockVersion();

      mockFetch = mockFetchResponse({ data: mockVersion }, 201);
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.versions("crystal/id").create({
        changelog: "Test version",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fid/versions",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // ========================================================================
  // Fluent interface
  // ========================================================================
  describe("fluent interface", () => {
    it("should return new CrystalVersionsResource for each versions() call", () => {
      const versions1 = client.crystals.versions("crystal-1");
      const versions2 = client.crystals.versions("crystal-2");

      expect(versions1).not.toBe(versions2);
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================
describe("CrystalsResource Error Handling", () => {
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

  describe("404 errors", () => {
    it("should throw NotFoundError when crystal not found on get", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Crystal not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.crystals.get("non-existent")).rejects.toThrow(
        NotFoundError
      );
    });

    it("should throw NotFoundError when crystal not found on update", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Crystal not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.update("non-existent", { title: "New Name" })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw NotFoundError when crystal not found on delete", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Crystal not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.crystals.delete("non-existent")).rejects.toThrow(
        NotFoundError
      );
    });

    it("should throw NotFoundError when crystal not found on items.add", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Crystal not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.items("non-existent").add({ itemId: "item-123" })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw NotFoundError when item not found on items.remove", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Item not found in crystal" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.items("crystal-123").remove("non-existent-item")
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("validation errors", () => {
    it("should throw ValidationFailedError for invalid create params", async () => {
      const zodError = {
        success: false,
        error: {
          issues: [
            { code: "invalid_type", message: "Name is required", path: ["name"] },
          ],
          name: "ZodError",
        },
      };

      mockFetch = mockFetchResponse(zodError, 400);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.create({
          nodeType: "collection",
          title: "",
        })
      ).rejects.toThrow(ValidationFailedError);
    });

    it("should throw ValidationFailedError for invalid nodeType", async () => {
      const zodError = {
        success: false,
        error: {
          issues: [
            {
              code: "invalid_enum_value",
              message: "Invalid node type",
              path: ["nodeType"],
            },
          ],
          name: "ZodError",
        },
      };

      mockFetch = mockFetchResponse(zodError, 400);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.create({
          // @ts-expect-error - intentionally testing invalid type
          nodeType: "invalid_type",
          title: "Test",
        })
      ).rejects.toThrow(ValidationFailedError);
    });

    it("should throw ValidationFailedError for invalid itemId on add", async () => {
      const zodError = {
        success: false,
        error: {
          issues: [
            { code: "invalid_type", message: "itemId is required", path: ["itemId"] },
          ],
          name: "ZodError",
        },
      };

      mockFetch = mockFetchResponse(zodError, 400);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.items("crystal-123").add({
          // @ts-expect-error - intentionally testing missing itemId
          itemId: undefined,
        })
      ).rejects.toThrow(ValidationFailedError);
    });

    it("should throw ValidationFailedError for invalid search query", async () => {
      const zodError = {
        success: false,
        error: {
          issues: [
            { code: "too_small", message: "Query must be at least 1 character", path: ["query"] },
          ],
          name: "ZodError",
        },
      };

      mockFetch = mockFetchResponse(zodError, 400);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.search({ query: "" })
      ).rejects.toThrow(ValidationFailedError);
    });
  });

  describe("fluent interface", () => {
    it("should return new CrystalItemsResource for each items() call", () => {
      const items1 = client.crystals.items("crystal-1");
      const items2 = client.crystals.items("crystal-2");

      expect(items1).not.toBe(items2);
    });

    it("should support chained operations", async () => {
      const mockMembership = createMockMembership();
      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      // This tests the fluent interface pattern
      const crystalItems = client.crystals.items("crystal-123");
      const membership = await crystalItems.add({ itemId: "item-1" });

      expect(membership.itemId).toBe("knowledge-item-456");
    });
  });

  describe("version errors", () => {
    it("should throw NotFoundError when version not found", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Version not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.versions("crystal-123").get(999)
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw NotFoundError when crystal not found on versions.create", async () => {
      mockFetch = mockFetchResponse(
        { code: "NOT_FOUND", message: "Crystal not found" },
        404
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.versions("non-existent").create({ changelog: "Test" })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw ValidationFailedError for empty changelog", async () => {
      const zodError = {
        success: false,
        error: {
          issues: [
            { code: "too_small", message: "Changelog is required", path: ["changelog"] },
          ],
          name: "ZodError",
        },
      };

      mockFetch = mockFetchResponse(zodError, 400);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.versions("crystal-123").create({ changelog: "" })
      ).rejects.toThrow(ValidationFailedError);
    });
  });
});

// ============================================================================
// Crystal Type Coverage Tests
// ============================================================================
describe("CrystalsResource Type Coverage", () => {
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

  describe("node types", () => {
    const nodeTypes = [
      "collection",
      "session_artifact",
      "project",
      "domain",
    ] as const;

    it.each(nodeTypes)("should create crystal with nodeType '%s'", async (nodeType) => {
      const mockCrystal = createMockCrystal({ nodeType });

      mockFetch = mockFetchResponse({ data: mockCrystal }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.create({
        nodeType,
        title: `${nodeType} Crystal`,
      });

      expect(crystal.nodeType).toBe(nodeType);
    });

    it.each(nodeTypes)("should filter list by nodeType '%s'", async (nodeType) => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ nodeType });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`node_type=${nodeType}`);
    });
  });

  describe("visibility levels", () => {
    const visibilityLevels = ["private", "shared", "public"] as const;

    it.each(visibilityLevels)("should create crystal with visibility '%s'", async (visibility) => {
      const mockCrystal = createMockCrystal({ visibility });

      mockFetch = mockFetchResponse({ data: mockCrystal }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const crystal = await client.crystals.create({
        nodeType: "collection",
        title: "Test Crystal",
        visibility,
      });

      expect(crystal.visibility).toBe(visibility);
    });

    it.each(visibilityLevels)("should filter list by visibility '%s'", async (visibility) => {
      mockFetch = mockFetchResponse({
        data: [],
        meta: { pagination: { total: 0, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.list({ visibility });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`visibility=${visibility}`);
    });
  });

  describe("membership addedBy types", () => {
    const addedByTypes = ["promotion", "manual", "import", "finalization"] as const;

    it.each(addedByTypes)("should add item with addedBy '%s'", async (addedBy) => {
      const mockMembership = createMockMembership({ addedBy: addedBy });

      mockFetch = mockFetchResponse({ data: mockMembership }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const membership = await client.crystals.items("crystal-123").add({
        itemId: "item-456",
        addedBy: addedBy,
      });

      expect(membership.addedBy).toBe(addedBy);
    });
  });
});

// ============================================================================
// CrystalItemsResource — bulkAdd & reorder Tests
// ============================================================================
describe("CrystalItemsResource bulkAdd & reorder", () => {
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

  describe("crystals.items(id).bulkAdd", () => {
    it("should POST to /v1/crystals/:id/items/bulk", async () => {
      const mockData = { added: 3 };
      mockFetch = mockFetchResponse({ data: mockData });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.items("crystal-1").bulkAdd([
        { itemId: "item-1" },
        { itemId: "item-2", position: 1 },
        { itemId: "item-3", position: 2 },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-1/items/bulk",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ items: [
            { itemId: "item-1" },
            { itemId: "item-2", position: 1 },
            { itemId: "item-3", position: 2 },
          ] }),
        })
      );
      expect(result.added).toBe(3);
    });
  });

  describe("crystals.items(id).reorder", () => {
    it("should POST to /v1/crystals/:id/items/reorder", async () => {
      mockFetch = mockFetchResponse({ data: undefined });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.items("crystal-1").reorder(["item-2", "item-1", "item-3"]);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal-1/items/reorder",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ itemIds: ["item-2", "item-1", "item-3"] }),
        })
      );
    });
  });
});
