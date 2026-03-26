/**
 * WAL (Write-Ahead Log) Type Definitions
 *
 * Types for the append-only JSON lines WAL used for crash recovery.
 * Each WAL entry captures an operation before it executes, enabling
 * idempotent replay on restart.
 */

// ---------------------------------------------------------------------------
// Entry Types
// ---------------------------------------------------------------------------

/** Entry type discriminant. Consumers define their own type strings. */
export type WALEntryType = string;

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/** A single WAL entry in the JSON lines log. */
export interface WALEntry {
  /** Unique ID for idempotent replay (UUID v4). */
  operationId: string;
  /** ISO 8601 timestamp of when the entry was created. */
  timestamp: string;
  /** The type of operation being logged. */
  type: WALEntryType;
  /** Scope identifier (e.g., pipeline UUID, project ID). */
  scopeId: string;
  /** Which stage this operation belongs to (if applicable). */
  stage?: string;
  /** Phase number within the stage (if applicable). */
  phase?: number;
  /**
   * Type-specific data (must be JSON-serializable).
   *
   * Typed as `unknown` intentionally: the WAL is operation-type-agnostic.
   * Each WALEntryType carries different payload shapes. Callers narrow
   * the type based on the `type` field when replaying entries.
   */
  payload: unknown;
  /** True once the operation is confirmed successful. */
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

/** Fields required when appending a new WAL entry (auto-generated fields omitted). */
export type WALEntryInput = Omit<WALEntry, "operationId" | "timestamp" | "confirmed">;

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/** Result of appending a WAL entry. */
export interface WALAppendResult {
  success: boolean;
  /** The generated operation ID for tracking. */
  operationId: string;
  error?: string;
}

/** Result of confirming a WAL entry. */
export interface WALConfirmResult {
  success: boolean;
  error?: string;
}

/** Result of reading WAL entries. */
export interface WALReadResult {
  success: boolean;
  entries: WALEntry[];
  error?: string;
}

/** Result of validating a scope ID. */
export interface WALValidationResult {
  success: boolean;
  error?: string;
}

/** Result of compacting a WAL file (removing confirmed entries). */
export interface WALCompactResult {
  success: boolean;
  /** Number of confirmed entries removed. */
  removed: number;
  /** Number of unconfirmed entries remaining. */
  remaining: number;
  error?: string;
}
