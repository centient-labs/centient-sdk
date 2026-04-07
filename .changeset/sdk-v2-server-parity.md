---
"@centient/sdk": minor
---

**Breaking changes:**
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
