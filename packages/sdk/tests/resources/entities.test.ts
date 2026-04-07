/**
 * EntitiesResource and ExtractionResource Tests (ADR-062 Phase 4)
 *
 * Tests for the SDK interface to entity graph and extraction APIs.
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...).
 *
 * Covers:
 *   EntitiesResource.list()    — GET /v1/entities
 *   EntitiesResource.get()     — GET /v1/entities/:id
 *   EntitiesResource.review()  — POST /v1/entities/:id/review
 *   ExtractionResource.extract()      — POST /v1/extraction/extract
 *   ExtractionResource.listJobs()     — GET /v1/extraction/jobs
 *   ExtractionResource.updateConfig() — PATCH /v1/extraction/config
 *   ExtractionResource.getStats()     — GET /v1/extraction/stats
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";
import {
  EntityClass,
  EntityReviewAction,
  ExtractionJobStatus,
} from "../../src/resources/entities.js";
import type {
  EntityCard,
  EntityWithEdges,
  EntityReviewResult,
  ExtractionJob,
  ExtractionStats,
  ExtractionConfig,
} from "../../src/resources/entities.js";

// ============================================================================
// Helpers
// ============================================================================

function mockJsonResponse(data: unknown, status = 200) {
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

const ENTITY_ID   = "00000000-0000-4000-8000-000000000001";
const ENTITY_ID_2 = "00000000-0000-4000-8000-000000000002";
const SOURCE_ID   = "00000000-0000-4000-8000-000000000003";
const JOB_ID      = "00000000-0000-4000-8000-000000000004";

const mockEntityCard: EntityCard = {
  id: ENTITY_ID,
  canonicalName: "Alice",
  entityClass: EntityClass.PERSON,
  confidence: 0.9,
  mentionCount: 5,
  verified: false,
  autoConstructed: true,
  corroboratingSources: ["src-1"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockEntityWithEdges: EntityWithEdges = {
  ...mockEntityCard,
  edges: [
    { sourceId: ENTITY_ID, targetId: ENTITY_ID_2, edgeType: "related_to" },
  ],
};

const mockReviewResult: EntityReviewResult = {
  reviewId: ENTITY_ID,
  action: EntityReviewAction.APPROVE_MERGE,
  resolvedEntityId: ENTITY_ID_2,
  status: "resolved",
};

const mockExtractionJob: ExtractionJob = {
  id: JOB_ID,
  sourceId: SOURCE_ID,
  sourceType: "session_note",
  status: ExtractionJobStatus.PENDING,
  contentHash: "abc123",
  attemptCount: 0,
  lastError: null,
  retryAfter: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockExtractionStats: ExtractionStats = {
  jobs: {
    pending: 2,
    processing: 1,
    completed: 10,
    failed: 0,
    skipped: 1,
  },
  dailyApiCallUsage: 5,
  averageConfidence: 0.85,
  entityCountsByClass: [
    { class: "person", total: 8, verified: 3, unverified: 5, averageConfidence: 0.82 },
  ],
  totalEntities: 8,
  totalVerified: 3,
  generatedAt: "2026-01-01T00:00:00Z",
};

// ============================================================================
// Test Setup
// ============================================================================

let client: EngramClient;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new EngramClient({
    baseUrl: "http://localhost:3100",
    apiKey: "test-api-key",
    timeout: 5000,
    retries: 1,
  });
  mockFetch = mockJsonResponse({});
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ============================================================================
// EntitiesResource.list()
// ============================================================================

describe("client.entities.list()", () => {
  it("GETs /v1/entities with no params", async () => {
    mockFetch = mockJsonResponse({
      data: [mockEntityCard],
      meta: { pagination: { total: 1, limit: 20, offset: 0, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.list();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/entities",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].canonicalName).toBe("Alice");
    expect(result.meta.pagination.total).toBe(1);
  });

  it("appends class filter to query string", async () => {
    mockFetch = mockJsonResponse({
      data: [],
      meta: { pagination: { total: 0, limit: 20, offset: 0, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.list({ class: EntityClass.PERSON });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("class=person"),
      expect.anything()
    );
  });

  it("appends verified filter to query string", async () => {
    mockFetch = mockJsonResponse({
      data: [],
      meta: { pagination: { total: 0, limit: 20, offset: 0, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.list({ verified: true });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("verified=true"),
      expect.anything()
    );
  });

  it("appends min_confidence filter to query string", async () => {
    mockFetch = mockJsonResponse({
      data: [],
      meta: { pagination: { total: 0, limit: 20, offset: 0, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.list({ minConfidence: 0.8 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("min_confidence=0.8"),
      expect.anything()
    );
  });

  it("appends limit and offset to query string", async () => {
    mockFetch = mockJsonResponse({
      data: [],
      meta: { pagination: { total: 0, limit: 10, offset: 5, hasMore: false } },
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.list({ limit: 10, offset: 5 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("offset=5");
  });

  it("throws EngramError on 4xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALIDATION_FAILED", message: "Bad params" } },
      400
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.entities.list()).rejects.toBeInstanceOf(EngramError);
  });

  it("falls back to data.length when pagination meta is absent", async () => {
    mockFetch = mockJsonResponse({ data: [mockEntityCard, mockEntityCard] });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.list();
    expect(result.meta.pagination.total).toBe(2);
    expect(result.meta.pagination.hasMore).toBe(false);
  });
});

// ============================================================================
// EntitiesResource.get()
// ============================================================================

describe("client.entities.get()", () => {
  it("GETs /v1/entities/:id and returns entity with edges", async () => {
    mockFetch = mockJsonResponse({ data: mockEntityWithEdges });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.get(ENTITY_ID);

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/v1/entities/${ENTITY_ID}`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.data.id).toBe(ENTITY_ID);
    expect(result.data.edges).toHaveLength(1);
    expect(result.data.edges[0].edgeType).toBe("related_to");
  });

  it("URL-encodes the entity ID", async () => {
    mockFetch = mockJsonResponse({ data: mockEntityWithEdges });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.get(ENTITY_ID);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent(ENTITY_ID));
  });

  it("throws EngramError on 404", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "NOT_FOUND", message: "Entity not found" } },
      404
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.entities.get(ENTITY_ID)).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// EntitiesResource.review()
// ============================================================================

describe("client.entities.review()", () => {
  it("POSTs to /v1/entities/:id/review with approve_merge action", async () => {
    mockFetch = mockJsonResponse({ data: mockReviewResult });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.review(ENTITY_ID, {
      action: EntityReviewAction.APPROVE_MERGE,
      targetEntityId: ENTITY_ID_2,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/v1/entities/${ENTITY_ID}/review`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: EntityReviewAction.APPROVE_MERGE,
          targetEntityId: ENTITY_ID_2,
        }),
      })
    );
    expect(result.data.action).toBe(EntityReviewAction.APPROVE_MERGE);
  });

  it("POSTs to /v1/entities/:id/review with dismiss action", async () => {
    const dismissResult: EntityReviewResult = {
      reviewId: ENTITY_ID,
      action: EntityReviewAction.DISMISS,
      status: "dismissed",
    };
    mockFetch = mockJsonResponse({ data: dismissResult });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.review(ENTITY_ID, {
      action: EntityReviewAction.DISMISS,
    });

    expect(result.data.action).toBe(EntityReviewAction.DISMISS);
  });

  it("throws EngramError on 4xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALIDATION_FAILED", message: "Bad request" } },
      400
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.entities.review(ENTITY_ID, { action: EntityReviewAction.DISMISS })
    ).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.extract()
// ============================================================================

describe("client.extraction.extract()", () => {
  it("POSTs to /v1/extraction/extract with job params", async () => {
    mockFetch = mockJsonResponse({ data: mockExtractionJob });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.extract({
      sourceId: SOURCE_ID,
      sourceType: "session_note",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/extract",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(SOURCE_ID),
      })
    );
    expect(result.data.id).toBe(JOB_ID);
    expect(result.data.status).toBe(ExtractionJobStatus.PENDING);
  });

  it("includes rescan flag when provided", async () => {
    mockFetch = mockJsonResponse({ data: mockExtractionJob });
    vi.stubGlobal("fetch", mockFetch);

    await client.extraction.extract({
      sourceId: SOURCE_ID,
      sourceType: "knowledge_crystal",
      rescan: true,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.rescan).toBe(true);
    expect(body.sourceType).toBe("knowledge_crystal");
  });

  it("calls /v1/extraction/extract (not /v1/extraction/jobs)", async () => {
    mockFetch = mockJsonResponse({ data: mockExtractionJob });
    vi.stubGlobal("fetch", mockFetch);

    await client.extraction.extract({
      sourceId: SOURCE_ID,
      sourceType: "session_note",
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v1/extraction/extract");
    expect(calledUrl).not.toContain("/v1/extraction/jobs");
  });

  it("throws EngramError on 4xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALIDATION_FAILED", message: "Invalid source" } },
      400
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.extract({ sourceId: SOURCE_ID, sourceType: "session_note" })
    ).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.listJobs()
// ============================================================================

describe("client.extraction.listJobs()", () => {
  it("GETs /v1/extraction/jobs with no filter", async () => {
    mockFetch = mockJsonResponse({ data: [mockExtractionJob] });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.listJobs();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/jobs",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(JOB_ID);
  });

  it("appends status filter when provided", async () => {
    mockFetch = mockJsonResponse({ data: [] });
    vi.stubGlobal("fetch", mockFetch);

    await client.extraction.listJobs({ status: ExtractionJobStatus.FAILED });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("status=failed"),
      expect.anything()
    );
  });

  it("throws EngramError on 5xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Server error" } },
      500
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.extraction.listJobs()).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.updateConfig()
// ============================================================================

describe("client.extraction.updateConfig()", () => {
  it("PATCHes /v1/extraction/config with threshold", async () => {
    const updatedConfig: ExtractionConfig = { threshold: 0.75 };
    mockFetch = mockJsonResponse({ data: updatedConfig });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.updateConfig({ threshold: 0.75 });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/config",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ threshold: 0.75 }),
      })
    );
    expect(result.data.threshold).toBe(0.75);
  });

  it("PATCHes /v1/extraction/config with dailyCap", async () => {
    const updatedConfig: ExtractionConfig = { dailyCap: 500 };
    mockFetch = mockJsonResponse({ data: updatedConfig });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.updateConfig({ dailyCap: 500 });

    expect(result.data.dailyCap).toBe(500);
  });

  it("PATCHes /v1/extraction/config with both fields", async () => {
    const updatedConfig: ExtractionConfig = { threshold: 0.8, dailyCap: 300 };
    mockFetch = mockJsonResponse({ data: updatedConfig });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.updateConfig({ threshold: 0.8, dailyCap: 300 });

    expect(result.data.threshold).toBe(0.8);
    expect(result.data.dailyCap).toBe(300);
  });

  it("throws EngramError on 4xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "VALIDATION_FAILED", message: "threshold out of range" } },
      400
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      client.extraction.updateConfig({ threshold: 2.0 })
    ).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// ExtractionResource.getStats()
// ============================================================================

describe("client.extraction.getStats()", () => {
  it("GETs /v1/extraction/stats", async () => {
    mockFetch = mockJsonResponse({ data: mockExtractionStats });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.getStats();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/extraction/stats",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.data.jobs.pending).toBe(2);
    expect(result.data.jobs.completed).toBe(10);
    expect(result.data.totalEntities).toBe(8);
    expect(result.data.averageConfidence).toBe(0.85);
    expect(result.data.generatedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("includes entityCountsByClass array", async () => {
    mockFetch = mockJsonResponse({ data: mockExtractionStats });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.extraction.getStats();

    expect(result.data.entityCountsByClass).toHaveLength(1);
    expect(result.data.entityCountsByClass[0].class).toBe("person");
    expect(result.data.entityCountsByClass[0].averageConfidence).toBe(0.82);
  });

  it("throws EngramError on 5xx response", async () => {
    mockFetch = mockJsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Server error" } },
      500
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.extraction.getStats()).rejects.toBeInstanceOf(EngramError);
  });
});

// ============================================================================
// Type correctness (compile-time assertions via runtime checks)
// ============================================================================

describe("Type correctness", () => {
  it("EntityClass enum values are correct", () => {
    expect(EntityClass.PERSON).toBe("person");
    expect(EntityClass.PROJECT).toBe("project");
    expect(EntityClass.SYSTEM).toBe("system");
    expect(EntityClass.CONCEPT).toBe("concept");
    expect(EntityClass.TECHNOLOGY).toBe("technology");
    expect(EntityClass.ORGANIZATION).toBe("organization");
  });

  it("EntityReviewAction enum values are correct", () => {
    expect(EntityReviewAction.APPROVE_MERGE).toBe("approve_merge");
    expect(EntityReviewAction.CREATE_NEW).toBe("create_new");
    expect(EntityReviewAction.DISMISS).toBe("dismiss");
  });

  it("ExtractionJobStatus enum values are correct", () => {
    expect(ExtractionJobStatus.PENDING).toBe("pending");
    expect(ExtractionJobStatus.PROCESSING).toBe("processing");
    expect(ExtractionJobStatus.COMPLETED).toBe("completed");
    expect(ExtractionJobStatus.FAILED).toBe("failed");
    expect(ExtractionJobStatus.SKIPPED).toBe("skipped");
  });

  it("client has entities and extraction resource accessors", () => {
    expect(client.entities).toBeDefined();
    expect(client.extraction).toBeDefined();
    expect(typeof client.entities.list).toBe("function");
    expect(typeof client.entities.get).toBe("function");
    expect(typeof client.entities.review).toBe("function");
    expect(typeof client.extraction.extract).toBe("function");
    expect(typeof client.extraction.listJobs).toBe("function");
    expect(typeof client.extraction.updateConfig).toBe("function");
    expect(typeof client.extraction.getStats).toBe("function");
  });
});

// ============================================================================
// EntitiesResource.graph()
// ============================================================================

describe("client.entities.graph()", () => {
  it("should GET /v1/entities/:id/graph", async () => {
    const mockGraphData = {
      root: { id: "entity-1", canonicalName: "Test", confidence: 0.9, mentionCount: 5, verified: true, entityClass: "concept", autoConstructed: false, corroboratingSources: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      nodes: [],
      edges: [],
      totalNodes: 1,
      depth: 1,
      truncated: false,
    };
    mockFetch = mockJsonResponse({ data: mockGraphData });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.entities.graph("entity-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3100/v1/entities/entity-1/graph",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.data.totalNodes).toBe(1);
    expect(result.data.truncated).toBe(false);
  });

  it("should pass query params for depth and filters", async () => {
    mockFetch = mockJsonResponse({ data: { root: {}, nodes: [], edges: [], totalNodes: 0, depth: 2, truncated: false } });
    vi.stubGlobal("fetch", mockFetch);

    await client.entities.graph("entity-1", { depth: 2, filterClass: "person", minConfidence: 0.8 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("depth=2");
    expect(calledUrl).toContain("filter_class=person");
    expect(calledUrl).toContain("min_confidence=0.8");
  });
});
