/**
 * KnowledgeCrystalEdge — Unified Knowledge Crystal Edge Type
 *
 * Merges the former `KnowledgeEdge` (knowledge.ts) and `CrystalEdge`
 * (crystals.ts) into a single unified edge type backed by the
 * `knowledge_crystal_edges` table.
 *
 * ADR-055: Unified Knowledge Crystal Model
 * ADR-057: Knowledge Crystal Application Layer Restructuring (Phase C)
 *
 * SDK convention: all date/timestamp fields use `string` (ISO 8601 wire
 * format), not `Date` objects.
 */

// ============================================================================
// Edge Relationship Union
// ============================================================================

/**
 * The unified relationship type for all knowledge crystal edges.
 *
 * Merges the former `EdgeRelationship` (knowledge items) and
 * `CrystalEdgeRelationship` (crystal hierarchy) unions.
 *
 * - `contains`: Hierarchy — parent contains child (formerly crystal only)
 * - `derived_from`: Versioning, extraction, refinement
 * - `related_to`: Semantic connection
 * - `contradicts`: Tension or conflict
 * - `implements`: Implements a pattern or decision
 * - `depends_on`: Requires another node
 */
export type KnowledgeCrystalEdgeRelationship =
  | "contains"      // Hierarchy: parent contains child
  | "derived_from"  // Versioning, extraction, refinement
  | "related_to"    // Semantic connection
  | "contradicts"   // Tension or conflict
  | "supports"      // Evidence supporting a claim
  | "implements"    // Implements a pattern/decision
  | "depends_on";   // Requires another node

// ============================================================================
// Core Entity
// ============================================================================

/**
 * Unified edge connecting two knowledge crystal nodes.
 * Replaces both `KnowledgeEdge` and `CrystalEdge`.
 */
export interface KnowledgeCrystalEdge {
  /** Unique identifier (UUID) */
  id: string;
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Type of relationship */
  relationship: KnowledgeCrystalEdgeRelationship;
  /** Additional metadata about the relationship */
  metadata: Record<string, unknown>;
  /** Edge weight (default 1.0) */
  weight: number;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Creator ID (optional) */
  createdBy?: string;
  /** ISO timestamp of soft deletion, or null if active */
  deletedAt: string | null;
}

// ============================================================================
// CRUD Parameters
// ============================================================================

/**
 * Parameters for creating an edge between two knowledge crystal nodes.
 */
export interface CreateKnowledgeCrystalEdgeParams {
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Relationship type */
  relationship: KnowledgeCrystalEdgeRelationship;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating an edge.
 */
export interface UpdateKnowledgeCrystalEdgeParams {
  /** Updated metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing edges with optional filters.
 */
export interface ListKnowledgeCrystalEdgesParams {
  /** Filter by source node ID */
  sourceId?: string;
  /** Filter by target node ID */
  targetId?: string;
  /** Filter by relationship type */
  relationship?: KnowledgeCrystalEdgeRelationship;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

