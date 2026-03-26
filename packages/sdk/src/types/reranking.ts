/**
 * Reranking Types
 *
 * Types for the post-retrieval reranking API (ADR-retrieval-reranking).
 * Reranking improves precision by re-scoring retrieved candidates using
 * a cross-encoder model or heuristic scoring.
 */

// ============================================================================
// Reranking Configuration
// ============================================================================

/**
 * Reranking strategy to use.
 * - `cross_encoder`: Use the mxbai-rerank-xsmall-v1 ONNX model (default when available)
 * - `heuristic`: Use heuristic scoring (always available, used as fallback)
 */
export type RerankingStrategy = "cross_encoder" | "heuristic";

/**
 * Reranking configuration passed per-request.
 * All fields are optional; omitting `enabled` defers to global config.
 */
export interface RerankingConfig {
  /** Enable or disable reranking for this request. Overrides global config when set. */
  enabled?: boolean;
  /** Strategy to use (default: cross_encoder with heuristic fallback) */
  strategy?: RerankingStrategy;
  /**
   * Candidate pool multiplier. When reranking is enabled, the search fetches
   * `limit * candidate_multiplier` candidates before reranking down to `limit`.
   * Range: 1–10. Default: 3.
   */
  candidate_multiplier?: number;
  /** Timeout in milliseconds for the reranking call. Range: 50–5000. Default: 2000. */
  timeout_ms?: number;
  /** Include per-result diagnostic info in the response */
  include_diagnostics?: boolean;
  /** Context budget constraints */
  context_budget?: RerankingContextBudget;
  /** Score boosts for specific content attributes */
  boosts?: RerankingBoosts;
}

/**
 * Context budget constraints for reranking.
 */
export interface RerankingContextBudget {
  /** Maximum number of tokens to include in reranked output */
  max_tokens?: number;
  /** Strategy when budget is exceeded: "truncate" | "drop" | "none" */
  overflow_strategy?: "truncate" | "drop" | "none";
}

/**
 * Score boosts applied to reranked results.
 */
export interface RerankingBoosts {
  /** Boost score for results with specific tags */
  tags?: Record<string, number>;
  /** Boost score for results newer than N days */
  recency_days?: number;
  /** Recency boost multiplier (0.0–1.0) */
  recency_boost?: number;
}

// ============================================================================
// Rerank Request (POST /v1/crystals/rerank)
// ============================================================================

/**
 * A pre-fetched candidate for reranking.
 */
export interface RerankCandidate {
  /** Crystal node ID */
  id: string;
  /** Text content to score against the query */
  content: string;
  /** Original retrieval score (e.g. vector similarity) */
  retrieval_score: number;
  /** ISO 8601 creation timestamp (used for recency boosts) */
  created_at?: string;
  /** Tags (used for tag boosts) */
  tags?: string[];
}

/**
 * Request body for `POST /v1/crystals/rerank`.
 * Accepts pre-fetched candidates (e.g. from a prior search or external source).
 */
export interface RerankRequest {
  /** The search query to score candidates against */
  query: string;
  /** Pre-fetched candidates to rerank */
  candidates: RerankCandidate[];
  /** Maximum results to return after reranking */
  limit?: number;
  /** Reranking configuration */
  reranking?: Omit<RerankingConfig, "enabled">;
}

// ============================================================================
// Rerank Response
// ============================================================================

/**
 * Reranking metadata returned with a reranked response.
 */
export interface RerankingMetadata {
  /** Final reranking status */
  status: "reranked" | "heuristic_fallback" | "skipped";
  /** Reason for heuristic fallback, if applicable */
  fallback_reason?: string;
  /** Model name used for reranking */
  model?: string;
  /** Reranking latency in milliseconds */
  latency_ms?: number;
  /** Number of candidates evaluated before selecting top-N */
  candidate_pool_size?: number;
}

/**
 * Context budget usage reported in the response.
 */
export interface RerankingBudgetUsage {
  /** Tokens used */
  tokens_used: number;
  /** Token limit */
  token_limit: number;
  /** Whether any results were dropped due to budget overflow */
  truncated: boolean;
}

/**
 * Per-result diagnostic information (present when `include_diagnostics: true`).
 */
export interface DiagnosticRerankInfo {
  /** Raw cross-encoder score before normalization */
  raw_score?: number;
  /** Retrieval score from the original vector search */
  retrieval_score: number;
  /** Final combined score */
  final_score: number;
  /** Applied boost breakdown */
  boosts?: {
    tag_boost?: number;
    recency_boost?: number;
  };
}

/**
 * A single reranked search result.
 */
export interface RankedSearchResult {
  /** Crystal node ID */
  id: string;
  /** Final reranked score */
  score: number;
  /** Original retrieval score before reranking */
  retrieval_score: number;
  /** Per-result diagnostics (present when `include_diagnostics: true`) */
  diagnostics?: DiagnosticRerankInfo;
}

/**
 * Response from `POST /v1/crystals/rerank`.
 */
export interface RerankResponse {
  /** Reranked results in descending score order */
  results: RankedSearchResult[];
  /** Reranking operation metadata */
  reranking: RerankingMetadata;
  /** Context budget usage (present when `context_budget` was specified) */
  budget_usage?: RerankingBudgetUsage;
  /** Aggregate diagnostics (present when `include_diagnostics: true`) */
  diagnostics?: {
    total_candidates: number;
    reranking_latency_ms: number;
    model_used?: string;
  };
}
