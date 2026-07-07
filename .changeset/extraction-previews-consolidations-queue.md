---
"@centient/sdk": minor
---

Typed methods for the three g8-residual surfaces that shipped in engram-server 0.50.0 (issue #143, items 1–3):

- `extraction.bootstrapPreview(params)` — enumerate all un-extracted sources of a `sourceType` with count + cost estimates (`POST /v1/extraction/extract` with `bootstrap: true`; 200 preview, not the 201 job). Optional `confirm` actually enqueues jobs (response then carries `jobsEnqueued`, required by the guard on confirm), `since` (ISO-8601 lower bound, server default 90 days back), and `estimatedCostPerCall` (> 0, server default 0.002).
- `extraction.dryRunPreview(params)` — project entity counts for one source from observed history (`dryRun: true`; 200 projection, read-only, no model run). Returns `entityCountByClass` (empty = explicit zero-history), `estimatedEntityCount`, `estimatedCostUsd`.
- `consolidationEvents.queue(params?)` — `GET /v1/consolidations/queue` (route family distinct from `/v1/consolidation-events`): the per-note review-queue rows with composite + coherence/uniqueness/quality score breakdowns, with `sessionId`/`status` filters and `limit`/`offset` paging.

The wire's semantic prerequisites are enforced client-side with typed `VALIDATION_INPUT_INVALID` errors before any request is made: bootstrap must not carry a `sourceId`, dry-run requires one, the two modes are mutually exclusive (including flags smuggled past TypeScript into `extract()`, whose single-enqueue behavior is otherwise unchanged), `estimatedCostPerCall` must be > 0, and queue `limit`/`offset` are range-checked (1–100 / >= 0). Every schema-required response field — nested `sources[]` entries, `entityCountByClass` values, and `scoreBreakdown` components included — is shape-guarded; drift throws `ResponseShapeError`.

Items 4 (raw consolidation-event create) and 5 (review status-PATCH) did NOT ship in 0.50.0 and remain deliberately unimplemented (parked on engram-server#1167).

Extraction previews and the consolidations queue read require engram-server >= 0.50.0 (per-feature floor; the routes 404 on older servers).
