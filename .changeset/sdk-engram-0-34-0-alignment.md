---
"@centient/sdk": major
---

Align the SDK with engram-server 0.34.0.

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
