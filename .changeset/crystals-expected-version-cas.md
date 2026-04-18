---
"@centient/sdk": minor
---

Add optimistic-concurrency (CAS) support to `crystals.update`.

`UpdateKnowledgeCrystalParams` now accepts an optional `expectedVersion: number`. When set, the server updates the crystal only if its current `version` matches; on mismatch, the server returns HTTP 409 + `OPERATION_VERSION_CONFLICT` which the SDK surfaces as the new `CrystalVersionConflictError` class. The error exposes `currentVersion: number` so callers can re-fetch, merge, and retry without a second round trip.

Omitting `expectedVersion` preserves today's unconditional-write semantics — fully backward compatible.

**New public API:**

- `UpdateKnowledgeCrystalParams.expectedVersion?: number`
- `CrystalVersionConflictError extends EngramError` (exported from `@centient/sdk`)
- `ErrorCode` union extended with `"OPERATION_VERSION_CONFLICT"`

**Server requirements:** requires engram-server with CAS support on `PATCH /crystals/:id` (server-side sibling PR lands with engram-server#60). Older servers silently ignore the field and perform an unconditional write, effectively the pre-CAS behavior. `client.checkCompatibility()` should be used at startup by callers that rely on CAS semantics.

**Docs:** new `packages/sdk/docs/optimistic-concurrency.md` walks through the read-compute-update-with-cas-catch-retry pattern and when to use CAS vs. a locker. Linked from the SDK README.

Addresses centient-sdk#29 (ADR-017 OQ#1, blocks centient-labs/maintainer v0.9.0).
