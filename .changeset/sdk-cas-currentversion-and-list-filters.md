---
"@centient/sdk": minor
---

Fix `CrystalVersionConflictError.currentVersion` being `NaN` against real
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
