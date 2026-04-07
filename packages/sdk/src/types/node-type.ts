/**
 * NodeType — Unified Knowledge Crystal Node Type
 *
 * A 14-value string literal union that replaces the former
 * separate `KnowledgeItemType` (6 content types) and `CrystalType`
 * (4 container types) enums. Terrafirma and system types added in
 * ADR-055/ADR-058.
 *
 * ADR-055: Unified Knowledge Crystal Model
 * ADR-058: System & Collaboration Node Types
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
  | "directory"
  // System types (ADR-058)
  | "system"
  | "memory_space";

