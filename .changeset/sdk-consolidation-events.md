---
"@centient/sdk": minor
---

Add a `consolidationEvents` client for engram's public consolidation-events
surface (engram-server #938/#939), retiring the last `asInternal()` seam for the
memory-consolidation lifecycle (issue #135).

engram 0.41.0 lifted the consolidation lifecycle (score → route →
promote/queue/drop, plus the 60-day soft-revert undo) out of the localhost-admin
seam onto a public `/v1` router, written so the SDK could expose typed methods.
This wraps that surface as `client.consolidationEvents` — read-mostly with two
**constrained** write actions (the raw `create` / status-`PATCH` transitions are
deliberately NOT exposed by the server, so the SDK does not fabricate them):

- `listBySession(sessionId)` → `GET /v1/sessions/:id/consolidation-events` — a session's events, newest first (read-scoped).
- `listByStatus(status)` → `GET /v1/consolidation-events?status=…` — the review queue by lifecycle status; the review queue is `status: "pending"` (read-scoped).
- `get(id)` → `GET /v1/consolidation-events/:id` — one event; 404 → `NotFoundError` (read-scoped).
- `consolidate(sessionId, { strategy?, dryRun? })` → `POST /v1/sessions/:id/consolidate` — run a pass; a bare call is a **safe dry-run preview** (no mutations), `dryRun: false` runs live. `triggeredBy` is always `manual`. Write-scoped (403 `AUTH_FORBIDDEN` for a read-only key).
- `undo(id)` → `POST /v1/consolidation-events/:id/undo` — 60-day soft-revert; typed failures 404 `RES_NOT_FOUND`, 409 `RES_CONFLICT` (`NOT_UNDOABLE` | `UNDO_WINDOW_EXPIRED`, reason in `error.details.reason`). Write-scoped.

New exported types: `ConsolidationEvent`, `ConsolidationResult`,
`ConsolidationUndoResult`, `ConsolidationPromotionAdvisory`,
`ConsolidationStatus`, `ConsolidationStrategy`, `ConsolidationTrigger`,
`ConsolidateParams`.

Reads route through the shared response-shape guards: the lists validate the
STRICT `{ data: [], meta.pagination }` envelope — `total` and `hasMore` are
required contract fields (the server always emits them; no silent
`data.length`/`false` fallback), and the routes accept no `limit`/`offset` (the
full set is always one page) — while `get`/`consolidate`/`undo` validate their
contract fields (`id`/`status`, `consolidationId`/`status` plus the nested
`promotionAdvisory` and its id lists/`strategyUsed`/`dryRun`, and the undo
counts) so a drifted body throws `ResponseShapeError` rather than returning a
malformed record (P-no-silent-degradation).

**Server floor is per-feature, not a client-wide bump.** `MIN_SERVER_VERSION`
stays **0.31.0**; these methods require engram-server **>= 0.41.0** (documented
in the new README compatibility table alongside the existing 0.34.0 vacuum /
skip-embedding / shimmer floors — the same per-feature pattern). Against an older
server the routes 404. Zero new runtime dependencies. 24 new resource tests
cover the happy paths, status query-param serialization, each consolidate body
branch (bare, strategy-only, dryRun-only, both), `hasMore: true` pass-through,
404/403/409 mappings, and envelope/contract-drift `ResponseShapeError`s
(including missing pagination and a reshaped `promotionAdvisory`).
