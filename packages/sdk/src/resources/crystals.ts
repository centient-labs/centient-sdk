/**
 * Crystals Resource
 *
 * Resource-based SDK interface for unified knowledge crystal node management.
 * Replaces the dual Crystal/KnowledgeItem model with a single KnowledgeCrystal
 * node type (ADR-055, ADR-057 Phase C).
 */

import type { EngramClient } from "../client.js";
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
      hasMore: boolean;
    };
  };
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
    return response.data;
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

    return {
      items: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
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
    return response.data;
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

    return {
      versions: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
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
    return response.data;
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
    return response.data;
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
    return response.data;
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

    return {
      children: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
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

    return {
      parents: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
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
    return response.data;
  }

  /**
   * Get the scope of this crystal (itself + all contained crystal IDs)
   */
  async getCrystalScope(): Promise<string[]> {
    const response = await this.request<ApiSuccessResponse<string[]>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(this.crystalId)}/scope/items`
    );
    return response.data;
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
    return response.data;
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
    return response.data;
  }

  /**
   * Get a knowledge crystal node by ID
   */
  async get(id: string): Promise<KnowledgeCrystal> {
    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal>>(
      "GET",
      `/v1/crystals/${encodeURIComponent(id)}`
    );
    return response.data;
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
    return {
      edges: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * List knowledge crystal nodes with optional filters.
   *
   * Use `nodeType` to filter by one or more node types (e.g. `"pattern"`,
   * `["pattern", "decision"]`).
   */
  async list(params?: ListKnowledgeCrystalsParams): Promise<{
    crystals: KnowledgeCrystal[];
    total: number;
    hasMore: boolean;
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
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.offset) {
      query.set("offset", String(params.offset));
    }

    const queryString = query.toString();
    const path = `/v1/crystals${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<ApiSuccessResponse<KnowledgeCrystal[]>>(
      "GET",
      path
    );

    return {
      crystals: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
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
    return response.data;
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
    return response.data;
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
    return response.data;
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
    return {
      items: response.data,
      total: response.meta?.pagination?.total ?? response.data.length,
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
    return response.data;
  }

  /**
   * Permanently delete a single crystal from trash.
   */
  async deleteFromTrash(crystalId: string): Promise<{ id: string; deleted: boolean }> {
    const response = await this.request<ApiSuccessResponse<{ id: string; deleted: boolean }>>(
      "DELETE",
      `/v1/knowledge/trash/${encodeURIComponent(crystalId)}`
    );
    return response.data;
  }

  /**
   * Permanently delete all crystals in trash.
   */
  async emptyTrash(): Promise<{ deletedCount: number }> {
    const response = await this.request<ApiSuccessResponse<{ deletedCount: number }>>(
      "DELETE",
      "/v1/knowledge/trash"
    );
    return response.data;
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
    return response.data;
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
    return response.data;
  }
}
