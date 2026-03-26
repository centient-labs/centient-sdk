/**
 * NodeType — Unified Knowledge Crystal Node Type
 *
 * A 12-value string literal union that replaces the former
 * separate `KnowledgeItemType` (6 content types) and `CrystalType`
 * (4 container types) enums. Terrafirma types are added in ADR-055.
 *
 * ADR-055: Unified Knowledge Crystal Model
 */

// ============================================================================
// NodeType Union
// ============================================================================

/**
 * The unified node type for all knowledge crystal nodes.
 *
 * Content types (formerly KnowledgeItemType):
 *   - pattern, learning, decision, note, finding, constraint
 *
 * Container types (formerly CrystalType):
 *   - collection, session_artifact, project, domain
 *
 * Terrafirma types (filesystem sync, ADR-049):
 *   - file_ref, directory
 */
export type NodeType =
  // Content types (formerly KnowledgeItemType)
  | "pattern"
  | "learning"
  | "decision"
  | "note"
  | "finding"
  | "constraint"
  // Container types (formerly CrystalType)
  | "collection"
  | "session_artifact"
  | "project"
  | "domain"
  // Terrafirma types (ADR-049)
  | "file_ref"
  | "directory";

