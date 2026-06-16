---
"@centient/sdk": minor
---

Public, typed resource methods for the dedup/merge endpoints previously reachable
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
