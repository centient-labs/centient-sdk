import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import type {
  KnowledgeCrystal,
  ContainedCrystal,
  ParentCrystal,
  CrystalHierarchy,
  ScopedSearchResult,
} from "../../src/types/knowledge-crystal.js";
import type {
  KnowledgeCrystalEdge,
} from "../../src/types/knowledge-crystal-edge.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function createMockCrystal(overrides: Partial<KnowledgeCrystal> = {}): KnowledgeCrystal {
  return {
    id: "crystal-123",
    slug: null,
    nodeType: "project",
    title: "Test Crystal",
    summary: null,
    description: null,
    tags: [],
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
    itemCount: 0,
    versionCount: 0,
    parentId: null,
    parentVersion: null,
    sourceType: null,
    sourceSessionId: null,
    sourceProject: null,
    typeMetadata: {},
    path: null,
    createdAt: "2026-02-04T10:00:00Z",
    updatedAt: "2026-02-04T10:00:00Z",
    ...overrides,
  };
}

function createMockEdge(overrides: Partial<KnowledgeCrystalEdge> = {}): KnowledgeCrystalEdge {
  return {
    id: "edge-123",
    sourceId: "parent-crystal",
    targetId: "child-crystal",
    relationship: "contains",
    metadata: {},
    createdAt: "2026-02-04T10:00:00Z",
    ...overrides,
  };
}

describe("CrystalHierarchyResource", () => {
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

  describe("hierarchy(id).addChild", () => {
    it("should POST to /v1/crystals/:id/children", async () => {
      const mockEdge = createMockEdge();
      mockFetch = mockFetchResponse({ data: mockEdge }, 201);
      vi.stubGlobal("fetch", mockFetch);

      const edge = await client.crystals.hierarchy("parent-crystal").addChild({
        childId: "child-crystal",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/parent-crystal/children",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ childId: "child-crystal" }),
        })
      );
      expect(edge.id).toBe("edge-123");
      expect(edge.relationship).toBe("contains");
    });

    it("should throw EngramError with VALID_CYCLE_DETECTED on cycle", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "VALID_CYCLE_DETECTED", message: "Cycle detected" } },
        400
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.crystals.hierarchy("crystal-a").addChild({ childId: "crystal-b" })
      ).rejects.toThrow(EngramError);
    });
  });

  describe("hierarchy(id).removeChild", () => {
    it("should DELETE /v1/crystals/:id/children/:childId", async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true, status: 204, json: () => Promise.resolve(undefined),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.hierarchy("parent").removeChild("child");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/parent/children/child",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("hierarchy(id).getChildren", () => {
    it("should GET /v1/crystals/:id/children", async () => {
      const mockChildren = [createMockCrystal({ id: "child-1" })];
      mockFetch = mockFetchResponse({
        data: mockChildren,
        meta: { pagination: { total: 1, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.hierarchy("parent").getChildren();
      expect(result.children).toHaveLength(1);
    });

    it("should apply recursive and maxDepth params", async () => {
      mockFetch = mockFetchResponse({ data: [], meta: { pagination: { total: 0, limit: 50, hasMore: false } } });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.hierarchy("parent").getChildren({ recursive: true, maxDepth: 5 });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("recursive=true");
      expect(calledUrl).toContain("maxDepth=5");
    });
  });

  describe("hierarchy(id).getParents", () => {
    it("should GET /v1/crystals/:id/parents", async () => {
      mockFetch = mockFetchResponse({
        data: [createMockCrystal({ id: "parent-1" })],
        meta: { pagination: { total: 1, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.hierarchy("child").getParents();
      expect(result.parents).toHaveLength(1);
    });
  });

  describe("hierarchy(id).getHierarchy", () => {
    it("should GET /v1/crystals/:id/hierarchy", async () => {
      const mockHierarchy: CrystalHierarchy = {
        crystalId: "root",
        children: [{ crystalId: "child-1", children: [], depth: 1 }],
        depth: 0,
      };
      mockFetch = mockFetchResponse({ data: mockHierarchy });
      vi.stubGlobal("fetch", mockFetch);

      const hierarchy = await client.crystals.hierarchy("root").getHierarchy();
      expect(hierarchy.crystalId).toBe("root");
      expect(hierarchy.children).toHaveLength(1);
    });
  });

  describe("hierarchy(id).getCrystalScope", () => {
    it("should GET /v1/crystals/:id/scope/items", async () => {
      mockFetch = mockFetchResponse({ data: ["root-id", "child-1-id"] });
      vi.stubGlobal("fetch", mockFetch);

      const scope = await client.crystals.hierarchy("root-id").getCrystalScope();
      expect(scope).toHaveLength(2);
      expect(scope).toContain("root-id");
    });
  });

  describe("hierarchy(id).searchInScope", () => {
    it("should POST to /v1/crystals/:id/search", async () => {
      const mockResults: ScopedSearchResult[] = [
        { id: "item-1", type: "pattern", title: "Auth", tags: ["auth"], similarity: 0.95, createdAt: "2026-02-04T10:00:00Z" },
      ];
      mockFetch = mockFetchResponse({ data: mockResults });
      vi.stubGlobal("fetch", mockFetch);

      const results = await client.crystals.hierarchy("root-id").searchInScope({
        query: "authentication", limit: 10,
      });
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.95);
    });

    it("should search with all params", async () => {
      mockFetch = mockFetchResponse({ data: [] });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.hierarchy("root-id").searchInScope({
        query: "database", limit: 20, offset: 10, includeContained: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/root-id/scope/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "database", limit: 20, offset: 10, includeContained: false }),
        })
      );
    });
  });

  describe("fluent interface", () => {
    it("should return new CrystalHierarchyResource for each hierarchy() call", () => {
      const h1 = client.crystals.hierarchy("crystal-1");
      const h2 = client.crystals.hierarchy("crystal-2");
      expect(h1).not.toBe(h2);
    });

    it("should URL encode crystal ID", async () => {
      const mockEdge = createMockEdge();
      mockFetch = mockFetchResponse({ data: mockEdge }, 201);
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.hierarchy("crystal/with/slashes").addChild({ childId: "child-id" });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/crystal%2Fwith%2Fslashes/children",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
