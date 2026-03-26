/**
 * E2E Tests — Reranking Feature (TypeScript SDK)
 *
 * Covers the full reranking surface exposed by CrystalsResource:
 *   - client.crystals.rerank()          POST /v1/crystals/rerank
 *   - client.crystals.search({ reranking: { enabled: true } })
 *   - kill-switch / heuristic fallback
 *   - backward-compatible search (no reranking)
 *   - 400 error handling
 *
 * HTTP is mocked via vi.stubGlobal("fetch", …) — no daemon required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { ValidationFailedError, EngramError } from "../../src/errors.js";
import type {
  KnowledgeCrystalSearchResult,
  CrystalSearchWithRerankingResult,
} from "../../src/types/knowledge-crystal.js";
import type {
  RerankRequest,
  RerankResponse,
  RerankCandidate,
  RerankingMetadata,
  RankedSearchResult,
} from "../../src/types/reranking.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(body: unknown, status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<RerankCandidate> = {}): RerankCandidate {
  return {
    id: "crystal-aaa",
    content: "Authentication using JWT tokens with RS256 signing",
    retrieval_score: 0.82,
    ...overrides,
  };
}

function makeRerankingMetadata(overrides: Partial<RerankingMetadata> = {}): RerankingMetadata {
  return {
    status: "reranked",
    model: "mxbai-rerank-xsmall-v1",
    latency_ms: 42,
    candidate_pool_size: 3,
    ...overrides,
  };
}

function makeRankedResult(overrides: Partial<RankedSearchResult> = {}): RankedSearchResult {
  return {
    id: "crystal-aaa",
    score: 0.95,
    retrieval_score: 0.82,
    ...overrides,
  };
}

function makeRerankResponse(overrides: Partial<RerankResponse> = {}): RerankResponse {
  return {
    results: [makeRankedResult()],
    reranking: makeRerankingMetadata(),
    ...overrides,
  };
}

function makeSearchResult(): KnowledgeCrystalSearchResult {
  return {
    item: {
      id: "crystal-bbb",
      slug: null,
      nodeType: "pattern",
      title: "JWT Auth Pattern",
      summary: null,
      description: "Standard JWT authentication pattern",
      tags: ["auth", "jwt"],
      contentRef: null,
      contentInline: "Use RS256-signed JWT tokens …",
      embeddingStatus: "synced",
      embeddingUpdatedAt: null,
      confidence: null,
      verified: true,
      visibility: "shared",
      license: null,
      ownerIds: ["user-1"],
      version: 1,
      forkCount: 0,
      starCount: 2,
      itemCount: 0,
      versionCount: 1,
      parentId: null,
      parentVersion: null,
      sourceType: null,
      sourceSessionId: null,
      sourceProject: "auth-service",
      typeMetadata: {},
      path: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    score: 0.88,
  };
}

function makeCrystalSearchWithRerankingResult(): CrystalSearchWithRerankingResult {
  return {
    results: [
      {
        item: makeSearchResult().item,
        score: 0.95,
        retrieval_score: 0.88,
      },
    ],
    reranking: makeRerankingMetadata(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Reranking E2E — CrystalsResource", () => {
  let client: EngramClient;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      retries: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. client.crystals.rerank() — POST /v1/crystals/rerank
  // -------------------------------------------------------------------------
  describe("crystals.rerank()", () => {
    it("POSTs to /v1/crystals/rerank with correct body", async () => {
      const rerankResponse = makeRerankResponse();
      const mockFetch = mockFetchOk({ data: rerankResponse });
      vi.stubGlobal("fetch", mockFetch);

      const request: RerankRequest = {
        query: "authentication patterns",
        candidates: [
          makeCandidate({ id: "crystal-aaa", retrieval_score: 0.82 }),
          makeCandidate({ id: "crystal-bbb", content: "OAuth2 flow with PKCE", retrieval_score: 0.75 }),
        ],
        limit: 1,
      };

      const result = await client.crystals.rerank(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/rerank",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(request),
        })
      );

      // Return type matches RerankResponse
      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe("crystal-aaa");
      expect(result.results[0].score).toBe(0.95);
      expect(result.results[0].retrieval_score).toBe(0.82);
      expect(result.reranking.status).toBe("reranked");
      expect(result.reranking.model).toBe("mxbai-rerank-xsmall-v1");
      expect(result.reranking.latency_ms).toBe(42);
    });

    it("returns typed RerankResponse with budget_usage when context_budget specified", async () => {
      const rerankResponse: RerankResponse = {
        ...makeRerankResponse(),
        budget_usage: {
          tokens_used: 850,
          token_limit: 1000,
          truncated: false,
        },
      };
      vi.stubGlobal("fetch", mockFetchOk({ data: rerankResponse }));

      const result = await client.crystals.rerank({
        query: "authentication patterns",
        candidates: [makeCandidate()],
        reranking: {
          context_budget: { max_tokens: 1000, overflow_strategy: "truncate" },
        },
      });

      expect(result.budget_usage).toBeDefined();
      expect(result.budget_usage?.tokens_used).toBe(850);
      expect(result.budget_usage?.truncated).toBe(false);
    });

    it("returns diagnostics when include_diagnostics is true", async () => {
      const rerankResponse: RerankResponse = {
        results: [
          {
            ...makeRankedResult(),
            diagnostics: {
              raw_score: 0.91,
              retrieval_score: 0.82,
              final_score: 0.95,
              boosts: { tag_boost: 0.03 },
            },
          },
        ],
        reranking: makeRerankingMetadata(),
        diagnostics: {
          total_candidates: 3,
          reranking_latency_ms: 42,
          model_used: "mxbai-rerank-xsmall-v1",
        },
      };
      vi.stubGlobal("fetch", mockFetchOk({ data: rerankResponse }));

      const result = await client.crystals.rerank({
        query: "auth",
        candidates: [makeCandidate()],
        reranking: { include_diagnostics: true },
      });

      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.total_candidates).toBe(3);
      expect(result.results[0].diagnostics?.raw_score).toBe(0.91);
    });
  });

  // -------------------------------------------------------------------------
  // 2. search({ reranking: { enabled: true } }) — inline reranking
  // -------------------------------------------------------------------------
  describe("crystals.search() with reranking enabled", () => {
    it("returns CrystalSearchWithRerankingResult shape when reranking.enabled is true", async () => {
      const withReranking = makeCrystalSearchWithRerankingResult();
      vi.stubGlobal("fetch", mockFetchOk({ data: withReranking }));

      const response = await client.crystals.search({
        query: "authentication patterns",
        limit: 5,
        reranking: { enabled: true, candidate_multiplier: 3 },
      });

      // Narrow to CrystalSearchWithRerankingResult
      const typed = response as CrystalSearchWithRerankingResult;

      expect(typed.results).toHaveLength(1);
      expect(typed.results[0].score).toBe(0.95);
      expect(typed.results[0].retrieval_score).toBe(0.88);
      expect(typed.reranking.status).toBe("reranked");
      expect(typed.reranking.model).toBe("mxbai-rerank-xsmall-v1");
    });

    it("POSTs reranking config to /v1/crystals/search", async () => {
      const withReranking = makeCrystalSearchWithRerankingResult();
      const mockFetch = mockFetchOk({ data: withReranking });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "jwt auth",
        limit: 5,
        reranking: { enabled: true, candidate_multiplier: 4, timeout_ms: 1500 },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "jwt auth",
            limit: 5,
            reranking: { enabled: true, candidate_multiplier: 4, timeout_ms: 1500 },
          }),
        })
      );
    });

    it("returns optional diagnostics field when include_diagnostics is true", async () => {
      const withDiagnostics: CrystalSearchWithRerankingResult = {
        ...makeCrystalSearchWithRerankingResult(),
        diagnostics: {
          total_candidates: 15,
          reranking_latency_ms: 38,
          model_used: "mxbai-rerank-xsmall-v1",
        },
      };
      vi.stubGlobal("fetch", mockFetchOk({ data: withDiagnostics }));

      const response = await client.crystals.search({
        query: "auth",
        reranking: { enabled: true, include_diagnostics: true },
      });

      const typed = response as CrystalSearchWithRerankingResult;
      expect(typed.diagnostics?.total_candidates).toBe(15);
      expect(typed.diagnostics?.model_used).toBe("mxbai-rerank-xsmall-v1");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Kill switch — daemon returns heuristic_fallback
  // -------------------------------------------------------------------------
  describe("kill switch / heuristic fallback", () => {
    it("surfaces heuristic_fallback status when cross-encoder is disabled on the server", async () => {
      const fallbackResponse: CrystalSearchWithRerankingResult = {
        results: [
          {
            item: makeSearchResult().item,
            score: 0.81,
            retrieval_score: 0.81,
          },
        ],
        reranking: {
          status: "heuristic_fallback",
          fallback_reason: "cross_encoder_disabled",
          latency_ms: 2,
        },
      };
      vi.stubGlobal("fetch", mockFetchOk({ data: fallbackResponse }));

      const response = await client.crystals.search({
        query: "auth patterns",
        reranking: { enabled: true },
      });

      const typed = response as CrystalSearchWithRerankingResult;
      expect(typed.reranking.status).toBe("heuristic_fallback");
      expect(typed.reranking.fallback_reason).toBe("cross_encoder_disabled");
      // Results are still present (fallback, not failure)
      expect(typed.results).toHaveLength(1);
      expect(typed.results[0].score).toBe(0.81);
    });

    it("crystals.rerank() surfaces heuristic_fallback from daemon", async () => {
      const fallbackRerankResponse: RerankResponse = {
        results: [makeRankedResult({ score: 0.75 })],
        reranking: {
          status: "heuristic_fallback",
          fallback_reason: "model_load_timeout",
          latency_ms: 5001,
        },
      };
      vi.stubGlobal("fetch", mockFetchOk({ data: fallbackRerankResponse }));

      const result = await client.crystals.rerank({
        query: "auth",
        candidates: [makeCandidate()],
      });

      expect(result.reranking.status).toBe("heuristic_fallback");
      expect(result.reranking.fallback_reason).toBe("model_load_timeout");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Backward compatibility — existing search without reranking
  // -------------------------------------------------------------------------
  describe("backward compatibility — search without reranking", () => {
    it("standard search (no reranking param) returns KnowledgeCrystalSearchResult[]", async () => {
      const results: KnowledgeCrystalSearchResult[] = [
        makeSearchResult(),
        { ...makeSearchResult(), score: 0.72 },
      ];
      vi.stubGlobal("fetch", mockFetchOk({ data: results }));

      const response = await client.crystals.search({ query: "authentication" });

      // Shape is array (not object with .results)
      expect(Array.isArray(response)).toBe(true);
      const typed = response as KnowledgeCrystalSearchResult[];
      expect(typed).toHaveLength(2);
      expect(typed[0].score).toBe(0.88);
      expect(typed[0].item.nodeType).toBe("pattern");
    });

    it("search with reranking explicitly disabled returns standard results", async () => {
      const results: KnowledgeCrystalSearchResult[] = [makeSearchResult()];
      vi.stubGlobal("fetch", mockFetchOk({ data: results }));

      const response = await client.crystals.search({
        query: "authentication",
        reranking: { enabled: false },
      });

      expect(Array.isArray(response)).toBe(true);
      const typed = response as KnowledgeCrystalSearchResult[];
      expect(typed[0].item.id).toBe("crystal-bbb");
    });

    it("search with nodeType filter still works alongside reranking disabled", async () => {
      const results: KnowledgeCrystalSearchResult[] = [makeSearchResult()];
      const mockFetch = mockFetchOk({ data: results });
      vi.stubGlobal("fetch", mockFetch);

      await client.crystals.search({
        query: "auth",
        nodeType: ["pattern", "decision"],
        limit: 10,
        mode: "hybrid",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/crystals/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "auth",
            limit: 10,
            mode: "hybrid",
            node_type: ["pattern", "decision"],
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. Error handling — 400 from daemon
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("throws ValidationFailedError on 400 ZodError response from rerank()", async () => {
      const body = {
        success: false,
        error: {
          name: "ZodError",
          issues: [
            { code: "too_small", message: "candidates must have at least 1 item", path: ["candidates"] },
          ],
        },
      };
      vi.stubGlobal("fetch", mockFetchError(body, 400));

      await expect(
        client.crystals.rerank({
          query: "auth",
          candidates: [],
        })
      ).rejects.toThrow(ValidationFailedError);
    });

    it("ValidationFailedError includes issue details from ZodError", async () => {
      const body = {
        success: false,
        error: {
          name: "ZodError",
          issues: [
            { code: "too_small", message: "candidates must have at least 1 item", path: ["candidates"] },
          ],
        },
      };
      vi.stubGlobal("fetch", mockFetchError(body, 400));

      let caught: ValidationFailedError | undefined;
      try {
        await client.crystals.rerank({ query: "auth", candidates: [] });
      } catch (err) {
        caught = err as ValidationFailedError;
      }

      expect(caught).toBeInstanceOf(ValidationFailedError);
      expect(caught?.issues).toHaveLength(1);
      expect(caught?.issues[0].path).toEqual(["candidates"]);
      expect(caught?.issues[0].message).toBe("candidates must have at least 1 item");
      expect(caught?.statusCode).toBe(400);
    });

    it("throws ValidationFailedError on 400 for search with invalid reranking params", async () => {
      const body = {
        success: false,
        error: {
          name: "ZodError",
          issues: [
            {
              code: "too_big",
              message: "candidate_multiplier must be <= 10",
              path: ["reranking", "candidate_multiplier"],
            },
          ],
        },
      };
      vi.stubGlobal("fetch", mockFetchError(body, 400));

      await expect(
        client.crystals.search({
          query: "auth",
          reranking: { enabled: true, candidate_multiplier: 99 },
        })
      ).rejects.toThrow(ValidationFailedError);
    });

    it("throws EngramError on generic 400 with { code, message } body", async () => {
      const body = { code: "INVALID_REQUEST", message: "query must not be empty" };
      vi.stubGlobal("fetch", mockFetchError(body, 400));

      await expect(
        client.crystals.rerank({ query: "", candidates: [makeCandidate()] })
      ).rejects.toThrow(EngramError);
    });

    it("thrown error carries correct statusCode for 400 response", async () => {
      const body = {
        success: false,
        error: {
          name: "ZodError",
          issues: [{ code: "invalid_type", message: "Expected string", path: ["query"] }],
        },
      };
      vi.stubGlobal("fetch", mockFetchError(body, 400));

      let caught: EngramError | undefined;
      try {
        await client.crystals.rerank({ query: "", candidates: [makeCandidate()] });
      } catch (err) {
        caught = err as EngramError;
      }

      expect(caught?.statusCode).toBe(400);
    });
  });
});
