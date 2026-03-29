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
  /** True if the entry was written with confirmed: true (auto-confirm). */
  autoConfirmed: boolean;
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

// ---------------------------------------------------------------------------
// Append Options
// ---------------------------------------------------------------------------

/** Options for `appendEntry`. */
export interface WALAppendOptions {
  /** Write the entry with `confirmed: true` (fire-and-forget entries). */
  autoConfirm?: boolean;
}

// ---------------------------------------------------------------------------
// Replay Types
// ---------------------------------------------------------------------------

/**
 * Executor callback invoked for each unconfirmed WAL entry during replay.
 *
 * The executor receives the full WALEntry and must perform the operation
 * that the entry represents. It must be idempotent: if the operation was
 * partially completed before the crash, re-executing it should not produce
 * duplicates.
 *
 * Return `true` on success, `false` on failure. Throwing is also treated as
 * failure — the error message is captured in the replay result.
 */
export type WALExecutor = (entry: WALEntry) => Promise<boolean>;

/** Outcome of executing a single WAL entry during replay. */
export interface ReplayEntryResult {
  operationId: string;
  /** Whether the executor succeeded and the entry was confirmed. */
  success: boolean;
  /** True if the entry was already confirmed (skipped). */
  skipped: boolean;
  /** True if the entry was dead-lettered after exhausting maxRetries. */
  deadLettered: boolean;
  /** Error message if the executor or confirmation failed. */
  error?: string;
}

/**
 * Options for replay operations.
 *
 * `maxRetries` can also be set via the `WAL_MAX_RETRIES` environment variable.
 * Priority: `options.maxRetries` > `WAL_MAX_RETRIES` > default (5).
 */
export interface ReplayOptions {
  /** Max retries before dead-lettering an entry. Default: 5. Clamped to [1, 100]. */
  maxRetries?: number;
}

/** Summary returned after replaying all unconfirmed entries. */
export interface ReplayResult {
  success: boolean;
  /** Total entries found in the WAL (confirmed + unconfirmed). */
  totalEntries: number;
  /** Entries that were unconfirmed and needed replay. */
  unconfirmedCount: number;
  /** Entries successfully replayed and confirmed. */
  replayedCount: number;
  /** Entries that failed replay. */
  failedCount: number;
  /** Entries that exceeded maxRetries and were dead-lettered. */
  deadLetteredCount: number;
  /** Per-entry results. */
  results: ReplayEntryResult[];
  /** Top-level error if the WAL could not be read at all. */
  error?: string;
}

/** Result of replaying and then compacting the WAL. */
export interface ReplayAndCompactResult {
  /** Result of the replay phase. */
  replay: ReplayResult;
  /** Result of the compaction phase (runs after replay). */
  compact: WALCompactResult;
}

/** Payload written for dead-lettered WAL entries. */
export interface DeadLetterPayload {
  /** operationId of the original entry that was dead-lettered. */
  originalOperationId: string;
  /** The WALEntryType of the original entry. */
  originalType: string;
  /** Number of times the entry was attempted. */
  failureCount: number;
  /** Error message from the last failed attempt. */
  lastError?: string;
  /** ISO 8601 timestamp of when the entry was dead-lettered. */
  deadLetteredAt: string;
}
