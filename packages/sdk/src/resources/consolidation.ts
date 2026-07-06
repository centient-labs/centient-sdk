/**
 * Consolidation-events Resource (engram `/v1/consolidation-events`,
 * engram-server #938 / #939).
 *
 * Typed wrappers over the public consolidation-lifecycle surface engram 0.41.0
 * lifted out of the localhost-admin seam so the SDK no longer needs
 * `asInternal()`. The surface is read-mostly with two CONSTRAINED write actions
 * — the raw create / status-PATCH transitions are intentionally NOT exposed by
 * the server (a public create would fabricate events bypassing scoring/routing;
 * a public status PATCH would corrupt the lifecycle state machine).
 *
 * Endpoint mapping:
 *   - `listBySession(sessionId)` → GET  /v1/sessions/:id/consolidation-events
 *   - `listByStatus(status)`     → GET  /v1/consolidation-events?status=…
 *   - `get(id)`                  → GET  /v1/consolidation-events/:id  (404 → NotFoundError)
 *   - `consolidate(sessionId, …)`→ POST /v1/sessions/:id/consolidate   (WRITE-scoped)
 *   - `undo(id)`                 → POST /v1/consolidation-events/:id/undo (WRITE-scoped)
 *
 * The two POSTs require a WRITE-scoped key (a read-only key gets 403
 * AUTH_FORBIDDEN); the GET reads accept a read-scoped key. `consolidate` and
 * `undo` mutate the lifecycle.
 *
 * **Server floor:** requires engram-server >= 0.41.0 (the SDK's
 * `MIN_SERVER_VERSION` of 0.31.0 is a floor for the whole client; this is a
 * per-feature floor documented like `maintenance.vacuum()` @ 0.34.0 and the
 * shimmer surface). Against an older server these routes 404.
 *
 * Every response uses the standard `{ success, data }` envelope; lists use the
 * `{ data: [], meta.pagination }` paginated envelope. Contract drift on any read
 * throws {@link ResponseShapeError} — a malformed body fails loudly, never
 * silently masked (P-no-silent-degradation).
 */

import {
  isNumber,
  isString,
  requireArray,
  requireField,
  unwrapData,
  unwrapDataObject,
} from "../validate.js";
import type {
  ConsolidateParams,
  ConsolidationEvent,
  ConsolidationResult,
  ConsolidationStatus,
  ConsolidationUndoResult,
} from "../types/consolidation.js";
import { BaseResource } from "./base.js";

// Re-export the consolidation types so consumers can import them alongside the
// resource (and so `resources/index.ts` can surface them).
export type {
  ConsolidateParams,
  ConsolidationEvent,
  ConsolidationPromotionAdvisory,
  ConsolidationResult,
  ConsolidationStatus,
  ConsolidationStrategy,
  ConsolidationTrigger,
  ConsolidationUndoResult,
} from "../types/consolidation.js";

const RESOURCE = "consolidation-events";

/** The standard `{ success, data, meta? }` envelope (mirrors sibling resources). */
interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      hasMore?: boolean;
    };
  };
}

/**
 * Consolidation-events Resource — the memory-consolidation lifecycle (score →
 * route → promote/queue/drop, plus the 60-day soft-revert undo). Attached as
 * `client.consolidationEvents`.
 *
 * @example
 * ```typescript
 * // Preview a consolidation (safe dry-run — no mutations):
 * const preview = await client.consolidationEvents.consolidate(sessionId);
 * console.log(preview.promotionAdvisory.autoPromoted);
 *
 * // Run it live:
 * const run = await client.consolidationEvents.consolidate(sessionId, {
 *   strategy: "aggressive",
 *   dryRun: false,
 * });
 *
 * // Work the review queue:
 * const { events } = await client.consolidationEvents.listByStatus("pending");
 *
 * // Undo within 60 days:
 * await client.consolidationEvents.undo(run.consolidationId);
 * ```
 */
export class ConsolidationEventsResource extends BaseResource {
  /**
   * List every consolidation event for a session, newest first.
   *
   * @param sessionId - the session whose events to list
   * @returns the session's events plus pagination metadata
   * @throws {ResponseShapeError} on a body that violates the `{ data: [] }` envelope
   */
  async listBySession(sessionId: string): Promise<{
    events: ConsolidationEvent[];
    total: number;
    hasMore: boolean;
  }> {
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/consolidation-events`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<ConsolidationEvent[]>>(
      "GET",
      path,
    );
    const data = requireArray<ConsolidationEvent>(
      unwrapData(response, route, RESOURCE),
      route,
      RESOURCE,
    );
    return {
      events: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * List consolidation events in a given lifecycle `status`, newest first — the
   * review queue is `status: "pending"`. `status` is serialized into the query
   * string and validated server-side against the lifecycle enum (an unknown
   * value is a 400, not an empty list).
   *
   * @param status - the lifecycle status to filter by (required)
   * @returns the events in that status plus pagination metadata
   * @throws {ResponseShapeError} on a body that violates the `{ data: [] }` envelope
   */
  async listByStatus(status: ConsolidationStatus): Promise<{
    events: ConsolidationEvent[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams({ status });
    const path = `/v1/consolidation-events?${query.toString()}`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<ConsolidationEvent[]>>(
      "GET",
      path,
    );
    const data = requireArray<ConsolidationEvent>(
      unwrapData(response, route, RESOURCE),
      route,
      RESOURCE,
    );
    return {
      events: data,
      total: response.meta?.pagination?.total ?? data.length,
      hasMore: response.meta?.pagination?.hasMore ?? false,
    };
  }

  /**
   * Get a single consolidation event by id.
   *
   * @param id - the consolidation-event id
   * @throws {NotFoundError} 404 — no event with that id (`RES_NOT_FOUND`)
   * @throws {ResponseShapeError} on a body that violates the `{ data }` envelope
   *   or is missing the `id`/`status` contract fields
   */
  async get(id: string): Promise<ConsolidationEvent> {
    const path = `/v1/consolidation-events/${encodeURIComponent(id)}`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<ConsolidationEvent>>(
      "GET",
      path,
    );
    const obj = unwrapDataObject(response, route, RESOURCE);
    // Guard the contract fields so a drifted body fails loudly rather than
    // returning a malformed event that TypeErrors downstream.
    requireField(obj, "id", isString, route, RESOURCE);
    requireField(obj, "status", isString, route, RESOURCE);
    return obj as unknown as ConsolidationEvent;
  }

  /**
   * Run consolidation for a session. A bare call is a safe **dry-run preview**
   * (scores and routes the notes, returns the advisory, mutates nothing);
   * `dryRun: false` runs live (creates the event, links auto-promoted notes).
   * `triggeredBy` is always recorded `manual` — the server fixes it. WRITE-scoped.
   *
   * @param sessionId - the session to consolidate
   * @param params - optional `{ strategy, dryRun }` (defaults: `balanced`, dry-run)
   * @throws {EngramError} 403 — a read-only key (`AUTH_FORBIDDEN`)
   * @throws {ResponseShapeError} on a body missing the `consolidationId`/`status`
   *   contract fields
   */
  async consolidate(
    sessionId: string,
    params?: ConsolidateParams,
  ): Promise<ConsolidationResult> {
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/consolidate`;
    const route = `POST ${path}`;
    // Only send the fields the caller supplied; the server defaults strategy to
    // `balanced` and dryRun to `true` when omitted.
    const body: ConsolidateParams = {};
    if (params?.strategy !== undefined) body.strategy = params.strategy;
    if (params?.dryRun !== undefined) body.dryRun = params.dryRun;

    const response = await this.request<ApiSuccessResponse<ConsolidationResult>>(
      "POST",
      path,
      body,
    );
    const obj = unwrapDataObject(response, route, RESOURCE);
    requireField(obj, "consolidationId", isString, route, RESOURCE);
    requireField(obj, "status", isString, route, RESOURCE);
    return obj as unknown as ConsolidationResult;
  }

  /**
   * Undo a completed consolidation within the 60-day window — restores the
   * promoted notes to active and archives the linked crystals (a soft-revert,
   * not a hard delete). WRITE-scoped.
   *
   * @param id - the consolidation-event id to undo
   * @throws {EngramError} 403 — a read-only key (`AUTH_FORBIDDEN`)
   * @throws {NotFoundError} 404 — no event with that id (`RES_NOT_FOUND`)
   * @throws {EngramError} 409 (`RES_CONFLICT`) — the event is not undoable
   *   (already undone or not `completed`) or the 60-day window has expired; the
   *   specific reason is in `error.details.reason`
   *   (`NOT_UNDOABLE` | `UNDO_WINDOW_EXPIRED`)
   * @throws {ResponseShapeError} on a body missing the contract fields
   */
  async undo(id: string): Promise<ConsolidationUndoResult> {
    const path = `/v1/consolidation-events/${encodeURIComponent(id)}/undo`;
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<ConsolidationUndoResult>
    >("POST", path);
    const obj = unwrapDataObject(response, route, RESOURCE);
    requireField(obj, "consolidationId", isString, route, RESOURCE);
    requireField(obj, "undoneAt", isString, route, RESOURCE);
    requireField(obj, "restoredNoteCount", isNumber, route, RESOURCE);
    requireField(obj, "archivedCrystalCount", isNumber, route, RESOURCE);
    return obj as unknown as ConsolidationUndoResult;
  }
}
