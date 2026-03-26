/**
 * Export/Import Types (SDK)
 *
 * Mirrored from packages/engram/src/types/export-import.ts.
 * Keep in sync with the backend source of truth.
 * Date fields use `string` (JSON wire format, not Date objects).
 *
 * Naming difference: SDK uses `ImportOptions` where the backend uses
 * `ImportParams` — a deliberate rename for public API clarity.
 */

// ============================================================================
// Export Types
// ============================================================================

/**
 * Which data domains to include in an export.
 * Note: "knowledge" and "crystals" scopes both map to the unified
 * knowledge_crystals table on the server (ADR-055).
 */
export type ExportScope = "knowledge" | "crystals" | "sessions";

/**
 * Entity types used in export/import operations.
 * Unified types replace the former separate knowledge/crystal entity names.
 */
export type ExportEntityType =
  | "knowledge_crystals"
  | "knowledge_crystal_edges"
  | "crystal_versions"
  | "crystal_acl"
  | "crystal_share_links"
  | "sessions"
  | "session_notes"
  | "session_note_edges"
  | "session_constraints"
  | "session_links"
  | "decision_points"
  | "exploration_branches"
  | "stuck_detections"
  // Deprecated aliases (ADR-057)
  | "knowledge_items"
  | "knowledge_edges"
  | "crystals"
  | "crystal_memberships"
  | "crystal_edges";

/** Filters to narrow the set of entities included in an export. */
export interface ExportFilter {
  // Time filters
  since?: string;
  until?: string;

  // Source filters
  crystalIds?: string[];
  sessionIds?: string[];
  sourceProject?: string;

  // Type filters
  /** @deprecated Use nodeTypes instead */
  types?: string[];
  /** @deprecated Use nodeTypes instead */
  crystalTypes?: string[];
  /** Unified node type filter (ADR-055) */
  nodeTypes?: string[];

  // Quality filters
  verified?: boolean;
  minConfidence?: number;
  embedded?: boolean;

  // Relationship filters
  includeRelatedDepth?: number;
}

/** Parameters for initiating an export or estimating its size. */
export interface ExportParams {
  scopes: ExportScope[];
  filters: ExportFilter;
  format: "ndjson" | "archive";
  compress: boolean;
}

/** Estimated entity and byte counts for a prospective export. */
export interface ExportEstimate {
  /** @deprecated Use knowledgeCrystals instead */
  knowledgeItems?: number;
  /** @deprecated Use knowledgeCrystalEdges instead */
  knowledgeEdges?: number;
  /** @deprecated Use knowledgeCrystals instead */
  crystals?: number;
  /** @deprecated Use knowledgeCrystalEdges instead */
  crystalMemberships?: number;
  /** Unified node count (replaces knowledgeItems + crystals) */
  knowledgeCrystals: number;
  /** Unified edge count (replaces knowledgeEdges + crystalMemberships) */
  knowledgeCrystalEdges: number;
  sessions: number;
  sessionNotes: number;
  totalEntities: number;
  estimatedSizeBytes: number;
}

// ============================================================================
// Import Types
// ============================================================================

/** Strategy for resolving conflicts during import. */
export type ConflictResolution = "newer" | "skip" | "overwrite" | "prompt";

/** Options controlling import behaviour. */
export interface ImportOptions {
  onConflict: ConflictResolution;
  wipe?: boolean;
  wipeAll?: boolean;
  preview?: boolean;
  force?: boolean;
  ignoreChecksums?: boolean;
  targetProject?: string;
}

/** A single entity conflict detected during import preview. */
export interface ImportConflict {
  id: string;
  entityType: string;
  title: string;
  localUpdatedAt: string;
  importUpdatedAt: string;
}

/** Result of a preview import run — reports what would happen without changes. */
export interface ImportPreview {
  success: boolean;
  schemaVersion?: {
    archive: string;
    current: string;
    migrationRequired: boolean;
  };
  counts?: Record<string, { new: number; updated: number; skipped: number }>;
  conflicts?: ImportConflict[];
  conflictCount?: number;
  error?: {
    code: string;
    message: string;
  };
}

/** Result of a completed import operation. */
export interface ImportResult {
  success: boolean;
  counts: Record<string, { inserted: number; updated: number; skipped: number }>;
  errors: Array<{ entityType: string; id: string; error: string }>;
  duration: number;
}
