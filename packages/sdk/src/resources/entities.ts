/**
 * Entities Resource
 *
 * Resource-based SDK interface for entity extraction and the entity graph.
 * Provides access to EntityCard nodes, entity edges, extraction jobs,
 * and extraction configuration/stats.
 */

import { EngramError } from "../errors.js";
import {
  isNumber,
  isString,
  requireArray,
  requireField,
  requireObject,
  unwrapData,
  unwrapDataObject,
} from "../validate.js";
import { BaseResource } from "./base.js";

const RESOURCE = "entities";

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
// Extraction Preview Types (engram-server >= 0.50.0, #1167/#1174)
// ============================================================================

/**
 * One entry of the bootstrap preview's informational `sources` sample —
 * newest-first, capped at 100 entries. `unextractedCount` on the preview is
 * the authoritative total, not this sample's length.
 */
export interface ExtractionUnextractedSource {
  /** Source UUID. */
  id: string;
  /** The type of content the source is. */
  type: "session_note" | "knowledge_crystal";
  /** Display excerpt (note content / crystal title, <= 80 chars). */
  title: string;
}

/**
 * The bootstrap preview — the `data` payload of a
 * `POST /v1/extraction/extract` call with `bootstrap: true` (200, not the 201
 * job envelope). Enumerates the un-extracted sources of a `sourceType` with
 * count + cost estimates; read-only unless `confirm: true`.
 */
export interface ExtractionBootstrapPreview {
  /**
   * FULL count of live sources of `sourceType` with no completed extraction
   * job, updated since `since`. Authoritative — `sources` is only a sample.
   */
  unextractedCount: number;
  /** Projected LLM calls — one per un-extracted source. */
  estimatedCalls: number;
  /** `estimatedCalls` x `estimatedCostPerCall`. */
  estimatedCostUsd: number;
  /**
   * Newest-first informational SAMPLE of the un-extracted set, capped at 100
   * entries — `unextractedCount` is the authoritative total.
   */
  sources: ExtractionUnextractedSource[];
  /**
   * Present ONLY on `confirm: true`: the number of jobs actually enqueued
   * (sources with an already-active job are skipped, so this can be lower than
   * `unextractedCount`). Absent on a read-only preview.
   */
  jobsEnqueued?: number;
}

/**
 * The dry-run projection — the `data` payload of a
 * `POST /v1/extraction/extract` call with `dryRun: true` (200, not the 201 job
 * envelope). Projects entity counts for ONE source from observed history;
 * read-only, no model is run.
 */
export interface ExtractionDryRunPreview {
  /**
   * Projected entity count per class, derived from observed history (per-class
   * total / completed extraction count). Empty when no completed extractions
   * exist yet — an explicit zero-history signal, never a fabricated guess.
   */
  entityCountByClass: Record<string, number>;
  /** Sum of the per-class projections. */
  estimatedEntityCount: number;
  /** One LLM call's projected cost (a dry-run previews one source). */
  estimatedCostUsd: number;
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

/**
 * Parameters for {@link ExtractionResource.bootstrapPreview}.
 *
 * Bootstrap mode enumerates ALL un-extracted sources of `sourceType` — it must
 * NOT carry a `sourceId` (the wire 400s on `bootstrap` + `sourceId`; the SDK
 * rejects it client-side before any request is made).
 */
export interface ExtractionBootstrapPreviewParams {
  /** The type of content to enumerate un-extracted sources of. */
  sourceType: "session_note" | "knowledge_crystal";
  /**
   * When `true`, actually enqueue one extraction job per un-extracted source
   * (the response then carries `jobsEnqueued`). Defaults to `false` — a bare
   * bootstrap call is a safe read-only preview.
   */
  confirm?: boolean;
  /**
   * ISO-8601 lower bound on the source's `updated_at` (timestamp with
   * Z/offset, or a bare date). Server default: 90 days ago.
   */
  since?: string;
  /**
   * Per-LLM-call USD price used for `estimatedCostUsd`. Must be > 0.
   * Server default: 0.002.
   */
  estimatedCostPerCall?: number;
}

/**
 * Parameters for {@link ExtractionResource.dryRunPreview}.
 *
 * Dry-run mode projects entity counts for ONE source — `sourceId` is REQUIRED
 * (the wire 400s without it; the SDK rejects a missing/empty `sourceId`
 * client-side before any request is made).
 */
export interface ExtractionDryRunPreviewParams {
  /** UUID of the single source to project entity counts for. Required. */
  sourceId: string;
  /** The type of content the source is. */
  sourceType: "session_note" | "knowledge_crystal";
  /**
   * Per-LLM-call USD price used for `estimatedCostUsd`. Must be > 0.
   * Server default: 0.002.
   */
  estimatedCostPerCall?: number;
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

/**
 * Client-side check for the preview modes' `estimatedCostPerCall` — the wire
 * schema declares `exclusiveMinimum: 0`, so a zero/negative/non-numeric value
 * is rejected here with a typed error before any request is made. The value
 * must be FINITE, not merely > 0: `JSON.stringify` serializes `Infinity` to
 * `null`, so letting it through would send an invalid request instead of
 * failing client-side. `Number.isFinite` covers non-numbers, NaN, and
 * ±Infinity in one check.
 */
function validateEstimatedCostPerCall(
  method: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new EngramError(
      `extraction.${method}: estimatedCostPerCall must be a finite number ` +
        "> 0 (per-LLM-call USD price; the server defaults it to 0.002 when " +
        "omitted).",
      "VALIDATION_INPUT_INVALID",
    );
  }
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

    const data = requireArray<EntityCard>(
      unwrapData<EntityCard[]>(response, "GET /v1/entities", RESOURCE),
      "GET /v1/entities",
      RESOURCE,
    );
    return {
      data,
      meta: {
        pagination: {
          total: response.meta?.pagination?.total ?? data.length,
          limit: response.meta?.pagination?.limit ?? data.length,
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
    return { data: unwrapData<EntityWithEdges>(response, "GET /v1/entities/{id}", RESOURCE) };
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
    return {
      data: unwrapData<{
        root: EntityCard;
        nodes: EntityCard[];
        edges: Array<{ sourceId: string; targetId: string; edgeType: string; metadata: Record<string, unknown> }>;
        totalNodes: number;
        depth: number;
        truncated: boolean;
      }>(response, "GET /v1/entities/{id}/graph", RESOURCE),
    };
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
    return { data: unwrapData<EntityReviewResult>(response, "POST /v1/entities/{id}/review", RESOURCE) };
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
 * // Preview the un-extracted backlog (engram-server >= 0.50.0)
 * const { data: preview } = await client.extraction.bootstrapPreview({
 *   sourceType: "session_note",
 * });
 * console.log(preview.unextractedCount, preview.estimatedCostUsd);
 *
 * // Project entity counts for one source without running the model
 * const { data: projection } = await client.extraction.dryRunPreview({
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
   * Trigger entity extraction for a source document (single-enqueue mode —
   * the server responds 201 with the created job).
   *
   * The preview mode flags (`bootstrap`, `dryRun`) are rejected here even when
   * smuggled past TypeScript: a preview request returns a 200 preview body,
   * not a 201 job, so serializing them from this method would mistype the
   * response. Use {@link bootstrapPreview} / {@link dryRunPreview} instead —
   * both require engram-server >= 0.50.0.
   *
   * @throws {EngramError} `VALIDATION_INPUT_INVALID` — `bootstrap`/`dryRun`
   *   passed via a TS-bypassing caller (use the dedicated preview methods)
   */
  async extract(params: ExtractParams): Promise<{ data: ExtractionJob }> {
    // Runtime guard for TS-bypassing callers: the preview flags change the
    // response contract (200 preview vs 201 job), so they must not be
    // serialized from the single-enqueue method.
    const smuggled = params as { bootstrap?: unknown; dryRun?: unknown };
    if (smuggled.bootstrap !== undefined || smuggled.dryRun !== undefined) {
      throw new EngramError(
        "extraction.extract: the preview mode flags (bootstrap, dryRun) are " +
          "not valid here — a preview returns a 200 preview body, not a 201 " +
          "job. Use extraction.bootstrapPreview() or " +
          "extraction.dryRunPreview() instead.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    const response = await this.request<ApiSuccessResponse<ExtractionJob>>(
      "POST",
      "/v1/extraction/extract",
      params
    );
    return { data: unwrapData<ExtractionJob>(response, "POST /v1/extraction/extract", "extraction") };
  }

  /**
   * Bootstrap preview — enumerate ALL un-extracted sources of a `sourceType`
   * and return count + cost estimates (`POST /v1/extraction/extract` with
   * `bootstrap: true`; the server responds 200 with the preview, not a 201
   * job). Read-only by default; `confirm: true` actually enqueues one job per
   * un-extracted source and the response then carries `jobsEnqueued`.
   *
   * The wire's semantic prerequisites are enforced client-side before any
   * request is made: bootstrap must NOT carry a `sourceId` (it enumerates all
   * sources), and it is mutually exclusive with `dryRun`.
   *
   * **Server floor:** requires engram-server >= 0.50.0 (the mode flags on
   * `POST /v1/extraction/extract`, engram-server #1167/#1174). WRITE-scoped —
   * the whole extraction surface is write-guarded, previews included.
   *
   * @throws {EngramError} `VALIDATION_INPUT_INVALID` — a `sourceId` or
   *   `dryRun` smuggled into the params, or a non-positive
   *   `estimatedCostPerCall`
   * @throws {ResponseShapeError} on a body missing any of the preview's
   *   contract fields (`unextractedCount`, `estimatedCalls`,
   *   `estimatedCostUsd`, `sources` and its per-entry `id`/`type`/`title`,
   *   or `jobsEnqueued` on a `confirm: true` call)
   */
  async bootstrapPreview(
    params: ExtractionBootstrapPreviewParams
  ): Promise<{ data: ExtractionBootstrapPreview }> {
    const route = "POST /v1/extraction/extract (bootstrap)";
    // Runtime guards for TS-bypassing callers: the wire 400s on
    // bootstrap+sourceId and bootstrap+dryRun — fail client-side with a
    // clear, typed error before any request is made.
    const smuggled = params as { sourceId?: unknown; dryRun?: unknown };
    if (smuggled.sourceId !== undefined) {
      throw new EngramError(
        "extraction.bootstrapPreview: bootstrap enumerates ALL un-extracted " +
          "sources and must not carry a sourceId. Use " +
          "extraction.dryRunPreview({ sourceId, ... }) to preview one source.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    if (smuggled.dryRun !== undefined) {
      throw new EngramError(
        "extraction.bootstrapPreview: bootstrap and dryRun are mutually " +
          "exclusive modes. Use extraction.dryRunPreview() for a single-source " +
          "projection.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    validateEstimatedCostPerCall("bootstrapPreview", params.estimatedCostPerCall);

    // Only serialize the fields the caller supplied; the server defaults
    // `since` to 90 days back and `estimatedCostPerCall` to 0.002.
    const body: Record<string, unknown> = {
      sourceType: params.sourceType,
      bootstrap: true,
    };
    if (params.confirm !== undefined) body.confirm = params.confirm;
    if (params.since !== undefined) body.since = params.since;
    if (params.estimatedCostPerCall !== undefined) {
      body.estimatedCostPerCall = params.estimatedCostPerCall;
    }

    const response = await this.request<
      ApiSuccessResponse<ExtractionBootstrapPreview>
    >("POST", "/v1/extraction/extract", body);

    const data = unwrapDataObject(response, route, "extraction");
    requireField(data, "unextractedCount", isNumber, route, "extraction");
    requireField(data, "estimatedCalls", isNumber, route, "extraction");
    requireField(data, "estimatedCostUsd", isNumber, route, "extraction");
    const sources = requireArray<unknown>(data.sources, route, "extraction");
    // Shape-guard every sample entry — callers read id/type/title directly.
    for (const source of sources) {
      const obj = requireObject(source, route, "extraction");
      requireField(obj, "id", isString, route, "extraction");
      requireField(obj, "type", isString, route, "extraction");
      requireField(obj, "title", isString, route, "extraction");
    }
    // `jobsEnqueued` is part of the contract ONLY on confirm: true (absent on
    // a read-only preview) — require it there, allow number-or-absent otherwise.
    if (params.confirm === true) {
      requireField(data, "jobsEnqueued", isNumber, route, "extraction");
    } else {
      requireField(
        data,
        "jobsEnqueued",
        (v) => v === undefined || isNumber(v),
        route,
        "extraction",
      );
    }
    return { data: data as unknown as ExtractionBootstrapPreview };
  }

  /**
   * Dry-run preview — project entity counts for ONE source from observed
   * extraction history (`POST /v1/extraction/extract` with `dryRun: true`;
   * the server responds 200 with the projection, not a 201 job). Read-only —
   * no job is enqueued and no model is run. An empty `entityCountByClass` is
   * an explicit zero-history signal, never a fabricated guess.
   *
   * The wire's semantic prerequisites are enforced client-side before any
   * request is made: dry-run REQUIRES a `sourceId`, and it is mutually
   * exclusive with `bootstrap`.
   *
   * **Server floor:** requires engram-server >= 0.50.0 (the mode flags on
   * `POST /v1/extraction/extract`, engram-server #1167/#1174). WRITE-scoped —
   * the whole extraction surface is write-guarded, previews included.
   *
   * @throws {EngramError} `VALIDATION_INPUT_INVALID` — a missing/empty
   *   `sourceId`, a `bootstrap` flag smuggled into the params, or a
   *   non-positive `estimatedCostPerCall`
   * @throws {ResponseShapeError} on a body missing any of the projection's
   *   contract fields (`entityCountByClass` with all-numeric values,
   *   `estimatedEntityCount`, `estimatedCostUsd`)
   */
  async dryRunPreview(
    params: ExtractionDryRunPreviewParams
  ): Promise<{ data: ExtractionDryRunPreview }> {
    const route = "POST /v1/extraction/extract (dryRun)";
    // Runtime guards for TS-bypassing callers: the wire 400s on a missing
    // sourceId and on bootstrap+dryRun — fail client-side with a clear,
    // typed error before any request is made.
    if (typeof params.sourceId !== "string" || params.sourceId.length === 0) {
      throw new EngramError(
        "extraction.dryRunPreview: dryRun projects entity counts for ONE " +
          "source — sourceId is required. Use extraction.bootstrapPreview() " +
          "to enumerate all un-extracted sources.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    const smuggled = params as { bootstrap?: unknown };
    if (smuggled.bootstrap !== undefined) {
      throw new EngramError(
        "extraction.dryRunPreview: bootstrap and dryRun are mutually " +
          "exclusive modes. Use extraction.bootstrapPreview() to enumerate " +
          "all un-extracted sources.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    validateEstimatedCostPerCall("dryRunPreview", params.estimatedCostPerCall);

    const body: Record<string, unknown> = {
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      dryRun: true,
    };
    if (params.estimatedCostPerCall !== undefined) {
      body.estimatedCostPerCall = params.estimatedCostPerCall;
    }

    const response = await this.request<
      ApiSuccessResponse<ExtractionDryRunPreview>
    >("POST", "/v1/extraction/extract", body);

    const data = unwrapDataObject(response, route, "extraction");
    // Shape-guard the nested per-class projection map before casting: it must
    // be a plain object with all-numeric values (empty = explicit zero-history).
    const byClass = requireObject(data.entityCountByClass, route, "extraction");
    for (const key of Object.keys(byClass)) {
      requireField(byClass, key, isNumber, route, "extraction");
    }
    requireField(data, "estimatedEntityCount", isNumber, route, "extraction");
    requireField(data, "estimatedCostUsd", isNumber, route, "extraction");
    return { data: data as unknown as ExtractionDryRunPreview };
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
    return {
      data: requireArray<ExtractionJob>(
        unwrapData<ExtractionJob[]>(response, "GET /v1/extraction/jobs", "extraction"),
        "GET /v1/extraction/jobs",
        "extraction",
      ),
    };
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
    return { data: unwrapData<ExtractionConfig>(response, "PATCH /v1/extraction/config", "extraction") };
  }

  /**
   * Get extraction statistics (job counts, entity counts by class, etc.).
   */
  async getStats(): Promise<{ data: ExtractionStats }> {
    const response = await this.request<ApiSuccessResponse<ExtractionStats>>(
      "GET",
      "/v1/extraction/stats"
    );
    return { data: unwrapData<ExtractionStats>(response, "GET /v1/extraction/stats", "extraction") };
  }
}
