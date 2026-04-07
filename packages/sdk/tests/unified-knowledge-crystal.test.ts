/**
 * Unified Knowledge Crystal Model Tests (ADR-055, Phase C)
 *
 * Verifies the unified type model:
 *  (a) NodeType union includes all 12 values
 *  (b) client.crystals.list({ nodeType }) returns typed KnowledgeCrystal[]
 *  (c) KnowledgeCrystalEdge accepts 'contains' relationship
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../src/client.js";
import type { NodeType } from "../src/types/node-type.js";
import type {
  KnowledgeCrystal,
  KnowledgeCrystalSearchResult,
} from "../src/types/knowledge-crystal.js";
import type {
  KnowledgeCrystalEdge,
  KnowledgeCrystalEdgeRelationship,
} from "../src/types/knowledge-crystal-edge.js";

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function createMockCrystal(overrides: Partial<KnowledgeCrystal> = {}): KnowledgeCrystal {
  return {
    id: "crystal-123e4567-e89b-12d3-a456-426614174000",
    slug: null,
    nodeType: "pattern",
    title: "Test Pattern",
    summary: null,
    description: null,
    tags: [],
    contentRef: null,
    contentInline: "Some content",
    embeddingStatus: "synced",
    embeddingUpdatedAt: null,
    confidence: 0.9,
    verified: false,
    visibility: "private",
    license: null,
    ownerIds: ["user-1"],
    version: 1,
    forkCount: 0,
    starCount: 0,
    itemCount: 0,
    versionCount: 1,
    parentId: null,
    parentVersion: null,
    sourceType: "manual",
    sourceSessionId: null,
    sourceProject: "test-project",
    typeMetadata: {},
    path: null,
    createdAt: "2026-01-25T10:00:00Z",
    updatedAt: "2026-01-25T10:00:00Z",
    ...overrides,
  };
}

function createMockEdge(overrides: Partial<KnowledgeCrystalEdge> = {}): KnowledgeCrystalEdge {
  return {
    id: "edge-123",
    sourceId: "node-1",
    targetId: "node-2",
    relationship: "related_to",
    metadata: {},
    createdAt: "2026-01-25T10:00:00Z",
    ...overrides,
  };
}

// ============================================================================
// (a) NodeType union completeness — compile-time and runtime
// ============================================================================

describe("NodeType union (ADR-055)", () => {
  // The full 12-value set
  const ALL_NODE_TYPES: NodeType[] = [
    // Content types (formerly KnowledgeItemType)
    "pattern",
    "learning",
    "decision",
    "note",
    "finding",
    "constraint",
    // Container types (formerly CrystalType)
    "collection",
    "session_artifact",
    "project",
    "domain",
    // Terrafirma types
    "file_ref",
    "directory",
  ];

  it("should include exactly 12 values", () => {
    expect(ALL_NODE_TYPES).toHaveLength(12);
  });

  it("should include all 6 content types (formerly KnowledgeItemType)", () => {
    const contentTypes: NodeType[] = [
      "pattern",
      "learning",
      "decision",
      "note",
      "finding",
      "constraint",
    ];
    for (const t of contentTypes) {
      expect(ALL_NODE_TYPES).toContain(t);
    }
  });

  it("should include all 4 container types (formerly CrystalType)", () => {
    const containerTypes: NodeType[] = [
      "collection",
      "session_artifact",
      "project",
      "domain",
    ];
    for (const t of containerTypes) {
      expect(ALL_NODE_TYPES).toContain(t);
    }
  });

  it("should include both Terrafirma types", () => {
    const terrafirmaTypes: NodeType[] = ["file_ref", "directory"];
    for (const t of terrafirmaTypes) {
      expect(ALL_NODE_TYPES).toContain(t);
    }
  });

  it("should allow any NodeType value on KnowledgeCrystal.nodeType", () => {
    // TypeScript compile-time check: all 12 values are assignable to NodeType
    const nodes: KnowledgeCrystal[] = ALL_NODE_TYPES.map((nodeType) =>
      createMockCrystal({ nodeType })
    );
    expect(nodes).toHaveLength(12);
    expect(nodes.map((n) => n.nodeType)).toEqual(ALL_NODE_TYPES);
  });
});

// ============================================================================
// (b) client.crystals.list({ nodeType }) returns typed KnowledgeCrystal[]
// ============================================================================

describe("CrystalsResource — nodeType filter (ADR-055)", () => {
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

  it("should send node_type query param when nodeType is a single value", async () => {
    const mockPattern = createMockCrystal({ nodeType: "pattern" });
    mockFetch = mockFetchResponse({
      data: [mockPattern],
      meta: { pagination: { total: 1, limit: 50, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.crystals.list({ nodeType: "pattern" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("node_type=pattern");

    expect(result.crystals).toHaveLength(1);
    expect(result.crystals[0].nodeType).toBe("pattern");
    // Return type is KnowledgeCrystal[] — verify unified fields exist
    const crystal: KnowledgeCrystal = result.crystals[0];
    expect(crystal.id).toBeDefined();
    expect(crystal.nodeType).toBe("pattern");
  });

  it("should send comma-separated node_type when nodeType is an array", async () => {
    const mockPattern = createMockCrystal({ nodeType: "pattern" });
    const mockDecision = createMockCrystal({ nodeType: "decision", id: "crystal-456" });
    mockFetch = mockFetchResponse({
      data: [mockPattern, mockDecision],
      meta: { pagination: { total: 2, limit: 50, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.crystals.list({ nodeType: ["pattern", "decision"] });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("node_type=pattern%2Cdecision");

    expect(result.crystals).toHaveLength(2);
  });

  it("should work with all 12 NodeType values as filter", async () => {
    const nodeTypes: NodeType[] = [
      "pattern", "learning", "decision", "note", "finding", "constraint",
      "collection", "session_artifact", "project", "domain", "file_ref", "directory",
    ];

    for (const nodeType of nodeTypes) {
      const mockNode = createMockCrystal({ nodeType });
      mockFetch = mockFetchResponse({
        data: [mockNode],
        meta: { pagination: { total: 1, limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.crystals.list({ nodeType });
      expect(result.crystals[0].nodeType).toBe(nodeType);
    }
  });

  it("should list without nodeType filter when not specified", async () => {
    mockFetch = mockFetchResponse({
      data: [],
      meta: { pagination: { total: 0, limit: 50, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.crystals.list();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("node_type");
    expect(calledUrl).toBe("http://localhost:3100/v1/crystals");
  });

  it("should return KnowledgeCrystalSearchResult[] from search with nodeType filter", async () => {
    const mockResult: KnowledgeCrystalSearchResult = {
      item: createMockCrystal({ nodeType: "pattern" }),
      score: 0.95,
      highlights: { title: ["Repository <em>Pattern</em>"] },
    };

    mockFetch = mockFetchResponse({ data: [mockResult] });
    vi.stubGlobal("fetch", mockFetch);

    const results = await client.crystals.search({
      query: "authentication",
      nodeType: "pattern",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/crystals/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "authentication", nodeType: "pattern" }),
      })
    );

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.95);
    expect(results[0].item.nodeType).toBe("pattern");
  });

  it("should create a node with nodeType field via crystals.create", async () => {
    const mockNode = createMockCrystal({ nodeType: "collection", title: "Auth Patterns" });
    mockFetch = mockFetchResponse({ data: mockNode }, 201);
    vi.stubGlobal("fetch", mockFetch);

    const node = await client.crystals.create({
      nodeType: "collection",
      title: "Auth Patterns",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/crystals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nodeType: "collection", title: "Auth Patterns" }),
      })
    );

    expect(node.nodeType).toBe("collection");
    expect(node.title).toBe("Auth Patterns");
  });
});

// ============================================================================
// (c) KnowledgeCrystalEdge accepts 'contains' relationship
// ============================================================================

describe("KnowledgeCrystalEdge — contains relationship (ADR-055)", () => {
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

  it("KnowledgeCrystalEdge accepts 'contains' as a valid relationship", () => {
    // TypeScript compile-time check: 'contains' is assignable to KnowledgeCrystalEdgeRelationship
    const containsEdge: KnowledgeCrystalEdge = createMockEdge({
      relationship: "contains",
    });

    expect(containsEdge.relationship).toBe("contains");
  });

  it("KnowledgeCrystalEdgeRelationship includes all 6 values", () => {
    const allRelationships: KnowledgeCrystalEdgeRelationship[] = [
      "contains",
      "derived_from",
      "related_to",
      "contradicts",
      "implements",
      "depends_on",
    ];

    const edges = allRelationships.map((relationship) =>
      createMockEdge({ relationship })
    );

    expect(edges).toHaveLength(6);
    expect(edges.map((e) => e.relationship)).toEqual(allRelationships);
  });

  it("client.edges.create accepts 'contains' relationship", async () => {
    const mockEdge = createMockEdge({ relationship: "contains" });
    mockFetch = mockFetchResponse({ data: mockEdge }, 201);
    vi.stubGlobal("fetch", mockFetch);

    const edge = await client.edges.create({
      sourceId: "collection-1",
      targetId: "pattern-1",
      relationship: "contains",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/edges",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceId: "collection-1",
          targetId: "pattern-1",
          relationship: "contains",
        }),
      })
    );

    expect(edge.relationship).toBe("contains");
  });

  it("client.edges.list can filter by 'contains' relationship", async () => {
    const mockEdges = [
      createMockEdge({ relationship: "contains", sourceId: "collection-1" }),
    ];
    mockFetch = mockFetchResponse({
      data: mockEdges,
      meta: { pagination: { total: 1, limit: 50, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.edges.list({
      sourceId: "collection-1",
      relationship: "contains",
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("relationship=contains");
    expect(calledUrl).toContain("sourceId=collection-1");

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].relationship).toBe("contains");
  });

  it("KnowledgeCrystalEdge has optional createdBy field", () => {
    const edgeWithCreator: KnowledgeCrystalEdge = createMockEdge({
      relationship: "contains",
      createdBy: "user-1",
    });

    expect(edgeWithCreator.createdBy).toBe("user-1");

    const edgeWithoutCreator: KnowledgeCrystalEdge = createMockEdge({
      relationship: "derived_from",
    });

    expect(edgeWithoutCreator.createdBy).toBeUndefined();
  });
});

// ============================================================================
// KnowledgeCrystal field completeness
// ============================================================================

describe("KnowledgeCrystal field completeness", () => {
  it("KnowledgeCrystal has all fields from former KnowledgeItem", () => {
    const node = createMockCrystal({
      nodeType: "learning",
      contentInline: "Content here",
      confidence: 0.8,
      verified: true,
      typeMetadata: { key: "value" },
      sourceType: "session",
      sourceSessionId: "session-123",
      sourceProject: "my-project",
    });

    // Former KnowledgeItem fields
    expect(node.nodeType).toBe("learning");
    expect(node.title).toBeDefined();
    expect(node.summary).toBeDefined();
    expect(node.tags).toBeDefined();
    expect(node.contentInline).toBe("Content here");
    expect(node.confidence).toBe(0.8);
    expect(node.verified).toBe(true);
    expect(node.typeMetadata).toEqual({ key: "value" });
    expect(node.sourceType).toBe("session");
    expect(node.sourceSessionId).toBe("session-123");
    expect(node.sourceProject).toBe("my-project");
  });

  it("KnowledgeCrystal has all fields from former Crystal", () => {
    const node = createMockCrystal({
      nodeType: "collection",
      slug: "auth-patterns",
      visibility: "shared",
      license: "MIT",
      ownerIds: ["user-1", "user-2"],
      version: 3,
      forkCount: 2,
      starCount: 10,
      itemCount: 5,
      versionCount: 3,
      parentId: "parent-crystal-id",
      parentVersion: 1,
    });

    // Former Crystal fields
    expect(node.slug).toBe("auth-patterns");
    expect(node.visibility).toBe("shared");
    expect(node.license).toBe("MIT");
    expect(node.ownerIds).toEqual(["user-1", "user-2"]);
    expect(node.version).toBe(3);
    expect(node.forkCount).toBe(2);
    expect(node.starCount).toBe(10);
    expect(node.itemCount).toBe(5);
    expect(node.versionCount).toBe(3);
    expect(node.parentId).toBe("parent-crystal-id");
    expect(node.parentVersion).toBe(1);
  });

  it("KnowledgeCrystal has Terrafirma path field", () => {
    const fileNode = createMockCrystal({
      nodeType: "file_ref",
      path: "/src/auth/service.ts",
    });

    expect(fileNode.nodeType).toBe("file_ref");
    expect(fileNode.path).toBe("/src/auth/service.ts");

    const dirNode = createMockCrystal({
      nodeType: "directory",
      path: "/src/auth/",
    });

    expect(dirNode.nodeType).toBe("directory");
    expect(dirNode.path).toBe("/src/auth/");
  });
});
