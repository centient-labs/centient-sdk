# Changelog

## 2.3.0

### Minor Changes

- 00d43d6: Typed methods for the three g8-residual surfaces that shipped in engram-server 0.50.0 (issue #143, items 1–3):

  - `extraction.bootstrapPreview(params)` — enumerate all un-extracted sources of a `sourceType` with count + cost estimates (`POST /v1/extraction/extract` with `bootstrap: true`; 200 preview, not the 201 job). Optional `confirm` actually enqueues jobs (response then carries `jobsEnqueued`, required by the guard on confirm), `since` (ISO-8601 lower bound, server default 90 days back), and `estimatedCostPerCall` (> 0, server default 0.002).
  - `extraction.dryRunPreview(params)` — project entity counts for one source from observed history (`dryRun: true`; 200 projection, read-only, no model run). Returns `entityCountByClass` (empty = explicit zero-history), `estimatedEntityCount`, `estimatedCostUsd`.
  - `consolidationEvents.queue(params?)` — `GET /v1/consolidations/queue` (route family distinct from `/v1/consolidation-events`): the per-note review-queue rows with composite + coherence/uniqueness/quality score breakdowns, with `sessionId`/`status` filters and `limit`/`offset` paging.

  The wire's semantic prerequisites are enforced client-side with typed `VALIDATION_INPUT_INVALID` errors before any request is made: bootstrap must not carry a `sourceId`, dry-run requires one, the two modes are mutually exclusive (including flags smuggled past TypeScript into `extract()`, whose single-enqueue behavior is otherwise unchanged), `estimatedCostPerCall` must be > 0, and queue `limit`/`offset` are range-checked (1–100 / >= 0). Every schema-required response field — nested `sources[]` entries, `entityCountByClass` values, and `scoreBreakdown` components included — is shape-guarded; drift throws `ResponseShapeError`.

  Items 4 (raw consolidation-event create) and 5 (review status-PATCH) did NOT ship in 0.50.0 and remain deliberately unimplemented (parked on engram-server#1167).

  Extraction previews and the consolidations queue read require engram-server >= 0.50.0 (per-feature floor; the routes 404 on older servers).

- cd7f4c4: Model the engram-server 0.50.0 health discriminated unions and add `healthReady()` (#145).

  `HealthResponse`, `DetailedHealthResponse`, and the new `ReadyResponse` are now discriminated unions matching what the server actually returns since 0.50.0 (engram-server #1175), and the three health methods parse the typed body from BOTH HTTP 200 and 503 — a health 503 resolves with the degraded/unhealthy/not-ready variant instead of being retried and thrown as an opaque error. Each variant is guarded at runtime (`ResponseShapeError` on contract drift, nested `postgres`/`recovery` objects included).

  Migration notes for existing callers:

  - `HealthResponse` is now `HealthOkResponse | HealthDegradedResponse | HealthUnhealthyResponse` — narrow on `status` to reach the variant-only fields (`error`, `errorCode`, `recovery`, `recoveryHint`). `status` and `version` remain present on every variant.
  - `DetailedHealthResponse` is now `DetailedHealthOkResponse | DetailedHealthDegradedResponse` — `{status, version, postgres, uptime?, embedding?, migrations?}` (+ `recovery?` on degraded; `status: "unhealthy"` maps to the degraded variant). The old `{uptime: number, dependencies, circuitBreakers, rateLimiters}` field set matched nothing 0.50.0 returns; note `uptime` is now a **string**. The orphaned `DependencyHealth`, `CircuitBreakerStats`, and `RateLimiterStats` type exports are now **deprecated** (not removed — existing imports keep compiling on this minor): 0.50.0 servers never return these shapes, so they are retained for compile compatibility only and will be removed in the next major.
  - New `client.healthReady()` calls `GET /v1/health/ready` and returns `ReadyTrueResponse | ReadyFalseResponse` (narrow on the boolean `ready`; the false variant guarantees only `reason`).
  - `client.health()` / `healthDetailed()` / `healthReady()` no longer throw on a health 503 — check `status` / `ready` on the resolved value instead. Non-503 errors (401 on the auth-gated routes, proxy 5xx) keep the previous typed-error and retry behavior.
  - `checkCompatibility()` now calls `/v1/health` (the bare `/health` alias is not in the 0.50.0 spec) and still resolves against a degraded server, since every variant carries `version`.

  Requires engram-server >= 0.50.0 for the union shapes; older servers return the flat pre-union bodies, which the new guards reject with `ResponseShapeError`.

- ff10de7: Add `client.invitations` — the ADR-044 invite/provisioning/connection lifecycle (engram-server >= 0.50.0).

  Authenticated (inviter/admin side): `list`, `create`, `get`, `revoke`, `resend`, `retryBindings`, `listReceived`. Public token-addressed (invitee side): `redeemPreview`, `accept`, `decline` — callable from a client constructed with no `apiKey`/`userId` (the token is the credential; the SDK attaches auth headers only when configured).

  New types: `InvitationSummary`, `InvitationBinding`, `InvitationCreateResponse`, `InvitationTokenReveal`, `RedeemPreview`, `AcceptInvitationResponse` (`AcceptedUser`/`AcceptedKey`), `ReceivedInvitation`, `CreateInvitationParams`, `AcceptInvitationParams`, plus the distinct `InvitationState` (5 values, incl. derived `expired`) and `InvitationStatus` (4 stored values) enums. `reveal.token` and `key.value` are ONE-TIME secrets (never re-fetchable; `resend` rotates the token) and their guards fail loudly if a response drops them.

  New `GoneError` (410) in the `parseApiError` ladder — a dead/expired/consumed invitation token surfaces typed (`instanceof GoneError`, server `INVITE_*` code preserved) instead of a bare `EngramError`.

  Every wire field is required in the 0.50.0 schema, so the response guards assert PRESENCE (nullable fields must arrive as explicit `null`); the two lists validate the strict paginated `{ success, data, meta.pagination }` envelope. Requires engram-server >= 0.50.0 (per-feature floor; the client-wide `MIN_SERVER_VERSION` stays 0.31.0).

## 2.2.0

### Minor Changes

- bb293ca: Fix `parseApiError` so the thrown error CLASS is a function of the HTTP status,
  not the response envelope shape (issue #117).

  The nested error envelope `{ error: { code, message, details? } }` was handled
  in a branch that ran before the `switch (statusCode)` mapping and — for every
  code other than the two shimmer special-cases — threw a base `EngramError`. As
  a result the `404 → NotFoundError` / `401 → UnauthorizedError` /
  `409 → CrystalVersionConflictError` / `500 → InternalError` mappings only fired
  for the flat `{ code, message }` body shape, never for the nested envelope. In
  practice engram's nested `404 RES_NOT_FOUND` ("no live shimmer") was thrown as a
  base `EngramError`, so consumers catching `NotFoundError` to detect a healthy
  "route live, record absent" 404 misclassified it (broke mbot's ADR-031
  shimmer-heartbeat probe against engram 0.42.0 + @centient/sdk 2.1.0).

  Both envelope branches now route through one shared `errorForCode` helper that
  maps `code` + `statusCode` to the typed class, so a nested-envelope 404 is
  `instanceof NotFoundError` exactly like a flat-body 404. The typed shimmer
  special-cases (`SHIMMER_CAS_CONFLICT`, `SHIMMER_DISABLED`) and the
  `OPERATION_VERSION_CONFLICT` CAS case still map to their typed errors. The
  server's original `code` and `details` are preserved on the status-keyed classes
  (`NotFoundError`/`UnauthorizedError`/`InternalError` gained optional
  `code`/`details` params), so a nested `RES_NOT_FOUND` 404 is both
  `instanceof NotFoundError` AND keeps `code === "RES_NOT_FOUND"`. A generic 409
  (e.g. `SYNC_SCHEMA_VERSION_MISMATCH`) stays a base `EngramError` carrying its
  real code/message/details rather than being rewritten into a `SessionExistsError`.

  **Minor (not patch) — additive public-API surface.** The public error
  constructors `NotFoundError`, `UnauthorizedError`, and `InternalError` gain two
  optional trailing params, `(message, code?, details?)`, so the server's original
  `code`/`details` can be preserved when routed through `parseApiError`. The change
  is backward-compatible — the `code` defaults match the previously-hardcoded
  values (`NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL_ERROR`) and `details` defaults to
  `undefined` — so existing call sites and `new NotFoundError(msg)` usages behave
  identically. Because the public type signatures of exported error classes
  changed (a new, larger callable surface), this is released as a **minor** bump
  rather than a patch.

- f96eb0b: Fix `CrystalVersionConflictError.currentVersion` being `NaN` against real
  servers, and expose the server's `tagsMatch` + `type_metadata` containment
  filters on `crystals.list` (issue #136 — persona-sdk adoption blockers).

  **Fix — CAS `currentVersion` read from the wrong envelope level.** On an
  `expectedVersion` mismatch, engram-server's PATCH route returns
  `409 OPERATION_VERSION_CONFLICT` with the version nested at
  `error.details.currentVersion` (ADR-041 / engram-server#60):
  `{ success: false, error: { code, message, details: { currentVersion } } }`.
  `parseApiError` read `currentVersion` only off the TOP-LEVEL body, so every
  real server yielded `currentVersion: NaN` — silently breaking the
  merge-and-retry pattern documented on the error class itself. The CAS branch
  now reads `error.details.currentVersion` first and falls back to the
  top-level body for older/bare-body servers; both absent still surfaces `NaN`
  (detectable via `Number.isNaN`). All existing defensiveness is preserved
  (null-prototype objects and throwing getters yield the fallback/NaN, never an
  unhandled throw out of error parsing).

  **Feature — exact tag/metadata filtering on `crystals.list`.**
  `ListKnowledgeCrystalsParams` gains:

  - `tagsMatch?: "any" | "all"` — tag-filter semantics (engram-server#866).
    `"all"` requires a crystal to carry EVERY requested tag; the server default
    stays ANY-of. Serialized as the `tagsMatch` query param.
  - `typeMetadata?: Record<string, unknown>` — JSONB containment filter on
    `type_metadata` (engram ADR-042 D5, GIN-indexed). Serialized as the
    server's `metadataContains` query param (a URL-encoded JSON object bound to
    a single `@>` predicate). An explicit `{}` is a valid vacuous filter and is
    sent on the wire.

  Both are list-only: the server's `POST /v1/crystals/search` body does not
  accept tag-match semantics or metadata containment, so the SDK does not
  pretend it does.

  Also documents (client config JSDoc + README) that against a no-auth engram
  daemon the caller should omit `apiKey` entirely — such a daemon accepts
  key-less requests but rejects a provided placeholder key with 401; the SDK
  only sends `X-API-Key` when `apiKey` is truthy.

  **Minor (not patch)** — the new optional list params are additive public-API
  surface; the CAS fix rides along.

- da2411e: Add a `consolidationEvents` client for engram's public consolidation-events
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

## 2.1.0

### Minor Changes

- 3474f8c: Add category-wide runtime response-shape validation (closes #62).

  Every resource read path now routes through a single internal boundary
  validator (`src/validate.ts`, `@internal`, stripped from the published `.d.ts`)
  covering the three response families — the standard `{ data, meta }` envelope,
  the sync `{ success, data }` envelope, and bare peers/maintenance bodies. The
  hand-rolled guards #64 added to the sync resource are generalized into shared,
  zero-dependency structural guards (no zod).

  Malformed 2xx bodies (truncated, `null`, or wrong-typed fields) now throw a new
  typed `ResponseShapeError` (extends `EngramError`) carrying the failing request
  `path` and `resource` name, instead of surfacing as a downstream `TypeError` at
  the call site. The error is **non-retryable** — a malformed body is
  deterministic, so the request layer makes exactly one `fetch` before throwing.

  The only public-surface addition is the `ResponseShapeError` class; all
  validation helpers stay internal.

- bbe5d15: retry: adopt `@centient/resilience` backoff + export `isRetryableError` (behaviour-preserving)

  ## Added — `isRetryableError(err): boolean`

  The SDK now exports the same predicate its request loop uses to decide whether a
  caught error is worth re-issuing, so downstream consumers (centient, mbot,
  test-kit) no longer have to hand-roll the classification by string-matching
  error messages:

  ```typescript
  import { isRetryableError } from "@centient/sdk";

  try {
    await client.search(sessionId, { query });
  } catch (err) {
    if (isRetryableError(err)) {
      // transient — back off and try again
    } else {
      throw err; // terminal
    }
  }
  ```

  - **Retryable** (`true`): a 5xx `EngramError`, or a raw transport `Error` (e.g. a
    `fetch` `TypeError` / `ECONNREFUSED`).
  - **Non-retryable** (`false`): `TimeoutError`, `NetworkError`,
    `ResponseShapeError`, any 4xx `EngramError`, and non-`Error` throwables.

  The client uses this helper internally for its 5xx retry decision, so there is a
  single source of truth.

  ## Changed — backoff now powered by `@centient/resilience` (behaviour-preserving)

  The client's private retry backoff is now delegated to
  `@centient/resilience`'s `createBackoff` (linear strategy, `jitterRatio` 0.5)
  instead of an inlined formula. This is **behaviour-preserving**: the resilience
  linear schedule is `attempt * retryDelay + random() * (0.5 * retryDelay)` —
  identical to the schedule the client has always used — and its default
  randomness source calls `Math.random()`, so timing and jitter are unchanged and
  existing jitter tests pass unmodified.

  This adds `@centient/resilience` as the SDK's first intra-monorepo `@centient`
  dependency (`workspace:*`). It is an internal composition — resilience exists
  precisely so the SDK consumes it — and does not add any **external** runtime
  dependency. The public surface is otherwise unchanged (the `isRetryableError`
  export is purely additive).

- be359b2: Raise `engines.node` to `>=20.0.0` (was `>=18.0.0`).

  The SDK's per-request timeout and connection-establishment abort are built on
  the global `fetch` API with `AbortController` / `AbortSignal`. Those WHATWG
  `fetch` semantics are what the timeout and abort paths depend on, and the rest
  of the monorepo (`@centient/events`, `@centient/wal`) plus the repo's stated
  support floor already require Node 20. This aligns the SDK's declared floor with
  the runtime it is actually built and tested against and makes the dependency on
  conformant global `fetch`/`AbortSignal` explicit.

  No source, type, or runtime-behavior change — but raising the published
  `engines.node` floor is **consumer-visible**: the last published `@centient/sdk`
  declares `>=18.0.0`, so Node 18 installers will now see an `EBADENGINE` warning
  (and a hard failure under `--engine-strict`). That is a tightening of the
  supported-runtime contract, so this ships as a **minor** bump rather than a
  patch.

- 14a05ac: Public, typed resource methods for the dedup/merge endpoints previously reachable
  only through the `@internal` `_request` helper (issue #81). This enables centient
  to migrate off `asInternal()` — the migration itself is a separate centient-repo PR.

  New methods (all route through the existing request/validation seam; the merge
  routes return bare `{ success, ... }` payloads that are shape-guarded, not the
  standard `{ data }` envelope):

  - `notes.dedup(id, { mergeMethod?, threshold? })` — POST `/v1/notes/:id/dedup`;
    returns `{ action, mergeId, confidence, canonicalId }` (snake_case wire fields
    normalized to camelCase).
  - `crystals.pendingMerges({ sessionId?, limit? })` — GET
    `/v1/crystals/merges/pending`; deferred merge candidates awaiting review.
  - `crystals.reviewMerge(mergeId, { decision, mergedContent? })` — POST
    `/v1/crystals/merges/:id/review`; approve / reject / modify a deferred merge.
  - `crystals.mergeHistory(itemId)` — GET `/v1/crystals/merges/history/:id`;
    full merge provenance chain for a note or crystal.

  The bare-payload shape guards are strict: a missing/non-numeric `total` on
  `pendingMerges`/`mergeHistory`, a wrong-typed `merge_id`/`confidence`/`canonical_id`
  on `dedup`, or a non-string `targetCrystalId` on `reviewMerge` throws
  `ResponseShapeError` (contract drift fails loudly) rather than being silently
  masked or passed through. An empty-string `targetCrystalId` is normalized to
  absent.

  New exported types: `NoteDedupAction`, `DedupNoteParams`, `DedupNoteResult`,
  `DedupMergeMethod`, `DedupMergeOutcomeStrategy`, `PendingMerge`,
  `ListPendingMergesParams`, `MergeRecord`, `MergeReviewDecision`,
  `ReviewMergeParams`, `ReviewMergeResult`.

  Note: the consolidation-lifecycle endpoints and a `GET /v1/ambient-context`
  route named in #81 are not yet exposed by engram-server, so no SDK methods were
  added for them (`agents.get()` and `ambientContext.get()` already exist).

- d190275: Add `client.shimmers` — typed client methods wrapping engram's `/v1/shimmers`
  API (ADR-027; engram-server #931, #933). Shimmers are node-local, TTL-backed
  operational state, with three record types (lock / heartbeat / ipc).

  Use-case-named methods:

  - `heartbeat(key, value, { ttlSeconds })` — unconditional overwrite + TTL
    liveness window (last-writer-wins, never CAS).
  - `acquireLock(key, { ownerToken, ttlSeconds, value? })` — acquire-if-free CAS;
    the returned record echoes back the caller's `ownerToken`.
  - `renewLock(key, { ownerToken, expectedRevision, ttlSeconds, value? })` —
    renew/CAS a held lock.
  - `releaseLock(key, { ownerToken })` — owner-guarded release.
  - `emitIpc(key, value, { ttlSeconds })` — post a write-once ipc message.
  - `consumeIpc(key)` — atomic exactly-once consume; returns the consumed record
    or `null`.
  - `get(key, recordType)` — TTL-filtered read; the result type (`ShimmerRead`)
    carries no `ownerToken` (always `null` on a read — engram-server #933 P1).

  New typed errors: `ShimmerCasConflictError` (409 `SHIMMER_CAS_CONFLICT` — lock
  contention or ipc write-once collision; the holder's token is never exposed) and
  `ShimmerDisabledError` (503 `SHIMMER_DISABLED` — the surface is gated behind
  `ENGRAM_SHIMMER_ENABLED`). New exported types: `Shimmer`, `ShimmerRead`,
  `ShimmerRecordType`, `ShimmerDeleteResult`, and the lock param types.

  The entire shimmer surface (reads included) requires a write-scoped key
  (engram-server #933 P2).

- 04aed0d: events: add `subscribeIter()` (AsyncIterable delivery) and harden the broken `subscribe()` path

  ## ⚠️ BREAKING-IN-SPIRIT — default behavior change to `events.subscribe()`

  `events.subscribe()` (the `EventSource` path) **now throws
  `InsecureEventSourceError` by default.** `EventSource` cannot send custom
  request headers, so the API key was computed but never transmitted —
  authentication silently failed against any authenticated endpoint (the
  canonical "No Silent Degradation" defect). That path was already marked
  `@deprecated` and documented broken, so this fixes a defect rather than removing
  a working contract; it is shipped as **minor** for that reason, but the default
  behavior change is flagged here prominently for the release procedure to
  arbitrate (escalate to major if release policy requires). The legacy behavior
  remains reachable, unauthenticated-only, behind an explicit opt-in:

  ```typescript
  client.events.subscribe(types, onEvent, onError, {
    allowInsecureEventSource: true,
  });
  ```

  Removal of `subscribe()` is reserved for 3.0.

  ## Added — `events.subscribeIter()` (AsyncIterable delivery)

  A pull-based counterpart to `subscribeWithFetch()`:

  ```typescript
  for await (const event of client.events.subscribeIter(["crystal.created"], {
    signal,
  })) {
    console.log(event.type, event.entity_id);
  }
  ```

  - Thin adapter over the existing hand-rolled SSE parser (push callback → pull
    iterator with a bounded internal queue). Zero new dependencies — does **not**
    import `@centient/events`.
  - Sends `X-API-Key` correctly. Mirrors the Python SDK's `events.subscribe_iter`.
  - Backpressure is **bounded, never silent**: if the consumer falls behind and
    the buffer exceeds `highWaterMark` (default `1024`), the iterator throws the
    new `EventStreamOverflowError` rather than dropping events.
  - Aborting via `options.signal` (or `break`ing the `for await` loop) ends the
    iterator cleanly and releases the underlying stream.

  ## Added — error classes

  - `InsecureEventSourceError` — thrown by `subscribe()` without the opt-in.
  - `EventStreamOverflowError` — thrown on the `subscribeIter()` iterator on overflow.

  Both are exported from the package barrel, alongside the new `SubscribeOptions`
  and `SubscribeIterOptions` option types and the `EngramEventStream` return-type
  alias for `subscribeIter()`.

### Patch Changes

- Updated dependencies [4262043]
  - @centient/resilience@0.1.0

## 2.0.0

### Major Changes

- 53a6702: Align the SDK with engram-server 0.34.0.

  **Breaking — sync resource realigned to the 0.34.0 wire contract.** The
  `/v1/sync` routes migrated to the standard `{success, data}` envelopes, and
  several SDK methods were mis-modeled against the old (v0.22.4-era) shapes:

  - `SyncStatus` now reflects the real payload: `{ instanceId, schemaVersion,
peersCount, activeLinksCount, changelogSize }` (previously `lastPushSeq` /
    `lastPullSeq` / `pendingChanges` / `conflictCount`, which the server never
    returned).
  - `push(changes)` / `pushTo(peer)` now return `{ counts, conflicts, duration }`
    where `counts` is `Record<entityType, { inserted, updated, skipped }>`
    (previously a flat `Record<string, number>` plus a `success` flag).
  - `push(changes)` sends the changelog as NDJSON (`application/x-ndjson`), and
    `SyncChange` now matches the serialized changelog-entry wire shape
    (`{ seq, entityType, entityId, operation, changedFields, previousValues,
createdAt }`).
  - `pull(params)` now requires `params.sinceSeq` (`string | null`) and parses
    the NDJSON response stream (the one sync route that is never enveloped).
  - `pullFrom(peer)` now returns `{ entriesStreamed, maxSeq, duration }` (apply
    counts), not a `SyncChange[]`.
  - `listConflicts()` returns `{ conflicts, total }` (the server sends them
    nested under `data`, with no pagination meta; the `hasMore` field is gone).

  **Breaking — sync peers + maintenance use bare (non-enveloped) responses.**
  The `/v1/sync/peers/*` routes (in the server's `links.ts`) and the
  `tombstoneCleanup`/`changelogCompact` maintenance routes return bare objects,
  not the `{ success, data }` envelope (verified against `engram-server` main):

  - `sync.peers.create()`/`get()` read `{ peer }`; `list()` reads `{ peers }`;
    `delete()` now returns `{ removed: true, name }` (was `{ deleted: true }`).
  - `maintenance.tombstoneCleanup()` / `changelogCompact()` now read the server's
    bare result directly instead of unwrapping a non-existent `.data` (they
    previously returned `undefined` against a real server).
  - `SyncChange.entityType`, `SyncPullParams.entityTypes`, and `SyncCounts` are
    now typed with the exported `SyncEntityType` union (`knowledge_crystals |
knowledge_crystal_edges | sessions | session_notes`).
  - New public types exported from the package root: `SyncEntityType`,
    `SyncCounts`, `SyncPullResult`, `VacuumParams`, `VacuumResult`.

  (Note: the rest of `/v1/sync` — `status`, `conflicts`, `push`, `pull-from`,
  `resolve` — does use the `{ success, data }` envelope; only the peers subtree
  and maintenance success bodies are bare.)

  **Added**

  - `skipEmbedding` on `crystals.create()` — defer embedding generation on
    high-throughput create paths (engram-server >= 0.34.0, #763).
  - `maintenance.vacuum({ full? })` — `POST /v1/maintenance/vacuum` to reclaim
    tombstone-table space (engram-server >= 0.34.0, #766). `full: true` requires
    an admin key.

  **Documented (no API change)**

  - `audit.ingest()` / `ingestBatch()` accept the server's new `202 Accepted`
    responses (engram-server >= 0.33.0).
  - A 409 `SYNC_SCHEMA_VERSION_MISMATCH` carries `{ peerVersion, ourVersion }` on
    `EngramError.details`.

### Minor Changes

- dadfafe: Add optional `logger` to `EngramClientConfig` for client-side request
  diagnostics. The client previously performed zero logging, so retries,
  timeouts, and network errors were invisible to consumers diagnosing hangs vs
  retry storms. With a logger injected, the client emits `debug` for each retry
  (attempt number, delay, error class, HTTP method + path) and `warn` when
  retries are exhausted or a request times out — across all four request paths
  (`request`, `_requestRaw`, `_requestRawBody`, `_requestFormData`).

  The logger contract is a minimal structural interface (`ClientLogger`,
  context-first `debug`/`warn`) that a `@centient/logger` instance satisfies
  directly — `@centient/logger` is NOT a runtime dependency (the SDK stays
  zero-dependency). Default is a no-op: without a logger the client emits
  nothing (no console fallback). All logged context is routed through sanitize
  helpers: method + pathname only — never headers (`X-API-Key`,
  `Authorization`), request bodies, query strings, or error messages (which can
  embed full URLs).

### Patch Changes

- 40b7a3b: Add jitter to retry backoff: every retry site now sleeps `retryDelay * attempt + Math.random() * retryDelay * 0.5` via a single `backoffDelay` method, so synchronized consumers no longer retry in lockstep against a struggling server.

  **Behavioral change:** retry delays were previously deterministic (`retryDelay * attempt` exactly); they are now randomized within `[retryDelay * attempt, retryDelay * attempt + 0.5 * retryDelay)`. The linear base budget is unchanged and the worst case adds at most `0.5 * retryDelay` per attempt, but tests or monitors that assert exact retry timing must either tolerate the jitter window or stub `Math.random()` to pin delays.

- b3b9fa2: Stop retrying deterministic JSON parse failures: `request()` and `_requestFormData()` now check `response.ok` before parsing the body, so a non-2xx response with a non-JSON body (e.g. a proxy HTML error page) surfaces as a status-typed ApiError instead of a retried SyntaxError, and a 2xx response with a non-JSON body fails fast with a non-retryable NetworkError carrying the status and the first 200 chars of the body (mirrors the existing `_requestRawBody` handling).
- f93ecdb: Harden `events.subscribeWithFetch` error handling: the void-launched SSE read loop can no longer produce an unhandled rejection (a throwing `onError` is swallowed after recording via a last-resort guard), every exit path now releases the stream reader (`finally` + `reader.cancel()`), a throwing `onEvent` now reaches `onError` as the actual consumer error (previously mislabeled as a malformed SSE frame) and closes the subscription, and `close()` after a failure stays idempotent.
- aaab764: Keep internal HTTP plumbing out of the published type surface. Enable
  `stripInternal` so the `@internal` request helpers (`_request`, `_requestRaw`,
  `_requestRawBody`, `_requestFormData`) are no longer emitted into the package's
  `.d.ts` — external consumers can't accidentally type against them across
  releases. `baseUrl` is un-`@internal`-ed so it stays in the public type for
  introspection; `apiKey` stays `@internal` (stripped from the `.d.ts`) AND is
  now defined as a **non-enumerable** runtime own-property, so the credential is
  excluded from `JSON.stringify(client)`, `{ ...client }`, and
  `Object.entries/keys` (no leak via serialization or structured logging). It
  remains readable (`client.apiKey`) for intra-package use (EventsResource).
  (Closes #60 and #66.)

  Note: this is a type-level change only. Any consumer that was typing against the
  `_request*` helpers (in violation of their `@internal` contract) will now get a
  TypeScript error and should migrate off them — they were never part of the
  supported public API. `patch` is appropriate under SemVer because `@internal`
  explicitly disclaims stability.

  Workspace audit: the only callers of `_request*` are the SDK's own resource
  classes (`export-import`, `sync`), which compile from source and are unaffected
  by `stripInternal` (it only changes emitted `.d.ts`). No other workspace package
  or external consumer depends on these methods.

- 40054d2: Complete runtime response-shape validation across the sync resource:
  `getStatus`, `pullFrom`, and `resolveConflict` now reject a null/malformed
  `data` envelope with a structured `EngramError` (instead of a downstream
  `TypeError`), consistent with the guards already on `push`/`pushTo`/
  `listConflicts`/peers. No change for well-formed responses. (Advances #62.)

## 1.7.1

### Patch Changes

- 0fa92c7: Add `crystals.related(id)` method that wraps `GET /v1/crystals/:id/related` and returns the paginated edge envelope as `{ edges, total, hasMore }`.

  The current server implementation returns graph neighbours (incoming + outgoing edges), not embedding-similarity matches — callers should label UI accordingly. Mirrors the typing pattern of `crystals.list()`.

## 1.7.0

### Minor Changes

- c54bb07: Fix `SessionsResource.getLifecycleStats` return type to match the server. Closes #47.

  ## What changed

  The return type of `sessions.getLifecycleStats(sessionId)` was a look-alike of a different endpoint entirely — it declared `{ noteCount, decisionCount, constraintCount, branchCount, stuckDetectionCount, durationMinutes }`, while the server (`engram-server` `services/sessions.ts:141`) returns a `Record<LifecycleStatus, number>` histogram: `{ draft, active, finalized, archived, superseded, merged }`. The Python SDK already has the correct shape.

  Also extends the exported `LifecycleStatus` union with `"merged"` so all six server-side states round-trip correctly:

  ```ts
  export type LifecycleStatus =
    | "draft" | "active" | "finalized" | "archived" | "superseded" | "merged";

  async getLifecycleStats(
    sessionId: string,
  ): Promise<Record<LifecycleStatus, number>>;
  ```

  ## Bump rationale: minor, not major

  This is technically a public-type change — any caller with `stats.noteCount` in their code will fail to compile. But the declared shape never matched the wire response, so any such caller was already broken at runtime. The only code that compiled _and_ worked against this method used a double-cast (`as unknown as Record<string, number>`), and those callers will now compile cleanly without the cast. Treating this as a bug fix + runtime-truthful type correction, not a new contract.

  Upstream reference: `engram-server#67` added exactly the double-cast workaround, which the maintainer bot correctly flagged as pointing back here.

  ## Follow-up (not in this PR)

  - Python `LifecycleStats` in `sdk-python/engram/types/sessions.py:151` is also missing the `"merged"` key; separate issue to track.

## 1.6.0

### Minor Changes

- 27c3b1c: Add optional `skipEmbedding: boolean` to `UpdateKnowledgeCrystalParams`. Closes #35.

  When set to `true`, the server commits the update without regenerating the crystal's embedding. Use for high-frequency status updates (heartbeats, lock holders, counters, last-seen timestamps) where the embedding is meaningless for semantic search and the regenerate-on-every-write LLM cost is pure waste.

  **Composes with `expectedVersion`:** a single update may set both. CAS still enforced; embedding still skipped on success.

  **Server requirements:** requires engram-server **>= 0.31.0** (engram-server#65 shipped in 0.31.0). `MIN_SERVER_VERSION` is bumped from `0.30.0` to `0.31.0` in this release — a single floor now gates both `expectedVersion` CAS (engram-server#60 in 0.30.0) and `skipEmbedding` (engram-server#65 in 0.31.0). `client.checkCompatibility()` is now a meaningful runtime gate for `skipEmbedding` usage.

  **Older servers silently ignore the field** — the optimization becomes a no-op (embedding regenerates as before). Correctness is unaffected on any server; callers pointing the SDK at a pre-0.31.0 server will fail `checkCompatibility()` against the new floor.

  **Default:** omit the field for pre-`skipEmbedding` behavior (server regenerates the embedding). JSDoc guidance: to opt out of the optimization, **omit** rather than passing explicit `false`. The SDK forwards whatever the caller supplies without injecting a default on the wire.

  **Docs:** new `packages/sdk/docs/skip-embedding.md` with usage guidance, when-to-use checklist, composition example with `expectedVersion`, runtime-gating example via `checkCompatibility()`, and clear "what this does NOT do" section. Linked from the SDK README.

  **Tests:** 5 new crystals.update tests + 5 `checkCompatibility` fixture bumps (0.30 → 0.31 floor). Crystals tests: forwards `skipEmbedding: true`, forwards explicit `false`, omits when field absent (backward compat), composes with `expectedVersion` happy path, composes with `expectedVersion` 409 conflict (still surfaces `CrystalVersionConflictError` via `.rejects.toBeInstanceOf` + `.rejects.toMatchObject`). All field naming is camelCase per ADR-018.

  **ADR cross-reference:** pairs with **ADR-017 OQ#2** in the maintainer repo. The SDK can't update a cross-repo ADR directly; the maintainer team owns marking OQ#2 resolved once both sides ship. This PR forwards the decision (passthrough optional field, coordinated `MIN_SERVER_VERSION` floor) without claiming resolution authority over the ADR itself.

  Ships together with engram-server 0.31.0.

## 1.5.0

### Minor Changes

- 57dd89d: Add optimistic-concurrency (CAS) support to `crystals.update`.

  `UpdateKnowledgeCrystalParams` now accepts an optional `expectedVersion: number`. When set, the server updates the crystal only if its current `version` matches; on mismatch, the server returns HTTP 409 + `OPERATION_VERSION_CONFLICT` which the SDK surfaces as the new `CrystalVersionConflictError` class. The error exposes `currentVersion: number` so callers can re-fetch, merge, and retry without a second round trip.

  Omitting `expectedVersion` preserves today's unconditional-write semantics — fully backward compatible.

  **New public API:**

  - `UpdateKnowledgeCrystalParams.expectedVersion?: number`
  - `CrystalVersionConflictError extends EngramError` (exported from `@centient/sdk`)
  - `ErrorCode` union extended with `"OPERATION_VERSION_CONFLICT"`

  **Server requirements:** requires **engram-server >= 0.30.0** (CAS shipped in engram-server#60). `MIN_SERVER_VERSION` bumped from `0.22.4` → `0.30.0` accordingly. Older servers silently ignore `expectedVersion` and perform an unconditional write (pre-CAS behavior). Callers relying on CAS semantics should gate startup on `client.checkCompatibility()`.

  **Docs:** new `packages/sdk/docs/optimistic-concurrency.md` walks through the read-compute-update-with-cas-catch-retry pattern and when to use CAS vs. a locker. Linked from the SDK README.

  Addresses centient-sdk#29 (ADR-017 OQ#1, blocks centient-labs/maintainer v0.9.0).

## 1.4.1

### Patch Changes

- 4efdc3d: Fix camelCase field mapping for ADR-018 compliance. Stop remapping `contentRef` → `content_ref` and `coherenceMode` → `coherence_mode` in crystal create/update, and `nodeType` → `node_type` / `graphExpansion` → `graph_expansion` in crystal create/search JSON bodies. The server now accepts camelCase for all JSON body fields per ADR-018.

## 1.4.0

### Minor Changes

- b04f346: **Breaking changes:**

  - `SyncStatus` type export renamed to `TerrafirmaSyncStatus` (from terrafirma module) to avoid collision with new `SyncStatus` type from the sync module. Update imports: `import type { TerrafirmaSyncStatus } from "@centient/sdk"`
  - `NodeType` union expanded with `"system"` and `"memory_space"` — exhaustive switch statements will need updating
  - `KnowledgeCrystal` interface has 6 new required fields (`lifecycleStatus`, `lastAccessedAt`, `accessCount`, `relevanceScore`, `archivedAt`, `deletedAt`)
  - `KnowledgeCrystalEdge` interface has 3 new required fields (`weight`, `updatedAt`, `deletedAt`)

  Full parity with engram-server v0.22.4.

  **New resources:** Facts, MemorySpaces, Users, Audit, Sync (with Peers sub-resource), GC, Maintenance — 7 new resource classes bringing the total to 20.

  **Type expansions:**

  - NodeType: added `system` and `memory_space` (12 → 14 values)
  - KnowledgeCrystal: added `lifecycleStatus`, `lastAccessedAt`, `accessCount`, `relevanceScore`, `archivedAt`, `deletedAt`
  - KnowledgeCrystalEdge: added `supports` relationship, `weight`, `updatedAt`, `deletedAt` fields
  - MembershipAddedBy: added `terrafirma`, `consolidation`
  - Session note edge relationships: added `supports`, `contradicts`, `extends`
  - SearchKnowledgeCrystalsParams: added `fulltext` search mode

  **Create/Update params:**

  - CreateKnowledgeCrystalParams: added `id`, `contentRef` (ContentRef object), `coherenceMode`
  - UpdateKnowledgeCrystalParams: added `contentRef`
  - ListKnowledgeCrystalsParams: added `sourceSessionId` filter

  **New methods on existing resources:**

  - `crystals.items(id).bulkAdd()` and `reorder()`
  - `sessions.getLifecycleStats()`
  - `entities.graph()` for multi-hop traversal

  **Server compatibility:**

  - Added `MIN_SERVER_VERSION` constant (`0.22.0`)
  - Added `client.checkCompatibility()` method

## 1.3.0

### Minor Changes

- b1e266a: Add agents and ambient context resources to the SDK.

  - `client.agents` — CRUD operations for agent identities (`create`, `list`, `get`, `update`, `delete`)
  - `client.ambientContext` — fetch role-biased ambient crystals for session startup (`get`)

## 1.2.0

### Minor Changes

- f678c29: Initial public release of @centient/logger, @centient/sdk, and @centient/wal.
  Extracted from centient monorepo for independent versioning and npm publishing.

All notable changes to the `@centient/sdk` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `client.crystals.rerank(request: RerankRequest): Promise<RerankResponse>` method
- Optional `reranking?: RerankingConfig` parameter on `client.crystals.search()`
- New types: `RerankingConfig`, `RerankingMetadata`, `RerankingBudgetUsage`, `RankedSearchResult`, `RerankingBoost`, `DiagnosticRerankInfo` (unstable), `RerankRequest`, `RerankResponse`
- All new types exported from `@centient/sdk`

### Changed

- `search()` return type is now `KnowledgeCrystalSearchResult[] | CrystalSearchWithRerankingResult` when `reranking.enabled: true` (backward compatible)

## [1.0.0] - 2026-02-28

### Breaking Changes

- **Unified Knowledge Crystal Model (ADR-055):** The dual `knowledge_items` / `crystals` paradigm has been replaced by a single unified `knowledge_crystals` node type. All 12 node types (content nodes and container nodes) are now managed through a single API surface.
- **`client.knowledge.*` removed as primary API:** The `KnowledgeResource` (`client.knowledge`) is now deprecated. Use `client.crystals` for all knowledge and crystal operations. `client.knowledge` still works at runtime but will be removed in a future release.
- **`KnowledgeItemType` replaced by `NodeType`:** The 6-value `KnowledgeItemType` union is deprecated. Use the unified 12-value `NodeType` union instead.
- **`CrystalType` replaced by `NodeType`:** The 4-value `CrystalType` union is deprecated. Use the unified 12-value `NodeType` union instead.
- **`KnowledgeItem` replaced by `KnowledgeCrystal`:** The `KnowledgeItem` interface is deprecated. Use `KnowledgeCrystal` instead. The two interfaces are structurally identical — the only change is the `nodeType` field now accepts the full 12-value `NodeType` union.
- **`Crystal` replaced by `KnowledgeCrystal`:** The `Crystal` interface is deprecated. Use `KnowledgeCrystal` instead.

### Migration Guide

#### Type Renames

| Old Type                  | New Type                           | Notes                                    |
| ------------------------- | ---------------------------------- | ---------------------------------------- |
| `KnowledgeItem`           | `KnowledgeCrystal`                 | Deprecated alias still exported          |
| `Crystal`                 | `KnowledgeCrystal`                 | Deprecated alias still exported          |
| `KnowledgeItemType`       | `NodeType`                         | 6-value subset; full union has 12 values |
| `CrystalType`             | `NodeType`                         | 4-value subset; full union has 12 values |
| `KnowledgeEdge`           | `KnowledgeCrystalEdge`             | Deprecated alias still exported          |
| `CrystalEdge`             | `KnowledgeCrystalEdge`             | Deprecated alias still exported          |
| `EdgeRelationship`        | `KnowledgeCrystalEdgeRelationship` | Deprecated alias still exported          |
| `CrystalEdgeRelationship` | `KnowledgeCrystalEdgeRelationship` | Deprecated alias still exported          |

#### API Surface Changes

| Old API                                   | New API                                  | Notes                            |
| ----------------------------------------- | ---------------------------------------- | -------------------------------- |
| `client.knowledge.list(params)`           | `client.crystals.list(params)`           | Add `nodeType` to filter by type |
| `client.knowledge.get(id)`                | `client.crystals.get(id)`                |                                  |
| `client.knowledge.create(params)`         | `client.crystals.create(params)`         |                                  |
| `client.knowledge.update(id, params)`     | `client.crystals.update(id, params)`     |                                  |
| `client.knowledge.delete(id)`             | `client.crystals.delete(id)`             |                                  |
| `client.knowledge.search(params)`         | `client.crystals.search(params)`         |                                  |
| `client.knowledge.promote(id, params)`    | `client.crystals.promote(id, params)`    |                                  |
| `client.knowledge.getRelated(id, params)` | `client.crystals.getRelated(id, params)` |                                  |
| `client.knowledge.edges.*`                | `client.edges.*`                         | Edge API unchanged               |

#### NodeType Union Values

The new `NodeType` union replaces both `KnowledgeItemType` and `CrystalType`:

```typescript
// Old: content types (KnowledgeItemType)
"pattern" | "learning" | "decision" | "note" | "finding" | "constraint";

// Old: container types (CrystalType)
"collection" | "session_artifact" | "project" | "domain";

// New: unified NodeType (all 12 values)
"pattern" |
  "learning" |
  "decision" |
  "note" |
  "finding" |
  "constraint" |
  "collection" |
  "session_artifact" |
  "project" |
  "domain" |
  "file_ref" |
  "directory";
```

The `file_ref` and `directory` values are new in this release (Terrafirma node types).

#### Edge Relationship Changes

`KnowledgeCrystalEdgeRelationship` adds `"contains"` to the former 5 values:

```typescript
// Old EdgeRelationship
"related_to" | "derived_from" | "contradicts" | "implements" | "depends_on";

// New KnowledgeCrystalEdgeRelationship
"related_to" |
  "derived_from" |
  "contradicts" |
  "implements" |
  "depends_on" |
  "contains";
```

#### Backward Compatibility

All deprecated types are still exported from their original locations and from `@centient/sdk`. No immediate code changes are required — deprecation warnings appear only at the TypeScript level (IDE tooltips). The deprecated names will be removed in a future major release.

### Added

- **`NodeType`** (`types/node-type.ts`): Unified 12-value node type union replacing `KnowledgeItemType` and `CrystalType`.
- **`KnowledgeCrystal`** (`types/knowledge-crystal.ts`): Unified node interface, superset of former `KnowledgeItem` and `Crystal`. Includes all fields from both prior interfaces plus `path` (Terrafirma file system path).
- **`KnowledgeCrystalEdge`** (`types/knowledge-crystal-edge.ts`): Unified edge interface replacing `KnowledgeEdge` and `CrystalEdge`.
- **`KnowledgeCrystalEdgeRelationship`** (`types/knowledge-crystal-edge.ts`): 6-value union adding `"contains"` to the former 5 relationship types.
- **`client.crystals`** now serves as the primary API for all 12 node types (formerly only crystal/container types).
- 33 new tests for unified type model (`tests/unified-knowledge-crystal.test.ts`).

### Deprecated

- `client.knowledge.*` — use `client.crystals.*` instead.
- `KnowledgeItem`, `Crystal` type aliases — use `KnowledgeCrystal`.
- `KnowledgeItemType`, `CrystalType` — use `NodeType`.
- `KnowledgeEdge`, `CrystalEdge` — use `KnowledgeCrystalEdge`.
- `EdgeRelationship`, `CrystalEdgeRelationship` — use `KnowledgeCrystalEdgeRelationship`.

## [0.16.0] - 2026-02-21

### Breaking Changes

- **`NoteType` narrowed:** Removed `constraint` from the `NoteType` union type. Constraints are now tracked exclusively through the dedicated constraints API (`client.sessions.constraints()`), not as session notes. Code referencing `NoteType` with `"constraint"` will fail type checks.
- **Crystal Items API:** `CrystalItemsResource.list()` now returns `{ items: CrystalItem[] }` instead of `{ items: CrystalMembership[] }`. The `CrystalItem` interface matches the server's actual response shape (`itemId`, `itemType`, `title`, `addedAt`).
- **Crystal Items API:** `CrystalItemsResource.add()` now returns `{ added: boolean }` instead of `CrystalMembership`. This matches the server's actual POST response.

### Added

- **`LifecycleStatus` type** (`resources/sessions.ts`): Union type `"draft" | "active" | "finalized" | "archived" | "superseded"` representing the 5-state lifecycle of session notes.
- **`NoteEmbeddingStatus` type** (`resources/sessions.ts`): Union type `"pending" | "synced" | "failed" | "stale"` representing embedding synchronization state. The `"stale"` value is new -- indicates content was updated after the last successful embedding.
- **`SearchKnowledgeScope` type** (`types.ts`): Union type `"items" | "patterns" | "crystals"` for routing `search_knowledge` to specific knowledge stores.
- **`PromotionSummary` interface** (`types.ts`): Aggregate promotion results returned during session finalization, containing `totalNotesEvaluated`, `promoted`, `flaggedForReview`, `archived`, `topPromotions` (max 5), and `averageScore`.
- **`CrystalItem` interface:** Represents a knowledge item within a crystal as returned by the list items endpoint (joined view of `crystal_membership` + `knowledge_items`).
- **`EmbeddingStatus` type** (`types/crystals.ts`): Crystal-specific embedding status type now includes `"stale"` alongside `"pending"`, `"processing"`, `"synced"`, `"failed"`.
- **`LocalSessionNote` enriched:** Now includes `lifecycleStatus: LifecycleStatus` and `embeddingStatus: NoteEmbeddingStatus` fields for full note state visibility.
- **`UpdateLocalNoteParams` supports lifecycle:** Added optional `lifecycleStatus` field for direct lifecycle transitions via `notes.update()`.

### Fixed

- Crystal Items API types now match actual server responses, fixing type mismatches that caused runtime errors when accessing response properties.
