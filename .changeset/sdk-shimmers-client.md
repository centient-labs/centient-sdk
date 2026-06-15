---
"@centient/sdk": minor
---

Add `client.shimmers` — typed client methods wrapping engram's `/v1/shimmers`
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
