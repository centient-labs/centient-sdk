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
 *   - `queue(params?)`           → GET  /v1/consolidations/queue  (>= 0.50.0; per-note scoring rows)
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

import { EngramError } from "../errors.js";
import {
  isBoolean,
  isNumber,
  isString,
  requireArray,
  requireField,
  requireObject,
  unwrapData,
  unwrapDataObject,
  type JsonObject,
} from "../validate.js";
import type {
  ConsolidateParams,
  ConsolidationEvent,
  ConsolidationQueueItem,
  ConsolidationQueueParams,
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
  ConsolidationQueueItem,
  ConsolidationQueueParams,
  ConsolidationQueueScoreBreakdown,
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
      cursor?: string;
    };
  };
}

/**
 * Validate the required `meta.pagination` contract on the two list routes and
 * return `{ total, hasMore }`.
 *
 * The server's consolidation list routes use the STRICT paginated envelope
 * (engram-server `paginatedSchema` / the required-`total` `paginated()`
 * overload): `meta.pagination.total` and `meta.pagination.hasMore` are always
 * emitted. They are therefore validated as required contract fields — falling
 * back to `data.length` / `false` would silently mask a drifted envelope
 * (P-no-silent-degradation, mirroring `crystals.pendingMerges()`'s `total`
 * rationale). Note the routes accept NO `limit`/`offset` params — the full
 * event set is always returned in one page.
 */
function requirePagination(
  response: ApiSuccessResponse<unknown>,
  route: string,
): { total: number; hasMore: boolean } {
  const meta = requireObject(response.meta, route, RESOURCE);
  const pagination = requireObject(meta.pagination, route, RESOURCE);
  requireField(pagination, "total", isNumber, route, RESOURCE);
  requireField(pagination, "hasMore", isBoolean, route, RESOURCE);
  return {
    total: pagination.total as number,
    hasMore: pagination.hasMore as boolean,
  };
}

/**
 * Validate the queue route's `meta.pagination` contract and return it.
 *
 * `GET /v1/consolidations/queue` uses the standard limit/offset paginated
 * envelope: `total`, `limit`, and `hasMore` are REQUIRED by the response
 * schema and validated as contract fields (falling back would silently mask a
 * drifted envelope — P-no-silent-degradation); `offset` and `cursor` are
 * optional on the wire and passed through only when present (each type-checked
 * so a reshaped optional can't mistype the return).
 */
function requireQueuePagination(
  response: ApiSuccessResponse<unknown>,
  route: string,
): {
  total: number;
  limit: number;
  hasMore: boolean;
  offset?: number;
  cursor?: string;
} {
  const meta = requireObject(response.meta, route, RESOURCE);
  const pagination = requireObject(meta.pagination, route, RESOURCE);
  requireField(pagination, "total", isNumber, route, RESOURCE);
  requireField(pagination, "limit", isNumber, route, RESOURCE);
  requireField(pagination, "hasMore", isBoolean, route, RESOURCE);
  requireField(
    pagination,
    "offset",
    (v) => v === undefined || isNumber(v),
    route,
    RESOURCE,
  );
  requireField(
    pagination,
    "cursor",
    (v) => v === undefined || isString(v),
    route,
    RESOURCE,
  );
  return {
    total: pagination.total as number,
    limit: pagination.limit as number,
    hasMore: pagination.hasMore as boolean,
    ...(pagination.offset !== undefined
      ? { offset: pagination.offset as number }
      : {}),
    ...(pagination.cursor !== undefined
      ? { cursor: pagination.cursor as string }
      : {}),
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
   * List every consolidation event for a session, newest first. The route takes
   * no `limit`/`offset` — the server always returns the full set in one page.
   *
   * @param sessionId - the session whose events to list
   * @returns the session's events plus the server's `total`/`hasMore` contract fields
   * @throws {ResponseShapeError} on a body that violates the strict paginated
   *   `{ data: [], meta.pagination }` envelope (missing `total`/`hasMore` included)
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
    return { events: data, ...requirePagination(response, route) };
  }

  /**
   * List consolidation events in a given lifecycle `status`, newest first — the
   * review queue is `status: "pending"`. `status` is serialized into the query
   * string and validated server-side against the lifecycle enum (an unknown
   * value is a 400, not an empty list).
   *
   * @param status - the lifecycle status to filter by (required)
   * @returns the events in that status plus the server's `total`/`hasMore` contract fields
   * @throws {ResponseShapeError} on a body that violates the strict paginated
   *   `{ data: [], meta.pagination }` envelope (missing `total`/`hasMore` included)
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
    return { events: data, ...requirePagination(response, route) };
  }

  /**
   * List the per-note consolidation review queue, newest first —
   * `GET /v1/consolidations/queue` (note the route family is
   * `/v1/consolidations/*`, distinct from `/v1/consolidation-events`).
   *
   * Queue items are **per-note scoring rows** — one row per note routed to
   * `queued_for_review` by a live consolidation run, each carrying the
   * composite + coherence/uniqueness/quality score breakdown that routed it.
   * This is DISTINCT from `listBySession`/`listByStatus`, which return
   * event-level aggregates without per-note scores. Optional `sessionId` /
   * `status` filters narrow by the OWNING event; standard `limit`/`offset`
   * paging (`limit` 1–100, default 20; `offset` >= 0, default 0). READ-scoped.
   *
   * **Server floor:** requires engram-server >= 0.50.0 (engram-server
   * #1167/#1174). Against an older server the route 404s.
   *
   * @param params - optional `{ sessionId, status, limit, offset }` filters
   * @returns the queue items plus the server's pagination contract fields
   *   (`total`/`limit`/`hasMore` required; `offset`/`cursor` when emitted)
   * @throws {EngramError} `VALIDATION_INPUT_INVALID` — a `limit` outside
   *   1–100 or a negative/non-integer `offset` (rejected client-side before
   *   any request is made)
   * @throws {ResponseShapeError} on a body that violates the strict paginated
   *   `{ data: [], meta.pagination }` envelope, or an item missing any of its
   *   contract fields (the nested `scoreBreakdown` components included)
   */
  async queue(params?: ConsolidationQueueParams): Promise<{
    items: ConsolidationQueueItem[];
    total: number;
    limit: number;
    hasMore: boolean;
    offset?: number;
    cursor?: string;
  }> {
    // Client-side range checks mirroring the route's parameter schema
    // (limit: integer 1–100; offset: integer >= 0) — an out-of-range value is
    // a deterministic 400, so fail with a typed error before any request.
    if (params?.limit !== undefined) {
      if (
        !Number.isInteger(params.limit) ||
        params.limit < 1 ||
        params.limit > 100
      ) {
        throw new EngramError(
          "consolidationEvents.queue: limit must be an integer between 1 and " +
            "100 (the server defaults it to 20 when omitted).",
          "VALIDATION_INPUT_INVALID",
        );
      }
    }
    if (params?.offset !== undefined) {
      if (!Number.isInteger(params.offset) || params.offset < 0) {
        throw new EngramError(
          "consolidationEvents.queue: offset must be an integer >= 0 (the " +
            "server defaults it to 0 when omitted).",
          "VALIDATION_INPUT_INVALID",
        );
      }
    }

    const query = new URLSearchParams();
    if (params?.sessionId !== undefined) query.set("sessionId", params.sessionId);
    if (params?.status !== undefined) query.set("status", params.status);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const queryString = query.toString();
    const path = `/v1/consolidations/queue${queryString ? `?${queryString}` : ""}`;
    const route = `GET ${path}`;

    const response = await this.request<
      ApiSuccessResponse<ConsolidationQueueItem[]>
    >("GET", path);
    const rows = requireArray<unknown>(
      unwrapData(response, route, RESOURCE),
      route,
      RESOURCE,
    );
    // Shape-guard every row (and its nested scoreBreakdown) before casting —
    // callers read the score fields directly, so a drifted item must throw
    // ResponseShapeError, never surface as a downstream TypeError.
    for (const row of rows) {
      const item = requireObject(row, route, RESOURCE);
      requireField(item, "consolidationEventId", isString, route, RESOURCE);
      requireField(item, "noteId", isString, route, RESOURCE);
      requireField(item, "noteSummary", isString, route, RESOURCE);
      requireField(item, "noteType", isString, route, RESOURCE);
      requireField(item, "compositeScore", isNumber, route, RESOURCE);
      const breakdown = requireObject(item.scoreBreakdown, route, RESOURCE);
      requireField(breakdown, "coherence", isNumber, route, RESOURCE);
      requireField(breakdown, "uniqueness", isNumber, route, RESOURCE);
      requireField(breakdown, "quality", isNumber, route, RESOURCE);
      requireField(item, "strategy", isString, route, RESOURCE);
      requireField(item, "status", isString, route, RESOURCE);
      requireField(item, "createdAt", isString, route, RESOURCE);
    }
    return {
      items: rows as ConsolidationQueueItem[],
      ...requireQueuePagination(response, route),
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
   *   contract fields, or whose nested `promotionAdvisory` is absent/reshaped
   *   (its id lists, `strategyUsed`, and `dryRun` are validated too)
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
    // The nested advisory is part of the run contract — callers read its id
    // lists directly, so validate the object AND its sub-fields with the same
    // rigor as the top-level fields (a reshaped advisory must throw
    // ResponseShapeError, never surface as a downstream TypeError).
    const advisory: JsonObject = requireObject(obj.promotionAdvisory, route, RESOURCE);
    requireField(advisory, "autoPromoted", Array.isArray, route, RESOURCE);
    requireField(advisory, "queued", Array.isArray, route, RESOURCE);
    requireField(advisory, "dropped", Array.isArray, route, RESOURCE);
    requireField(advisory, "strategyUsed", isString, route, RESOURCE);
    requireField(advisory, "dryRun", isBoolean, route, RESOURCE);
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
