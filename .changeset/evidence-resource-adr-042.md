---
"@centient/sdk": minor
---

Add `client.evidence` — a typed `EvidenceResource` for engram-server's append-only evidence series (ADR-042 D3 / engram-server #1035; requires engram-server >= 0.46.0). Issue #156.

Five methods, one per `/v1/evidence` route: `append` (dedup-aware `POST /v1/evidence/append`), `get` (`GET /v1/evidence/records/{id}`), and the three paginated reads `listBySeries`, `listByEntity`, `listByDescriptor`. Each returns a page as `{ records, total, hasMore }`.

Wire-contract typing:

- `EvidenceRecord.seq` is a decimal **string** (BIGSERIAL — not safe-integer-bounded), never a number; `payload` is `Record<string, unknown>` (opaque consumer-owned JSONB, envelope-validated only).
- `append()` returns `{ record, isDuplicate, priorSeq }` for BOTH the 201 (new) and 200 (`isDuplicate: true`, silent convergence to the prior record) outcomes — branch on `isDuplicate`/`priorSeq`, not the status code. `get()` throws `NotFoundError` on 404.
- New `EvidenceDedupConflictError` (409 `EVIDENCE_DEDUP_CONFLICT`) — a same-`dedupKey`, differing-`bodyDigest` append is never auto-resolved and never last-write-wins; the error lifts `priorRecordId`/`priorBodyDigest`/`newBodyDigest` off `error.details` onto typed fields (mirroring `CrystalVersionConflictError`), with the full body preserved on `.details`. `EVIDENCE_DEDUP_CONFLICT` is added to the `ErrorCode` union and the `parseApiError` ladder (both envelope shapes).
- `listByDescriptor()` enforces the `entity` XOR `seriesKey` mutual exclusivity client-side (typed `VALIDATION_INPUT_INVALID` before any request) rather than letting the server silently AND both filters.

The client-wide `MIN_SERVER_VERSION` stays 0.31.0 (per-feature floor; the routes 404 on older servers).
