/**
 * KnowledgeCrystal — Unified Knowledge Crystal Type
 *
 * Merges the former `KnowledgeItem` and `Crystal` types into a single
 * unified node type backed by the `knowledge_crystals` table.
 *
 * ADR-055: Unified Knowledge Crystal Model
 * ADR-057: Knowledge Crystal Application Layer Restructuring (Phase C)
 *
 * SDK convention: all date/timestamp fields use `string` (ISO 8601 wire
 * format), not `Date` objects.
 */

import type { NodeType } from "./node-type.js";

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * Visibility level for a knowledge crystal node.
 * Replaces the former `CrystalVisibility`.
 */
export type NodeVisibility = "private" | "shared" | "public";

/**
 * Embedding synchronization status for a node.
 */
export type EmbeddingStatus =
  | "pending"
  | "processing"
  | "synced"
  | "failed"
  | "stale";

/**
 * How an item was added to a container crystal.
 */
export type MembershipAddedBy =
  | "promotion"
  | "manual"
  | "import"
  | "finalization"
  | "terrafirma"
  | "consolidation";

/**
 * Reference to content storage location.
 */
export interface ContentRef {
  /** Storage type */
  type: "inline" | "blob" | "git" | "url";
  /** URI for external content (blob, git, url types) */
  uri?: string;
  /** MIME type of the content */
  mimeType?: string;
  /** Size of content in bytes */
  sizeBytes?: number;
  /** Content checksum for integrity verification */
  checksum?: string;
}

// ============================================================================
// Core Entity
// ============================================================================

/**
 * Unified knowledge crystal node — the single node type in the
 * knowledge graph (ADR-055). Replaces both `KnowledgeItem` and `Crystal`.
 *
 * All fields from the former types are preserved. Fields that only
 * applied to one side may be `null` for the other. The `nodeType` field
 * determines which fields are semantically relevant.
 */
export interface KnowledgeCrystal {
  /** Unique identifier (UUID) */
  id: string;
  /** URL-friendly slug (lowercase alphanumeric with hyphens) */
  slug: string | null;
  /** Unified node type (12-value union replacing KnowledgeItemType + CrystalType) */
  nodeType: NodeType;
  /** Human-readable title */
  title: string;
  /** Brief summary of the node */
  summary: string | null;
  /** Extended description (primarily for container nodes) */
  description: string | null;
  /** Tags for categorization */
  tags: string[];
  /** Reference to content storage (content nodes; null for containers) */
  contentRef: ContentRef | null;
  /** Inline content (when contentRef.type is 'inline') */
  contentInline: string | null;
  /** Embedding synchronization status */
  embeddingStatus: EmbeddingStatus;
  /** ISO timestamp of when embeddings were last updated */
  embeddingUpdatedAt: string | null;
  /** Confidence score (0-1, content nodes) */
  confidence: number | null;
  /** Whether this node has been verified (content nodes) */
  verified: boolean;
  /** Visibility level */
  visibility: NodeVisibility;
  /** License identifier (e.g. "MIT", "Apache-2.0") */
  license: string | null;
  /** User IDs who own this node */
  ownerIds: string[];
  /** Monotonic version number */
  version: number;
  /** Number of times this node has been forked */
  forkCount: number;
  /** Number of stars this node has received */
  starCount: number;
  /** Number of child items (container nodes) */
  itemCount: number;
  /** Number of versions */
  versionCount: number;
  /** ID of the parent node this was forked from */
  parentId: string | null;
  /** Version number of the parent at time of fork */
  parentVersion: number | null;
  /**
   * How this node was created:
   * - `session`: created during a session
   * - `manual`: created directly by a user
   * - `import`: imported from an external source
   * - `promotion`: promoted from scratch/session content
   * - `finalization`: created during session finalization
   * - `extraction`: created by the entity-extraction pipeline
   */
  sourceType:
    | "session"
    | "manual"
    | "import"
    | "promotion"
    | "finalization"
    | "extraction"
    | null;
  /** Source session ID (if created during a session) */
  sourceSessionId: string | null;
  /** Source project identifier */
  sourceProject: string | null;
  /** Type-specific metadata */
  typeMetadata: Record<string, unknown>;
  /** Filesystem path (Terrafirma file_ref and directory nodes) */
  path: string | null;
  /** Lifecycle status (ADR-058) */
  lifecycleStatus: "active" | "archived" | "merged";
  /** ISO timestamp of last access (relevance tracking) */
  lastAccessedAt: string | null;
  /** Number of times this node has been accessed */
  accessCount: number;
  /** Computed relevance score (0-1, used by GC) */
  relevanceScore: number | null;
  /** ISO timestamp of when this node was archived */
  archivedAt: string | null;
  /** ISO timestamp of soft deletion, or null if active */
  deletedAt: string | null;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * A knowledge crystal summary returned by listTrash().
 * Contains only the fields returned by the trash listing endpoint.
 */
export interface TrashedCrystal {
  /** UUID of the crystal */
  id: string;
  /** Display title of the crystal */
  title: string;
  /** ISO 8601 timestamp when the crystal was moved to trash. */
  archivedAt: string;
  /** Days remaining before permanent deletion (approximate, based on server retention policy). */
  daysUntilPurge: number;
}

// ============================================================================
// Create/Update Parameters
// ============================================================================

/**
 * Parameters for creating a knowledge crystal node.
 */
export interface CreateKnowledgeCrystalParams {
  /** Client-supplied UUID (optional, server generates if omitted) */
  id?: string;
  /** Node type */
  nodeType: NodeType;
  /** Human-readable title */
  title: string;
  /** Brief summary */
  summary?: string;
  /** Extended description */
  description?: string;
  /** Tags for categorization */
  tags?: string[];
  /** URL-friendly slug */
  slug?: string;
  /** Content reference (required for content-type nodes: pattern, learning, decision, note, finding, constraint) */
  contentRef?: ContentRef;
  /** Inline content (content nodes) */
  contentInline?: string;
  /** Confidence score (0-1, content nodes) */
  confidence?: number;
  /** Whether verified (content nodes) */
  verified?: boolean;
  /** Visibility level (default: private) */
  visibility?: NodeVisibility;
  /** License identifier */
  license?: string;
  /** User IDs who own this node */
  ownerIds?: string[];
  /** Type-specific metadata */
  typeMetadata?: Record<string, unknown>;
  /** Source type */
  sourceType?: "session" | "manual" | "import" | "promotion" | "finalization" | "extraction";
  /** Source session ID */
  sourceSessionId?: string;
  /** Source project identifier */
  sourceProject?: string;
  /** Filesystem path (file_ref, directory nodes) */
  path?: string;
  /** Coherence mode for conflict handling during creation */
  coherenceMode?: "blocking" | "advisory" | "bypass";
}

/**
 * Parameters for updating a knowledge crystal node.
 */
export interface UpdateKnowledgeCrystalParams {
  /** Human-readable title */
  title?: string;
  /** Brief summary */
  summary?: string;
  /** Extended description */
  description?: string;
  /** URL-friendly slug */
  slug?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Content reference */
  contentRef?: ContentRef;
  /** Inline content (content nodes) */
  contentInline?: string;
  /** Confidence score (0-1, content nodes) */
  confidence?: number;
  /** Whether verified (content nodes) */
  verified?: boolean;
  /** Visibility level */
  visibility?: NodeVisibility;
  /** License identifier */
  license?: string;
  /** Node type */
  nodeType?: NodeType;
  /** Type-specific metadata */
  typeMetadata?: Record<string, unknown>;
  /** Source session ID */
  sourceSessionId?: string;
  /** Source project identifier */
  sourceProject?: string;
  /** Monotonic version number */
  version?: number;
  /** Filesystem path (file_ref, directory nodes) */
  path?: string;
}

// ============================================================================
// List/Search Parameters
// ============================================================================

/**
 * Parameters for listing knowledge crystal nodes.
 */
export interface ListKnowledgeCrystalsParams {
  /** Filter by node type (single or multiple) */
  nodeType?: NodeType | NodeType[];
  /** Filter by visibility */
  visibility?: NodeVisibility;
  /** Filter by tags */
  tags?: string[];
  /** Filter by verification status (content nodes) */
  verified?: boolean;
  /** Filter by source session ID */
  sourceSessionId?: string;
  /** Filter by source project */
  sourceProject?: string;
  /** Filter by owner IDs (comma-separated) */
  ownerIds?: string;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Parameters for searching knowledge crystal nodes.
 */
export interface SearchKnowledgeCrystalsParams {
  /** Search query */
  query: string;
  /** Filter by node type (single or multiple) */
  nodeType?: NodeType | NodeType[];
  /** Filter by visibility */
  visibility?: NodeVisibility;
  /** Filter by tags */
  tags?: string[];
  /** Filter by verification status (content nodes) */
  verified?: boolean;
  /** Search mode */
  mode?: "semantic" | "keyword" | "fulltext" | "hybrid";
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Minimum similarity threshold (0-1, server default: 0.5) */
  threshold?: number;
  /**
   * Reranking configuration. When `enabled: true`, the server fetches a
   * larger candidate pool and re-scores results using a cross-encoder model
   * (or heuristic fallback). Response shape changes to `CrystalSearchWithRerankingResult`.
   */
  reranking?: import("./reranking.js").RerankingConfig;
  /**
   * Enable graph expansion in hybrid mode.
   * Traverses crystal edges (1 hop, non-containment) from initial candidates to find
   * structurally related crystals as a third RRF modality.
   * Default: false. Only applies when mode is 'hybrid'.
   */
  graphExpansion?: boolean;
}

/**
 * Knowledge crystal search result with score and highlights.
 */
export interface KnowledgeCrystalSearchResult {
  /** The matched knowledge crystal node */
  item: KnowledgeCrystal;
  /** Relevance score */
  score: number;
  /** Highlighted snippets by field */
  highlights?: Record<string, string[]>;
  /** 0-based rank in the vector (semantic) list; undefined if not a vector candidate */
  vectorRank?: number;
  /** 0-based rank in the BM25 (fulltext) list; undefined if not an FTS candidate */
  bm25Rank?: number;
  /** 0-based rank in the graph expansion list; undefined if not a graph candidate */
  graphRank?: number;
  /** Final RRF score across contributing modalities */
  rrfScore?: number;
}

/**
 * A single result from a reranked crystal search.
 * Extends the standard search result with a retrieval_score and optional diagnostics.
 */
export interface RankedCrystalSearchResult {
  /** The matched knowledge crystal node (hydrated from the server) */
  item: KnowledgeCrystal;
  /** Final reranked score */
  score: number;
  /** Original retrieval score before reranking */
  retrieval_score: number;
  /** Per-result diagnostics (present when `include_diagnostics: true`) */
  diagnostics?: import("./reranking.js").DiagnosticRerankInfo;
}

/**
 * Response from a search with reranking enabled.
 * Returned by `crystals.search()` when `reranking.enabled: true`.
 */
export interface CrystalSearchWithRerankingResult {
  /** Reranked results in descending score order */
  results: RankedCrystalSearchResult[];
  /** Reranking operation metadata */
  reranking: import("./reranking.js").RerankingMetadata;
  /** Aggregate diagnostics (present when `include_diagnostics: true`) */
  diagnostics?: {
    total_candidates: number;
    reranking_latency_ms: number;
    model_used?: string;
  };
}

// ============================================================================
// Crystal-Specific Types (Retained — used by crystal resource sub-resources)
// ============================================================================

/**
 * Raw membership row linking an item to a container crystal.
 *
 * Represents the raw junction relationship between a container node and
 * a child node. For listing contained items, use {@link CrystalItem}.
 */
export interface CrystalMembership {
  /** Unique identifier (UUID) */
  id: string;
  /** Container crystal node ID */
  crystalId: string;
  /** Child item node ID */
  itemId: string;
  /** Optional position in the container (for ordering) */
  position?: number;
  /** How this item was added */
  addedBy: MembershipAddedBy;
  /** ISO timestamp of when added */
  addedAt: string;
  /** ISO timestamp of soft deletion, or null if active */
  deletedAt: string | null;
}

/**
 * Item within a container crystal as returned by the server's list items endpoint.
 * This is the joined view, not the raw membership row.
 */
export interface CrystalItem {
  /** Item node ID */
  itemId: string;
  /** Item node type */
  itemType: string;
  /** Item title */
  title: string;
  /** ISO timestamp of when the item was added */
  addedAt: string;
}

/**
 * Parameters for adding an item to a container crystal.
 */
export interface AddCrystalItemParams {
  /** Node ID to add */
  itemId: string;
  /** Optional position in the container */
  position?: number;
  /** How the item was added (default: manual) */
  addedBy?: MembershipAddedBy;
}

/**
 * Parameters for listing items in a container crystal.
 */
export interface ListCrystalItemsParams {
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * A snapshot of a crystal node at a specific version.
 */
export interface CrystalVersion {
  /** Unique identifier (UUID) */
  id: string;
  /** Crystal node ID this version belongs to */
  crystalId: string;
  /** Version number (1, 2, 3, ...) */
  version: number;
  /** Description of changes in this version */
  changelog: string;
  /** Snapshot of memberships at this version */
  membershipSnapshot: CrystalMembership[];
  /** Partial snapshot of crystal properties at this version */
  crystalSnapshot: Partial<KnowledgeCrystal>;
  /** ISO timestamp of when this version was created */
  createdAt: string;
}

/**
 * Parameters for creating a new crystal version (snapshot).
 */
export interface CreateCrystalVersionParams {
  /** Description of changes in this version (optional) */
  changelog?: string;
}

/**
 * Parameters for listing crystal versions.
 */
export interface ListCrystalVersionsParams {
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Hierarchy Types (Retained — ADR-031)
// ============================================================================

/**
 * A crystal contained within another crystal (from downward traversal).
 */
export interface ContainedCrystal {
  /** Crystal node ID */
  crystalId: string;
  /** Nesting depth from the root crystal */
  depth: number;
  /** Path of crystal IDs from root to this crystal */
  path: string[];
}

/**
 * A parent crystal (from upward traversal).
 */
export interface ParentCrystal {
  /** Crystal node ID */
  crystalId: string;
  /** Distance from the starting crystal */
  depth: number;
  /** Path of crystal IDs from this crystal to root */
  path: string[];
}

/**
 * Recursive tree structure for crystal hierarchy.
 */
export interface CrystalHierarchy {
  /** Crystal node ID at this node */
  crystalId: string;
  /** Child hierarchies */
  children: CrystalHierarchy[];
  /** Depth in the hierarchy */
  depth: number;
}

/**
 * Error returned when a containment edge would create a cycle.
 */
export interface CycleDetectedError {
  /** Error code */
  code: "VALID_CYCLE_DETECTED";
  /** Human-readable message */
  message: string;
  /** Source crystal ID that triggered the cycle */
  sourceId?: string;
  /** Target crystal ID that triggered the cycle */
  targetId?: string;
}

/**
 * Parameters for adding a child crystal.
 */
export interface AddChildCrystalParams {
  /** ID of the crystal to add as a child */
  childId: string;
}

/**
 * Parameters for listing children or parents.
 */
export interface ListHierarchyParams {
  /** Recursively traverse the hierarchy (default: false) */
  recursive?: boolean;
  /** Maximum traversal depth (default: 10, max: 100) */
  maxDepth?: number;
}

/**
 * Parameters for scoped search within a crystal hierarchy.
 */
export interface ScopedSearchParams {
  /** Search query */
  query: string;
  /** Maximum results (default: 20) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Include items from contained crystals (default: true) */
  includeContained?: boolean;
  /** Minimum similarity threshold (0-1, default: 0.5) */
  threshold?: number;
  /** Search mode: 'semantic' (vector, default), 'keyword'/'fulltext' (FTS), or 'hybrid' (RRF merge). */
  mode?: "semantic" | "keyword" | "hybrid";
}

/**
 * Scoped search result item.
 */
export interface ScopedSearchResult {
  /** Node ID */
  id: string;
  /** Node type */
  type: string;
  /** Node title */
  title: string;
  /** Inline content */
  contentInline?: string;
  /** Summary */
  summary?: string;
  /** Tags */
  tags: string[];
  /** Relevance score */
  similarity: number;
  /** ISO timestamp of creation */
  createdAt: string;
}

