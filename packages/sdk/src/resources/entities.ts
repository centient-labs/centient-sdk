/**
 * Entities Resource
 *
 * Resource-based SDK interface for entity extraction and the entity graph.
 * Provides access to EntityCard nodes, entity edges, extraction jobs,
 * and extraction configuration/stats.
 */

import { BaseResource } from "./base.js";

// ============================================================================
// Enums
// ============================================================================

export enum EntityClass {
  PERSON = "person",
  PROJECT = "project",
  SYSTEM = "system",
  CONCEPT = "concept",
  TECHNOLOGY = "technology",
  ORGANIZATION = "organization",
}

export enum EntityReviewAction {
  APPROVE_MERGE = "approve_merge",
  CREATE_NEW = "create_new",
  DISMISS = "dismiss",
}

export enum ExtractionJobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
}

// ============================================================================
// Entity Types
// ============================================================================

export interface EntityCard {
  id: string;
  /** Stored as title in knowledge_crystals */
  canonicalName: string;
  entityClass: EntityClass;
  confidence: number;
  mentionCount: number;
  verified: boolean;
  autoConstructed: boolean;
  corroboratingSources?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EntityEdge {
  sourceId: string;
  targetId: string;
  edgeType: string;
  metadata?: Record<string, unknown>;
}

export interface EntityWithEdges extends EntityCard {
  edges: EntityEdge[];
}

export interface EntityMention {
  text: string;
  entityClass: EntityClass;
  confidence: number;
  charStart: number;
  charEnd: number;
}

export interface EntityRelationship {
  sourceText: string;
  targetText: string;
  relationshipType: string;
  confidence: number;
}

export interface EntityReviewResult {
  reviewId: string;
  action: EntityReviewAction;
  resolvedEntityId?: string;
  status: string;
}

// ============================================================================
// Extraction Types
// ============================================================================

export interface ExtractionJob {
  id: string;
  sourceId: string;
  sourceType: "session_note" | "knowledge_crystal";
  status: ExtractionJobStatus;
  contentHash: string;
  attemptCount: number;
  lastError: string | null;
  retryAfter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionStats {
  jobs: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    skipped: number;
  };
  dailyApiCallUsage: number;
  averageConfidence: number;
  entityCountsByClass: Array<{
    class: string;
    total: number;
    verified: number;
    unverified: number;
    averageConfidence: number;
  }>;
  totalEntities: number;
  totalVerified: number;
  generatedAt: string;
}

export interface ExtractionConfig {
  threshold?: number;
  dailyCap?: number;
}

// ============================================================================
// Param Types
// ============================================================================

export interface ListEntitiesParams {
  class?: EntityClass;
  verified?: boolean;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export interface ExtractParams {
  sourceId: string;
  sourceType: "session_note" | "knowledge_crystal";
  rescan?: boolean;
}

// ============================================================================
// API Response Types (internal)
// ============================================================================

interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
}

// ============================================================================
// Entities Resource
// ============================================================================

/**
 * Entities Resource — manages entity cards and the entity graph.
 *
 * @example
 * ```typescript
 * // List all person entities with at least 80% confidence
 * const { data } = await client.entities.list({
 *   class: EntityClass.PERSON,
 *   minConfidence: 0.8,
 * });
 *
 * // Get a single entity with its edges
 * const { data: entity } = await client.entities.get("entity-id");
 *
 * // Approve a merge of two entities
 * const { data: result } = await client.entities.review("entity-id", {
 *   action: EntityReviewAction.APPROVE_MERGE,
 *   targetEntityId: "other-entity-id",
 * });
 * ```
 */
export class EntitiesResource extends BaseResource {
  /**
   * List entity cards with optional filters.
   */
  async list(params?: ListEntitiesParams): Promise<{
    data: EntityCard[];
    meta: {
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    };
  }> {
    const query = new URLSearchParams();

    if (params?.class !== undefined) {
      query.set("class", params.class);
    }
    if (params?.verified !== undefined) {
      query.set("verified", String(params.verified));
    }
    if (params?.minConfidence !== undefined) {
      query.set("min_confidence", String(params.minConfidence));
    }
    if (params?.limit !== undefined) {
      query.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/entities${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<EntityCard[]>>(
      "GET",
      path
    );

    return {
      data: response.data,
      meta: {
        pagination: {
          total: response.meta?.pagination?.total ?? response.data.length,
          limit: response.meta?.pagination?.limit ?? response.data.length,
          offset: response.meta?.pagination?.offset ?? 0,
          hasMore: response.meta?.pagination?.hasMore ?? false,
        },
      },
    };
  }

  /**
   * Get a single entity card with its edges.
   */
  async get(id: string): Promise<{ data: EntityWithEdges }> {
    const response = await this.request<ApiSuccessResponse<EntityWithEdges>>(
      "GET",
      `/v1/entities/${encodeURIComponent(id)}`
    );
    return { data: response.data };
  }

  /**
   * Multi-hop graph traversal from an entity node.
   */
  async graph(
    id: string,
    params?: { depth?: number; filterClass?: string; filterVerified?: boolean; minConfidence?: number }
  ): Promise<{
    data: {
      root: EntityCard;
      nodes: EntityCard[];
      edges: Array<{ sourceId: string; targetId: string; edgeType: string; metadata: Record<string, unknown> }>;
      totalNodes: number;
      depth: number;
      truncated: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.depth !== undefined) query.set("depth", String(params.depth));
    if (params?.filterClass) query.set("filter_class", params.filterClass);
    if (params?.filterVerified !== undefined) query.set("filter_verified", String(params.filterVerified));
    if (params?.minConfidence !== undefined) query.set("min_confidence", String(params.minConfidence));
    const qs = query.toString();
    const response = await this.request<ApiSuccessResponse<{
      root: EntityCard;
      nodes: EntityCard[];
      edges: Array<{ sourceId: string; targetId: string; edgeType: string; metadata: Record<string, unknown> }>;
      totalNodes: number;
      depth: number;
      truncated: boolean;
    }>>(
      "GET",
      `/v1/entities/${encodeURIComponent(id)}/graph${qs ? `?${qs}` : ""}`
    );
    return { data: response.data };
  }

  /**
   * Submit a review action for an entity (merge, create new, or dismiss).
   */
  async review(
    id: string,
    params: { action: EntityReviewAction; targetEntityId?: string }
  ): Promise<{ data: EntityReviewResult }> {
    const response = await this.request<ApiSuccessResponse<EntityReviewResult>>(
      "POST",
      `/v1/entities/${encodeURIComponent(id)}/review`,
      params
    );
    return { data: response.data };
  }
}

// ============================================================================
// Extraction Resource
// ============================================================================

/**
 * Extraction Resource — manages entity extraction jobs, config, and stats.
 *
 * @example
 * ```typescript
 * // Trigger extraction for a session note
 * const { data: job } = await client.extraction.extract({
 *   sourceId: "note-id",
 *   sourceType: "session_note",
 * });
 *
 * // List all failed jobs
 * const { data: jobs } = await client.extraction.listJobs({
 *   status: ExtractionJobStatus.FAILED,
 * });
 *
 * // Update extraction thresholds
 * await client.extraction.updateConfig({ threshold: 0.75, dailyCap: 500 });
 *
 * // Fetch extraction stats
 * const { data: stats } = await client.extraction.getStats();
 * ```
 */
export class ExtractionResource extends BaseResource {
  /**
   * Trigger entity extraction for a source document.
   */
  async extract(params: ExtractParams): Promise<{ data: ExtractionJob }> {
    const response = await this.request<ApiSuccessResponse<ExtractionJob>>(
      "POST",
      "/v1/extraction/extract",
      params
    );
    return { data: response.data };
  }

  /**
   * List extraction jobs with optional status filter.
   */
  async listJobs(params?: {
    status?: ExtractionJobStatus;
  }): Promise<{ data: ExtractionJob[] }> {
    const query = new URLSearchParams();

    if (params?.status !== undefined) {
      query.set("status", params.status);
    }

    const queryString = query.toString();
    const path = `/v1/extraction/jobs${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<ExtractionJob[]>>(
      "GET",
      path
    );
    return { data: response.data };
  }

  /**
   * Update extraction configuration (confidence threshold, daily API cap).
   */
  async updateConfig(
    config: ExtractionConfig
  ): Promise<{ data: ExtractionConfig }> {
    const response = await this.request<ApiSuccessResponse<ExtractionConfig>>(
      "PATCH",
      "/v1/extraction/config",
      config
    );
    return { data: response.data };
  }

  /**
   * Get extraction statistics (job counts, entity counts by class, etc.).
   */
  async getStats(): Promise<{ data: ExtractionStats }> {
    const response = await this.request<ApiSuccessResponse<ExtractionStats>>(
      "GET",
      "/v1/extraction/stats"
    );
    return { data: response.data };
  }
}
