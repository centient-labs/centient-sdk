/**
 * Crystals Resource
 *
 * Resource-based SDK interface for unified knowledge crystal node management.
 * Replaces the dual Crystal/KnowledgeItem model with a single KnowledgeCrystal
 * node type (ADR-055, ADR-057 Phase C).
 */

import type { EngramClient } from "../client.js";
import { EngramError } from "../errors.js";
import {
  unwrapData,
  requireArray,
  assertArray,
  requireObject,
  requireField,
  isString,
  isNumber,
  isNullableString,
} from "../validate.js";
import { BaseResource } from "./base.js";
import type {
  KnowledgeCrystal,
  TrashedCrystal,
  KnowledgeCrystalSearchResult,
  CrystalSearchWithRerankingResult,
  CreateKnowledgeCrystalParams,
  UpdateKnowledgeCrystalParams,
  ListKnowledgeCrystalsParams,
  SearchKnowledgeCrystalsParams,
  CrystalItem,
  CrystalVersion,
  AddCrystalItemParams,
  ListCrystalItemsParams,
  CreateCrystalVersionParams,
  ListCrystalVersionsParams,
  ContainedCrystal,
  ParentCrystal,
  CrystalHierarchy,
  AddChildCrystalParams,
  ListHierarchyParams,
  ScopedSearchParams,
  ScopedSearchResult,
} from "../types/knowledge-crystal.js";
import type { KnowledgeCrystalEdge } from "../types/knowledge-crystal-edge.js";
import type { RerankRequest, RerankResponse } from "../types/reranking.js";

const RESOURCE = "crystals";

// ============================================================================
// API Response Types
// ============================================================================

interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total: number;
      limit: number;
      offset?: number;
      /**
       * Opaque keyset cursor for the NEXT page (engram-server #925). Present
       * iff more rows exist; absent on the terminal page, in offset mode, and
       * on servers below 0.45.0.
       */
      cursor?: string;
      hasMore: boolean;
    };
  };
}

// ============================================================================
// Incremental listing (engram-server ADR-040 / #995 — server >= 0.45.0)
// ============================================================================

/**
 * ISO-8601 instant carrying an explicit timezone designator (`Z` or `±HH:MM`),
 * with the calendar/clock fields captured for the round-trip check below.
 *
 * Shape only — this says nothing about whether the fields name a real instant.
 * `2026-99-99T99:99:99Z` matches. {@link serializeWatermark} does the rest.
 *
 * Mirrors the server's `z.string().datetime({ offset: true })` watermark
 * schema: a zone-less timestamp is a 400 there ("a watermark must not change
 * meaning with the server's timezone").
 */
const ISO_INSTANT_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Validate an ADR-040 watermark client-side and return the wire string.
 *
 * Two layers, because the shape check alone is not validation: the regex
 * accepts `2026-99-99T99:99:99Z`, and a bare `new Date(value)` accepts it too
 * — `Date` is lenient and *rolls over*, so `2026-02-30T00:00:00Z` silently
 * becomes March 2 rather than failing. Either one on its own would hand the
 * server a bad watermark and surface its opaque 400, which is exactly the
 * outcome validating here exists to prevent.
 *
 * So: match the shape, then round-trip the parsed instant back to the captured
 * fields. Any rollover changes at least one field (month 13 → month 1 of the
 * next year; Feb 30 → Mar 2; hour 25 → hour 1 of the next day), so comparing
 * every field catches every impossible value.
 *
 * The wall-clock fields are checked independently of the UTC offset — the
 * offset shifts which instant the clock reading names, not whether the reading
 * is a real one — and the offset's own range is checked separately.
 *
 * @param field - the caller-facing param name, for the error message
 * @param value - the caller's value (typed `string`, but plain-JS callers lie)
 */
function serializeWatermark(field: string, value: unknown): string {
  const reject = (why: string): never => {
    throw new EngramError(
      `crystals.list: ${field} must be a real ISO-8601 instant with a timezone ` +
        "designator (e.g. \"2026-07-23T10:00:00.000Z\" — " +
        `\`new Date().toISOString()\`) — ${why}. Zone-less timestamps are ` +
        "rejected by the server (engram ADR-040): a watermark must not change " +
        "meaning with the server's timezone.",
      "VALIDATION_INPUT_INVALID",
    );
  };

  if (typeof value !== "string") {
    return reject(`got ${value === null ? "null" : typeof value}`);
  }
  const match = ISO_INSTANT_WITH_OFFSET.exec(value);
  if (!match) {
    return reject("it is not shaped like one, or carries no timezone");
  }

  // Groups 1-6 are mandatory in both alternatives, so they are always present
  // once the pattern matched; the offset groups (7-9) are present together or
  // not at all (the `Z` form captures none).
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Undo `Date`'s legacy 0-99 → 1900-1999 year mapping, so a four-digit year
  // below 0100 round-trips instead of being rejected as a rollover. A genuine
  // rollover always disturbs month/day/hour/minute/second too, so restoring
  // the year here cannot mask one.
  parsed.setUTCFullYear(year);

  if (Number.isNaN(parsed.getTime())) {
    return reject("it does not parse as a date");
  }
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    // The parsed instant is not the one the caller wrote — the fields rolled
    // over, so at least one of them was out of range (month 13, Feb 30, 25:00).
    return reject(`"${value}" is not a real calendar date and time`);
  }

  // The `Z` form captures no offset groups; the `±HH:MM` form captures all
  // three. Range-check the offset so `+99:99` cannot ride along on the shape
  // match. 23:59 rather than the real-world ±14:00 maximum — the point is to
  // reject impossible values, not to adjudicate which zones exist.
  const offsetHour = match[8];
  const offsetMinute = match[9];
  if (offsetHour !== undefined && offsetMinute !== undefined) {
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
      return reject(`"${match[7]}${offsetHour}:${offsetMinute}" is not a real UTC offset`);
    }
  }

  return value;
}

// ============================================================================
// Dedup Merge Types (P11 deferred-merge review lifecycle)
// ============================================================================

/** How a duplicate was detected/merged. */
export type DedupMergeMethod = "semantic" | "exact" | "manual";

/** Which side survives a merge. */
export type DedupMergeOutcomeStrategy = "oldest_wins" | "user_selected";

/**
 * A deferred merge candidate awaiting review (from
 * {@link CrystalsResource.pendingMerges}).
 */
export interface PendingMerge {
  mergeId: string;
  sourceId: string;
  targetId: string;
  sourceType: "session_note" | "knowledge_crystal";
  targetType: "knowledge_crystal";
  confidence: number;
  mergeMethod: DedupMergeMethod;
  mergeOutcomeStrategy: DedupMergeOutcomeStrategy;
  createdAt: string;
}

/** Filters for {@link CrystalsResource.pendingMerges}. */
export interface ListPendingMergesParams {
  /** Restrict to merges originating from a single session. */
  sessionId?: string;
  /** Max rows to return (server default 20, capped at 100). */
  limit?: number;
}

/**
 * A single record in a merge provenance chain (from
 * {@link CrystalsResource.mergeHistory}). Server `Date` fields are serialized
 * to ISO-8601 strings over the wire.
 */
export interface MergeRecord {
  id: string;
  sourceNoteId: string | null;
  sourceCrystalId: string | null;
  targetCrystalId: string;
  mergeMethod: DedupMergeMethod;
  mergeOutcomeStrategy: DedupMergeOutcomeStrategy;
  similarityScore: number | null;
  mergeReason: string;
  mergedContentSnapshot: Record<string, unknown>;
  mergedBy: string;
  mergedAt: string;
  reversible: boolean;
  reverseRecordId: string | null;
  createdAt: string;
}

/** Decision passed to {@link CrystalsResource.reviewMerge}. */
export type MergeReviewDecision = "approve" | "reject" | "modify";

/** Params for {@link CrystalsResource.reviewMerge}. */
export interface ReviewMergeParams {
  decision: MergeReviewDecision;
  /** Required when `decision` is `"modify"` — the resolved merged content. */
  mergedContent?: string;
}

/** Result of {@link CrystalsResource.reviewMerge}. */
export interface ReviewMergeResult {
  decision: MergeReviewDecision;
  /** The surviving crystal id (present on approve/modify). */
  targetCrystalId?: string;
}

// ============================================================================
// Crystal Items Resource (Sub-resource)
// ============================================================================

/**
 * Crystal Items Resource - manages items within a specific crystal node
 */
export class CrystalItemsResource extends BaseResource {
  constructor(
    client: EngramClient,
    private crystalId: string
  ) {
    super(client);
  }

  /**
   * Add an item to the crystal
   */
  async add(params: AddCrystalItemParams): Promise<{ added: boolean }> {
    const response = await this.request<ApiSuccessResponse<{ added: boolean }>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/items`,
      params
    );
    return unwrapData(response, `POST /v1/crystals/${encodeURIComponent(this.crystalId)}/items`, RESOURCE);
  }

  /**
   * List items in the crystal
   */
  async list(params?: ListCrystalItemsParams): Promise<{
    items: CrystalItem[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.offset) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/crystals/${encodeURIComponent(this.crystalId)}/items${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<CrystalItem[]>>(
      "GET",
      path
    );

    const data = requireArray<CrystalItem>(
      unwrapData(response, `GET ${path}`, RESOURCE),
      `GET ${path}`,
      RESOURCE,
    );
    return {
      items: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Remove an item from the crystal
   */
  async remove(itemId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/items/${encodeURIComponent(itemId)}`
    );
  }

  /**
   * Bulk add items to the crystal
   */
  async bulkAdd(items: Array<{ itemId: string; position?: number }>): Promise<{ added: number }> {
    const response = await this.request<ApiSuccessResponse<{ added: number }>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/items/bulk`,
      { items }
    );
    return unwrapData(response, `POST /v1/crystals/${encodeURIComponent(this.crystalId)}/items/bulk`, RESOURCE);
  }

  /**
   * Reorder items in the crystal
   */
  async reorder(itemIds: string[]): Promise<void> {
    await this.request<ApiSuccessResponse<void>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/items/reorder`,
      { itemIds }
    );
  }
}

// ============================================================================
// Crystal Versions Resource (Sub-resource)
// ============================================================================

/**
 * Crystal Versions Resource - manages version history for a specific crystal node
 */
export class CrystalVersionsResource extends BaseResource {
  constructor(
    client: EngramClient,
    private crystalId: string
  ) {
    super(client);
  }

  /**
   * List versions of the crystal
   */
  async list(params?: ListCrystalVersionsParams): Promise<{
    versions: CrystalVersion[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.offset) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/crystals/${encodeURIComponent(this.crystalId)}/versions${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<CrystalVersion[]>>(
      "GET",
      path
    );

    const data = requireArray<CrystalVersion>(
      unwrapData(response, `GET ${path}`, RESOURCE),
      `GET ${path}`,
      RESOURCE,
    );
    return {
      versions: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get a specific version of the crystal
   */
  async get(version: number): Promise<CrystalVersion> {
    const response = await this.request<ApiSuccessResponse<CrystalVersion>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/versions/${version}`
    );
    return unwrapData(response, `GET /v1/crystals/${encodeURIComponent(this.crystalId)}/versions/${version}`, RESOURCE);
  }

  /**
   * Create a new version of the crystal (snapshot current state)
   */
  async create(params: CreateCrystalVersionParams): Promise<CrystalVersion> {
    const response = await this.request<ApiSuccessResponse<CrystalVersion>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/versions`,
      params
    );
    return unwrapData(response, `POST /v1/crystals/${encodeURIComponent(this.crystalId)}/versions`, RESOURCE);
  }
}

// ============================================================================
// Crystal Hierarchy Resource (Sub-resource) (ADR-031)
// ============================================================================

/**
 * Crystal Hierarchy Resource - manages containment relationships for a crystal node
 */
export class CrystalHierarchyResource extends BaseResource {
  constructor(
    client: EngramClient,
    private crystalId: string
  ) {
    super(client);
  }

  /**
   * Add a child crystal (creates a 'contains' edge)
   *
   * @throws {EngramError} with code VALID_CYCLE_DETECTED if adding the child
   *         would create a cycle in the containment hierarchy.
   */
  async addChild(params: AddChildCrystalParams): Promise<KnowledgeCrystalEdge> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/children`,
      params
    );
    return unwrapData(response, `POST /v1/crystals/${encodeURIComponent(this.crystalId)}/children`, RESOURCE);
  }

  /**
   * Remove a child crystal (soft-deletes the 'contains' edge)
   */
  async removeChild(childId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/children/${encodeURIComponent(childId)}`
    );
  }

  /**
   * Get children of this crystal
   */
  async getChildren(params?: ListHierarchyParams): Promise<{
    children: KnowledgeCrystal[] | ContainedCrystal[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.recursive) {
      query.set("recursive", "true");
    }
    if (params?.maxDepth) {
      query.set("maxDepth", String(params.maxDepth));
    }

    const queryString = query.toString();
    const path = `/v1/crystals/${encodeURIComponent(this.crystalId)}/children${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal[] | ContainedCrystal[]>>(
      "GET",
      path
    );

    // The payload is a polymorphic union (`KnowledgeCrystal[] | ContainedCrystal[]`)
    // whose element shape depends on `recursive`/`maxDepth`. We validate the
    // envelope + array-ness at the HTTP edge (P6) and stop there: element-level
    // shape checks would require discriminating two crystal variants for no real
    // safety gain, and a widened `(A|B)[]` from requireArray would not satisfy the
    // declared union type. assertArray asserts array-ness without widening.
    const data = unwrapData<KnowledgeCrystal[] | ContainedCrystal[]>(response, `GET ${path}`, RESOURCE);
    assertArray(data, `GET ${path}`, RESOURCE);
    return {
      children: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get parents of this crystal
   */
  async getParents(params?: ListHierarchyParams): Promise<{
    parents: KnowledgeCrystal[] | ParentCrystal[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();

    if (params?.recursive) {
      query.set("recursive", "true");
    }
    if (params?.maxDepth) {
      query.set("maxDepth", String(params.maxDepth));
    }

    const queryString = query.toString();
    const path = `/v1/crystals/${encodeURIComponent(this.crystalId)}/parents${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal[] | ParentCrystal[]>>(
      "GET",
      path
    );
    // Polymorphic union (`KnowledgeCrystal[] | ParentCrystal[]`) — see getChildren
    // for why we assert array-ness only and do not deep-validate elements here.
    const data = unwrapData<KnowledgeCrystal[] | ParentCrystal[]>(response, `GET ${path}`, RESOURCE);
    assertArray(data, `GET ${path}`, RESOURCE);
    return {
      parents: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get the full hierarchy tree rooted at this crystal
   */
  async getHierarchy(params?: { maxDepth?: number }): Promise<CrystalHierarchy> {
    const query = new URLSearchParams();

    if (params?.maxDepth) {
      query.set("maxDepth", String(params.maxDepth));
    }

    const queryString = query.toString();
    const path = `/v1/crystals/${encodeURIComponent(this.crystalId)}/hierarchy${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<CrystalHierarchy>>(
      "GET",
      path
    );
    return unwrapData(response, `GET ${path}`, RESOURCE);
  }

  /**
   * Get the scope of this crystal (itself + all contained crystal IDs)
   */
  async getCrystalScope(): Promise<string[]> {
    const response = await this.request<ApiSuccessResponse<string[]>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/scope/items`
    );
    return unwrapData(response, `GET /v1/crystals/${encodeURIComponent(this.crystalId)}/scope/items`, RESOURCE);
  }

  /**
   * Search within this crystal's scope (itself + all contained crystals).
   *
   * @example
   * ```typescript
   * // Keyword search scoped to a crystal hierarchy
   * const results = await client.crystals.hierarchy("project-id").searchInScope({
   *   query: "dependency injection",
   *   mode: "keyword",
   * });
   * console.log(results[0].similarity); // relevance score
   * ```
   */
  async searchInScope(params: ScopedSearchParams): Promise<ScopedSearchResult[]> {
    const response = await this.request<ApiSuccessResponse<ScopedSearchResult[]>>(
      "POST",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/scope/search`,
      params
    );
    return unwrapData(response, `POST /v1/crystals/${encodeURIComponent(this.crystalId)}/scope/search`, RESOURCE);
  }
}

// ============================================================================
// Crystals Resource
// ============================================================================

/**
 * Crystals Resource - manages unified knowledge crystal nodes.
 *
 * The primary SDK resource for all node types after the unified knowledge
 * crystal model (ADR-055). Both content nodes (pattern, learning, decision,
 * note, finding, constraint) and container nodes (collection, session_artifact,
 * project, domain, file_ref, directory) are managed here via the `nodeType`
 * field.
 *
 * @example
 * ```typescript
 * // Create a content node
 * const pattern = await client.crystals.create({
 *   nodeType: "pattern",
 *   title: "Repository Pattern",
 *   contentInline: "...",
 * });
 *
 * // Create a container node
 * const collection = await client.crystals.create({
 *   nodeType: "collection",
 *   title: "Auth Patterns",
 * });
 *
 * // List only pattern nodes
 * const { crystals } = await client.crystals.list({ nodeType: "pattern" });
 *
 * // Search with nodeType filter
 * const results = await client.crystals.search({
 *   query: "authentication",
 *   nodeType: ["pattern", "decision"],
 * });
 * ```
 */
export class CrystalsResource extends BaseResource {
  /**
   * Create a new knowledge crystal node
   */
  async create(params: CreateKnowledgeCrystalParams): Promise<KnowledgeCrystal> {
    // ADR-018: JSON bodies are camelCase — no field remapping needed
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal>>(
      "POST",
      "/v1/crystals",
      params
    );
    return unwrapData(response, "POST /v1/crystals", RESOURCE);
  }

  /**
   * Get a knowledge crystal node by ID
   */
  async get(id: string): Promise<KnowledgeCrystal> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(id)}`
    );
    return unwrapData(response, `GET /v1/crystals/${encodeURIComponent(id)}`, RESOURCE);
  }

  /**
   * Get edges connected to a crystal node (graph neighbours).
   *
   * Returns all relationships where the node is either the source or target,
   * flattened into a single list. The current implementation returns graph
   * edges (incoming + outgoing), not embedding-similar nodes.
   */
  async related(id: string): Promise<{
    edges: KnowledgeCrystalEdge[];
    total: number;
    hasMore: boolean;
  }> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystalEdge[]>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(id)}/related`
    );
    const data = requireArray<KnowledgeCrystalEdge>(
      unwrapData(response, `GET /v1/crystals/${encodeURIComponent(id)}/related`, RESOURCE),
      `GET /v1/crystals/${encodeURIComponent(id)}/related`,
      RESOURCE,
    );
    return {
      edges: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * List knowledge crystal nodes with optional filters.
   *
   * Use `nodeType` to filter by one or more node types (e.g. `"pattern"`,
   * `["pattern", "decision"]`).
   *
   * Tag filtering is ANY-of by default; pass `tagsMatch: "all"` to require
   * every tag (engram-server#866). Use `typeMetadata` for JSONB containment
   * filtering on `type_metadata` (ADR-042 D5) — both are list-only filters
   * (the search endpoint does not support them).
   *
   * ## Pagination: offset or keyset, never both
   *
   * `offset` and `cursor` are mutually exclusive (typed as a union, so passing
   * both is a compile error; a plain-JS caller gets a `VALIDATION_INPUT_INVALID`
   * `EngramError` before any request). Offset mode is unchanged and remains the
   * default. Keyset mode returns `nextCursor` — echo it back as `cursor` to read
   * the next page; when it is `undefined` you have reached the terminal page.
   *
   * Prefer keyset for anything that must enumerate a set completely: offset
   * pages shift underfoot when the corpus changes between requests, so deeper
   * pages can repeat or skip rows.
   *
   * ## Incremental listing (engram-server >= 0.45.0, ADR-040)
   *
   * `updatedAfter` / `createdAfter` are ISO-8601 watermarks — "only what changed
   * since my last poll". Compose them with `cursor`: the watermark is the poll
   * window, the cursor is the pagination *within* that window. Advance the
   * watermark only between polls, never per page — timestamps tie, and advancing
   * per page silently skips every row on the boundary.
   *
   * @example
   * ```typescript
   * // Crystals carrying BOTH tags, whose type_metadata contains the object
   * const { crystals } = await client.crystals.list({
   *   tags: ["catalog", "persona"],
   *   tagsMatch: "all",
   *   typeMetadata: { kind: "persona" },
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Incremental scan: drain the window by cursor, THEN move the watermark.
   * let cursor: string | undefined;
   * const pollStartedAt = new Date().toISOString();
   * do {
   *   const page = await client.crystals.list({
   *     tags: ["ingest"],
   *     updatedAfter: watermark,
   *     cursor,
   *     limit: 200,
   *   });
   *   await handle(page.crystals);
   *   cursor = page.nextCursor;
   * } while (cursor);
   * watermark = pollStartedAt; // only now — never inside the loop
   * ```
   */
  async list(params?: ListKnowledgeCrystalsParams): Promise<{
    crystals: KnowledgeCrystal[];
    total: number;
    hasMore: boolean;
    /**
     * Opaque cursor for the next keyset page — pass it back as `cursor`.
     * `undefined` on the terminal page (and always in offset mode).
     */
    nextCursor?: string;
  }> {
    const query = new URLSearchParams();

    if (params?.nodeType) {
      const nodeTypes = Array.isArray(params.nodeType)
        ? params.nodeType.join(",")
        : params.nodeType;
      query.set("node_type", nodeTypes);
    }
    if (params?.visibility) {
      query.set("visibility", params.visibility);
    }
    if (params?.tags) {
      query.set("tags", params.tags.join(","));
      // tagsMatch has "no effect without tags" (server contract, #866), so it
      // is only serialized alongside a tags filter — the wire mirrors the
      // documented semantics instead of sending a dangling modifier.
      if (params.tagsMatch) {
        query.set("tagsMatch", params.tagsMatch);
      }
    }
    if (params?.verified !== undefined) {
      query.set("verified", String(params.verified));
    }
    if (params?.sourceSessionId) {
      query.set("source_session_id", params.sourceSessionId);
    }
    if (params?.sourceProject) {
      query.set("source_project", params.sourceProject);
    }
    if (params?.ownerIds) {
      query.set("owner_ids", params.ownerIds);
    }
    if (params?.typeMetadata !== undefined) {
      // ADR-042 D5: the server's wire param is `metadataContains` — a
      // URL-encoded JSON OBJECT string matched against `type_metadata` by
      // JSONB containment. `undefined` check (not truthiness): `{}` is a
      // valid — if vacuous — containment filter and must not be dropped
      // (mirrors the server handler's own `!== undefined` guard).
      //
      // Runtime shape guard for untyped (plain-JS) callers: the server
      // rejects non-object JSON with an opaque 400, so a null/array/primitive
      // fails HERE with a clear client-side error before any request is made
      // (mirrors the server schema's own "arrays, primitives and null are not
      // containment filters" rule).
      const typeMetadata: unknown = params.typeMetadata;
      if (
        typeMetadata === null ||
        typeof typeMetadata !== "object" ||
        Array.isArray(typeMetadata)
      ) {
        throw new EngramError(
          "crystals.list: typeMetadata must be a plain JSON object (JSONB " +
            "containment filter, engram ADR-042 D5) — arrays, primitives and " +
            "null are not containment filters. Omit the field to list without " +
            "metadata filtering.",
          "VALIDATION_INPUT_INVALID",
        );
      }
      query.set("metadataContains", JSON.stringify(typeMetadata));
    }
    // ADR-040 / #995 watermarks. Validated client-side (zone-less instants are
    // an opaque 400 on the server) — see serializeWatermark.
    if (params?.createdAfter !== undefined) {
      query.set("createdAfter", serializeWatermark("createdAfter", params.createdAfter));
    }
    if (params?.updatedAfter !== undefined) {
      query.set("updatedAfter", serializeWatermark("updatedAfter", params.updatedAfter));
    }
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    // #925 keyset pagination. `cursor` and `offset` are mutually exclusive on
    // the server, which resolves the conflict by letting `cursor` win — a
    // silent reinterpretation of what the caller asked for. The union type
    // makes the pair a compile error; this guard is the plain-JS backstop, and
    // it FAILS rather than picking a winner (P1 — no silent degradation).
    const cursor: unknown = params?.cursor;
    const offset: unknown = params?.offset;
    if (cursor !== undefined && offset !== undefined) {
      throw new EngramError(
        "crystals.list: `cursor` and `offset` are mutually exclusive pagination " +
          "modes (engram-server #925) — the server would silently ignore " +
          "`offset`. Pass `cursor` for keyset pagination (stable under " +
          "concurrent writes) or `offset` for offset pagination, not both.",
        "VALIDATION_INPUT_INVALID",
      );
    }
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || cursor === "") {
        throw new EngramError(
          "crystals.list: `cursor` must be the non-empty opaque string returned " +
            "as `nextCursor` by a previous crystals.list() call — cursors are " +
            "server-issued and must not be constructed by the caller.",
          "VALIDATION_INPUT_INVALID",
        );
      }
      query.set("cursor", cursor);
    } else if (params?.offset) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/crystals${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal[]>>(
      "GET",
      path
    );

    const data = requireArray<KnowledgeCrystal>(
      unwrapData(response, `GET ${path}`, RESOURCE),
      `GET ${path}`,
      RESOURCE,
    );
    // Guard the cursor specifically: it is the one meta field that round-trips
    // back to the server, so a non-string here would surface later as an opaque
    // 400 on the caller's NEXT page rather than at the boundary that produced
    // it. `isNullableString` accepts absent/null — the terminal page.
    const pagination = response.meta?.pagination;
    if (pagination !== undefined) {
      requireField(pagination, "cursor", isNullableString, `GET ${path}`, RESOURCE);
    }
    return {
      crystals: data,
      total: pagination?.total ?? data.length,
      hasMore: pagination?.hasMore ?? false,
      // Normalize a wire `null` (absent cursor) to `undefined` so `nextCursor`
      // has exactly one "no more pages" value for the do/while idiom above.
      nextCursor: pagination?.cursor ?? undefined,
    };
  }

  /**
   * Update a knowledge crystal node
   */
  async update(id: string, params: UpdateKnowledgeCrystalParams): Promise<KnowledgeCrystal> {
    // ADR-018: JSON bodies are camelCase — no field remapping needed
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal>>(
      "PATCH",
      `/v1/crystals/${encodeURIComponent(id)}`,
      params
    );
    return unwrapData(response, `PATCH /v1/crystals/${encodeURIComponent(id)}`, RESOURCE);
  }

  /**
   * Delete a knowledge crystal node
   */
  async delete(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/crystals/${encodeURIComponent(id)}`
    );
  }

  /**
   * Search knowledge crystal nodes using semantic, keyword, or hybrid mode.
   *
   * Use `nodeType` to restrict results to one or more node types.
   *
   * **Without reranking** (default): Returns `KnowledgeCrystalSearchResult[]`
   * with `{ item, score, highlights? }` shape.
   *
   * **With reranking** (`reranking.enabled: true`): Returns
   * `CrystalSearchWithRerankingResult` with `{ results, reranking, diagnostics? }`.
   * The server fetches a larger candidate pool (`limit * candidate_multiplier`)
   * and re-scores using a cross-encoder model (or heuristic fallback).
   *
   * @example
   * ```typescript
   * // Standard search
   * const results = await client.crystals.search({ query: "auth patterns" });
   *
   * // Keyword search — no embedding required
   * const results = await client.crystals.search({
   *   query: "dependency injection",
   *   mode: "keyword",
   * });
   * const snippets = results[0].highlights; // { fieldName: [snippets] } or null
   * ```
   *
   * @example
   * ```typescript
   * // Search with reranking enabled
   * const { results, reranking } = await client.crystals.search({
   *   query: "auth patterns",
   *   limit: 5,
   *   reranking: { enabled: true, candidate_multiplier: 3 },
   * }) as CrystalSearchWithRerankingResult;
   * ```
   */
  async search(
    params: SearchKnowledgeCrystalsParams
  ): Promise<KnowledgeCrystalSearchResult[] | CrystalSearchWithRerankingResult> {
    // ADR-018: JSON bodies are camelCase — no field remapping needed
    const response = await this.request<
      ApiSuccessResponse<KnowledgeCrystalSearchResult[] | CrystalSearchWithRerankingResult>
    >(
      "POST",
      "/v1/crystals/search",
      params
    );
    return unwrapData(response, "POST /v1/crystals/search", RESOURCE);
  }

  /**
   * Rerank pre-fetched candidates using a cross-encoder model or heuristic scoring.
   *
   * Use this when you have already retrieved candidates from a prior search or
   * external source and want to improve precision by reranking.
   *
   * @example
   * ```typescript
   * const { results, reranking } = await client.crystals.rerank({
   *   query: "authentication patterns",
   *   candidates: priorResults.map(r => ({
   *     id: r.item.id,
   *     content: r.item.contentInline ?? r.item.title,
   *     retrieval_score: r.score,
   *   })),
   *   limit: 5,
   * });
   * console.log(`Reranked with ${reranking.model} in ${reranking.latency_ms}ms`);
   * ```
   */
  async rerank(request: RerankRequest): Promise<RerankResponse> {
    const response = await this.request<ApiSuccessResponse<RerankResponse>>(
      "POST",
      "/v1/crystals/rerank",
      request
    );
    return unwrapData(response, "POST /v1/crystals/rerank", RESOURCE);
  }

  /**
   * Get a scoped items resource for a specific crystal node
   *
   * @example
   * ```typescript
   * // Add an item to a crystal
   * await client.crystals.items("crystal-id").add({
   *   itemId: "node-id",
   *   position: 0,
   * });
   *
   * // List items in a crystal
   * const { items } = await client.crystals.items("crystal-id").list();
   *
   * // Remove an item from a crystal
   * await client.crystals.items("crystal-id").remove("node-id");
   * ```
   */
  items(crystalId: string): CrystalItemsResource {
    return new CrystalItemsResource(this.client, crystalId);
  }

  /**
   * Get a scoped versions resource for a specific crystal
   *
   * @example
   * ```typescript
   * // Create a new version (snapshot current state)
   * const version = await client.crystals.versions("crystal-id").create({
   *   changelog: "Added authentication patterns",
   * });
   *
   * // List all versions
   * const { versions } = await client.crystals.versions("crystal-id").list();
   *
   * // Get a specific version
   * const v1 = await client.crystals.versions("crystal-id").get(1);
   * ```
   */
  versions(crystalId: string): CrystalVersionsResource {
    return new CrystalVersionsResource(this.client, crystalId);
  }

  /**
   * Get a scoped hierarchy resource for a specific crystal
   *
   * @example
   * ```typescript
   * // Add a child crystal
   * const edge = await client.crystals.hierarchy("project-id").addChild({
   *   childId: "collection-id",
   * });
   *
   * // Get direct children
   * const { children } = await client.crystals.hierarchy("project-id").getChildren();
   *
   * // Get all descendants recursively
   * const { children: all } = await client.crystals.hierarchy("project-id").getChildren({
   *   recursive: true,
   *   maxDepth: 5,
   * });
   *
   * // Get full hierarchy tree
   * const tree = await client.crystals.hierarchy("project-id").getHierarchy();
   *
   * // Search within hierarchy scope
   * const results = await client.crystals.hierarchy("project-id").searchInScope({
   *   query: "authentication patterns",
   *   limit: 10,
   * });
   *
   * // Remove a child
   * await client.crystals.hierarchy("project-id").removeChild("child-id");
   * ```
   */
  hierarchy(crystalId: string): CrystalHierarchyResource {
    return new CrystalHierarchyResource(this.client, crystalId);
  }

  /**
   * List crystals currently in trash (lifecycle_status = 'archived').
   */
  async listTrash(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ items: TrashedCrystal[]; total: number; hasMore: boolean }> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const response = await this.request<ApiSuccessResponse<TrashedCrystal[]>>(
      "GET",
      `/v1/knowledge/trash${qs ? `?${qs}` : ""}`
    );
    const data = requireArray<TrashedCrystal>(
      unwrapData(response, "GET /v1/knowledge/trash", RESOURCE),
      "GET /v1/knowledge/trash",
      RESOURCE,
    );
    return {
      items: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Restore a crystal from trash back to active status.
   */
  async restoreFromTrash(
    crystalId: string
  ): Promise<{ id: string; lifecycleStatus: string; restoredAt: string }> {
    const response = await this.request<
      ApiSuccessResponse<{ id: string; lifecycleStatus: string; restoredAt: string }>
    >(
      "POST",
      `/v1/knowledge/trash/${encodeURIComponent(crystalId)}/restore`
    );
    return unwrapData(response, `POST /v1/knowledge/trash/${encodeURIComponent(crystalId)}/restore`, RESOURCE);
  }

  /**
   * Permanently delete a single crystal from trash.
   */
  async deleteFromTrash(crystalId: string): Promise<{ id: string; deleted: boolean }> {
    const response = await this.request<ApiSuccessResponse<{ id: string; deleted: boolean }>>(
      "DELETE",
      `/v1/knowledge/trash/${encodeURIComponent(crystalId)}`
    );
    return unwrapData(response, `DELETE /v1/knowledge/trash/${encodeURIComponent(crystalId)}`, RESOURCE);
  }

  /**
   * Permanently delete all crystals in trash.
   */
  async emptyTrash(): Promise<{ deletedCount: number }> {
    const response = await this.request<ApiSuccessResponse<{ deletedCount: number }>>(
      "DELETE",
      "/v1/knowledge/trash"
    );
    return unwrapData(response, "DELETE /v1/knowledge/trash", RESOURCE);
  }

  /**
   * Merge multiple crystals into a single consolidated crystal.
   */
  async merge(params: {
    crystalIds: string[];
    dryRun?: boolean;
    mergedTitle?: string;
  }): Promise<{
    success: boolean;
    mergedCrystalId?: string;
    mergedTitle?: string;
    supersededIds?: string[];
    edgesRedirected?: number;
    dryRun: boolean;
    error?: string;
  }> {
    const response = await this.request<ApiSuccessResponse<{
      success: boolean;
      mergedCrystalId?: string;
      mergedTitle?: string;
      supersededIds?: string[];
      edgesRedirected?: number;
      dryRun: boolean;
      error?: string;
    }>>("POST", "/v1/crystals/merge", params);
    return unwrapData(response, "POST /v1/crystals/merge", RESOURCE);
  }

  /**
   * Identify candidate clusters of semantically similar crystals.
   */
  async identifyClusters(params?: {
    minSimilarity?: number;
    limit?: number;
    sessionId?: string;
  }): Promise<Array<{
    representativeId: string;
    memberIds: string[];
    clusterScore: number;
    internalEdgeCount: number;
    size: number;
  }>> {
    const query = new URLSearchParams();
    if (params?.minSimilarity !== undefined) query.set("minSimilarity", String(params.minSimilarity));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.sessionId) query.set("sessionId", params.sessionId);
    const qs = query.toString();
    const response = await this.request<ApiSuccessResponse<Array<{
      representativeId: string;
      memberIds: string[];
      clusterScore: number;
      internalEdgeCount: number;
      size: number;
    }>>>("GET", `/v1/crystals/clusters${qs ? `?${qs}` : ""}`);
    return unwrapData(response, "GET /v1/crystals/clusters", RESOURCE);
  }

  /**
   * List deferred dedup merge candidates awaiting review (P11 Tier 1/2).
   *
   * These are near-duplicates the server flagged but held instead of merging
   * automatically. Resolve each with {@link reviewMerge}.
   *
   * The merge routes return a **bare** `{ success, pending, total }` object,
   * NOT the standard `{ data }` envelope — the shape is guarded so a contract
   * drift fails loudly. `total` is a required server field; a missing or
   * non-numeric `total` is treated as contract drift and throws rather than
   * being silently masked with `pending.length` (P-no-silent-degradation).
   *
   * @example
   * ```typescript
   * const { pending } = await client.crystals.pendingMerges({ limit: 50 });
   * for (const m of pending) {
   *   await client.crystals.reviewMerge(m.mergeId, { decision: "approve" });
   * }
   * ```
   */
  async pendingMerges(
    params?: ListPendingMergesParams
  ): Promise<{ pending: PendingMerge[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set("session_id", params.sessionId);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    const qs = query.toString();
    const path = `/v1/crystals/merges/pending${qs ? `?${qs}` : ""}`;
    const route = `GET ${path}`;

    const result = await this.request<{
      success: boolean;
      pending: PendingMerge[];
      total: number;
    }>("GET", path);

    const obj = requireObject(result, route, RESOURCE);
    const pending = requireArray<PendingMerge>(obj.pending, route, RESOURCE);
    // `total` is a server contract field. Validate it rather than falling back
    // to `pending.length`, which would silently mask an API contract drift
    // (e.g. the server dropping `total`) and could disagree with `pending` when
    // the list is paginated.
    requireField(obj, "total", isNumber, route, RESOURCE);
    return { pending, total: obj.total as number };
  }

  /**
   * Review a deferred merge candidate — approve, reject, or modify it.
   *
   * When `decision` is `"modify"` you must supply `mergedContent`; the server
   * rejects a `modify` without it (400 `VALIDATION_ERROR`).
   *
   * The route returns a **bare** `{ success, ...result }` object, NOT the
   * standard `{ data }` envelope.
   *
   * @throws {EngramError} (400) on an invalid UUID, unknown decision, or a
   *   `modify` missing `mergedContent`.
   * @throws {EngramError} (404/409) when the merge does not exist or is no
   *   longer pending (`MERGE_REVIEW_ERROR`).
   *
   * @example
   * ```typescript
   * await client.crystals.reviewMerge(mergeId, {
   *   decision: "modify",
   *   mergedContent: "consolidated text",
   * });
   * ```
   */
  async reviewMerge(
    mergeId: string,
    params: ReviewMergeParams
  ): Promise<ReviewMergeResult> {
    const path = `/v1/crystals/merges/${encodeURIComponent(mergeId)}/review`;
    const route = `POST ${path}`;
    // The server's body schema is snake_case (`merged_content`); map it and
    // omit the field unless it was supplied.
    const body: { decision: MergeReviewDecision; merged_content?: string } = {
      decision: params.decision,
    };
    if (params.mergedContent !== undefined) body.merged_content = params.mergedContent;

    const result = await this.request<{
      success: boolean;
      decision: MergeReviewDecision;
      targetCrystalId?: string;
    }>("POST", path, body);

    const obj = requireObject(result, route, RESOURCE);
    requireField(obj, "decision", isString, route, RESOURCE);
    // `targetCrystalId` is present on approve/modify and absent (null/omitted)
    // on reject. Validate it is a string-or-nullable so a malformed value (e.g.
    // a number) fails loudly, then surface it only when it is a non-empty
    // string — an empty string is not a usable crystal id and is normalized to
    // "absent" so callers never branch on a falsy-but-present value.
    requireField(obj, "targetCrystalId", isNullableString, route, RESOURCE);
    return {
      decision: result.decision,
      ...(typeof obj.targetCrystalId === "string" && obj.targetCrystalId.length > 0
        ? { targetCrystalId: obj.targetCrystalId }
        : {}),
    };
  }

  /**
   * Get the full merge provenance chain for a note or crystal (P11).
   *
   * Returns every {@link MergeRecord} that fed into the item, newest-first as
   * the server orders them. The route returns a **bare**
   * `{ success, id, merge_chain, total }` object, NOT the standard `{ data }`
   * envelope.
   *
   * @throws {EngramError} (400 `INVALID_ID`) when `itemId` is not a valid UUID.
   *
   * @example
   * ```typescript
   * const { mergeChain } = await client.crystals.mergeHistory(crystalId);
   * console.log(`${mergeChain.length} merges fed this crystal`);
   * ```
   */
  async mergeHistory(
    itemId: string
  ): Promise<{ id: string; mergeChain: MergeRecord[]; total: number }> {
    const path = `/v1/crystals/merges/history/${encodeURIComponent(itemId)}`;
    const route = `GET ${path}`;

    const result = await this.request<{
      success: boolean;
      id: string;
      merge_chain: MergeRecord[];
      total: number;
    }>("GET", path);

    const obj = requireObject(result, route, RESOURCE);
    requireField(obj, "id", isString, route, RESOURCE);
    const mergeChain = requireArray<MergeRecord>(obj.merge_chain, route, RESOURCE);
    // `total` is a server contract field — validate it rather than masking a
    // drift with `mergeChain.length` (mirrors pendingMerges()).
    requireField(obj, "total", isNumber, route, RESOURCE);
    return {
      id: result.id,
      mergeChain,
      total: obj.total as number,
    };
  }
}
