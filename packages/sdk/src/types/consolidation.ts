/**
 * Consolidation-events Types (engram `/v1/consolidation-events`, engram-server
 * #938 / #939).
 *
 * The memory-consolidation lifecycle — score the session's notes, route each to
 * promote / review-queue / drop, and record a `ConsolidationEvent` (undoable for
 * 60 days) — lives entirely in engram-server's `ConsolidationService`. engram
 * 0.41.0 lifted it onto a public `/v1` surface so the SDK can expose typed
 * methods instead of the old `asInternal()` seam.
 *
 * The surface is deliberately read-mostly with two CONSTRAINED write actions:
 *  - **reads** — list a session's events, list by lifecycle status (the review
 *    queue), get one by id.
 *  - **writes** — `consolidate` (run a dry-run preview or a live pass; the
 *    service owns event creation) and `undo` (60-day soft-revert). The raw
 *    `create` / `updateStatus` transitions are NOT exposed — a public create
 *    would fabricate events that bypass scoring/routing, and a public status
 *    PATCH would let a client corrupt the lifecycle state machine.
 *
 * Every date column is serialized to an ISO-8601 string on the wire.
 *
 * **Server floor:** these methods require engram-server >= 0.41.0. The SDK's
 * `MIN_SERVER_VERSION` floor (0.31.0) is unchanged — this is a per-feature floor
 * (as with `maintenance.vacuum()` / `skipEmbedding`-on-create @ 0.34.0 and the
 * shimmer surface). Against an older server the `/v1/consolidation-events`
 * routes 404.
 */

/**
 * Lifecycle status of a consolidation event. Service-owned — a client never
 * sets it directly.
 *  - `pending` — created but not yet executed (the review queue is this status).
 *  - `in_progress` — executing, or just executed on a live run.
 *  - `completed` — finished; undoable within the 60-day window.
 *  - `failed` — the run errored.
 *  - `undone` — soft-reverted.
 */
export type ConsolidationStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "undone";

/**
 * Routing-threshold strategy — controls the auto-promote / review / drop
 * cutoffs. Defaults to `balanced` when omitted on a run request.
 */
export type ConsolidationStrategy = "conservative" | "balanced" | "aggressive";

/**
 * What triggered a consolidation event. A public `consolidate()` call is always
 * recorded as `manual` (the server fixes it; the client cannot set it).
 */
export type ConsolidationTrigger = "finalization" | "manual" | "threshold";

/**
 * A consolidation event — the record of one consolidation pass over a session's
 * notes. Date columns arrive as ISO-8601 strings.
 */
export interface ConsolidationEvent {
  /** Event id (UUID). */
  id: string;
  /** The session this event consolidated (UUID). */
  sessionId: string;
  /** The routing strategy the run used. */
  strategy: ConsolidationStrategy;
  /** Lifecycle status (service-owned). */
  status: ConsolidationStatus;
  /** What triggered the event. */
  triggeredBy: ConsolidationTrigger;
  /** Count of notes auto-promoted to crystals. */
  promotedCount: number;
  /** Count of notes queued for human review. */
  queuedCount: number;
  /** Count of notes dropped. */
  droppedCount: number;
  /** Ids of the auto-promoted notes. */
  promotedItemIds: string[];
  /** Ids of the queued notes. */
  queuedItemIds: string[];
  /** Ids of the dropped notes. */
  droppedItemIds: string[];
  /** True when this event was a dry-run preview (no mutations, no undo). */
  dryRun: boolean;
  /** ISO-8601 timestamp the event was undone, or `null`. */
  undoneAt: string | null;
  /** Id of the inverse event recording the undo, or `null`. */
  undoneBy: string | null;
  /** ISO-8601 deferral timestamp, or `null`. */
  deferredUntil: string | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 completion timestamp, or `null`. */
  completedAt: string | null;
}

/**
 * The advisory block a run produces (dry-run or live) — how each scored note was
 * routed. Mirrors the event counts as id lists.
 */
export interface ConsolidationPromotionAdvisory {
  /** Ids auto-promoted to crystals. */
  autoPromoted: string[];
  /** Ids queued for human review. */
  queued: string[];
  /** Ids dropped. */
  dropped: string[];
  /** The strategy the run actually used. */
  strategyUsed: ConsolidationStrategy;
  /** True on a dry-run preview. */
  dryRun: boolean;
}

/**
 * The result of a `consolidate()` run. On a dry-run `consolidationId` is the
 * sentinel `"dry-run"` and `status` is `pending` (no event is created); on a
 * live run `consolidationId` is the created event id and `status` is
 * `in_progress`.
 */
export interface ConsolidationResult {
  /** Created event id on a live run, or the sentinel `"dry-run"` on a preview. */
  consolidationId: string;
  /** `pending` on a dry-run; `in_progress` on a live run. */
  status: ConsolidationStatus;
  /** Count of notes auto-promoted. */
  promotedCount: number;
  /** Count of notes queued for review. */
  queuedCount: number;
  /** Count of notes dropped. */
  droppedCount: number;
  /** Ids of the auto-promoted notes. */
  promotedItemIds: string[];
  /** Ids of the queued notes. */
  queuedItemIds: string[];
  /** Ids of the dropped notes. */
  droppedItemIds: string[];
  /** True when this was a dry-run preview. */
  dryRun: boolean;
  /** The routing advisory for this run. */
  promotionAdvisory: ConsolidationPromotionAdvisory;
}

/**
 * The result of an `undo()` — the linked notes/crystals restored/archived by the
 * soft-revert.
 */
export interface ConsolidationUndoResult {
  /** The event that was undone (UUID). */
  consolidationId: string;
  /** ISO-8601 timestamp the undo was applied. */
  undoneAt: string;
  /** Count of session notes restored to active. */
  restoredNoteCount: number;
  /** Count of crystals archived by the revert. */
  archivedCrystalCount: number;
}

/**
 * The component scores behind a queue item's `compositeScore`
 * (composite = coherence·0.4 + uniqueness·0.3 + quality·0.3).
 */
export interface ConsolidationQueueScoreBreakdown {
  /** Coherence component score. */
  coherence: number;
  /** Uniqueness component score. */
  uniqueness: number;
  /** Quality component score. */
  quality: number;
}

/**
 * One row of the per-note consolidation review queue
 * (`GET /v1/consolidations/queue`, engram-server >= 0.50.0).
 *
 * Queue items are **per-note scoring rows** — one row per note routed to
 * review, each carrying the composite + component score breakdown that routed
 * it. This is DISTINCT from the consolidation-events list
 * (`listBySession`/`listByStatus`), which returns event-level aggregates
 * without per-note scores.
 */
export interface ConsolidationQueueItem {
  /** The owning consolidation event (UUID). */
  consolidationEventId: string;
  /** The queued note (UUID). */
  noteId: string;
  /** First 200 chars of the note content (display summary). */
  noteSummary: string;
  /** The note's type. */
  noteType: string;
  /**
   * The composite promotion score (coherence·0.4 + uniqueness·0.3 +
   * quality·0.3) that routed the note to review.
   */
  compositeScore: number;
  /** The component scores behind the composite. */
  scoreBreakdown: ConsolidationQueueScoreBreakdown;
  /** The routing strategy the owning event's run used. */
  strategy: ConsolidationStrategy;
  /** Lifecycle status of the OWNING consolidation event. */
  status: ConsolidationStatus;
  /** ISO-8601 timestamp the score was recorded (run time). */
  createdAt: string;
}

/**
 * Query parameters for `consolidationEvents.queue()`
 * (`GET /v1/consolidations/queue`). All optional.
 */
export interface ConsolidationQueueParams {
  /** Restrict the queue to notes routed by consolidation events of this session (UUID). */
  sessionId?: string;
  /** Restrict to items whose OWNING event is in this lifecycle status. */
  status?: ConsolidationStatus;
  /** Page size, 1–100. Server default: 20. */
  limit?: number;
  /** Zero-based row offset. Server default: 0. */
  offset?: number;
}

/**
 * Parameters for a `consolidate()` run. Both are optional — a bare call is a safe
 * dry-run preview with the `balanced` strategy.
 */
export interface ConsolidateParams {
  /** Routing strategy. Defaults to `balanced` server-side when omitted. */
  strategy?: ConsolidationStrategy;
  /**
   * When `true` (the default), preview only: score and route the notes and
   * return the advisory WITHOUT creating an event or mutating any note. When
   * `false`, run live: create the event and link the auto-promoted notes. Safe
   * by default — the destructive live run is explicit `dryRun: false`.
   */
  dryRun?: boolean;
}
