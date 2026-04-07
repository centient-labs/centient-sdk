# @centient/sdk 1.4.0 Migration Guide

## Server Requirement

**Requires engram-server >= 0.22.4.** Check compatibility at runtime:

```typescript
const compat = await client.checkCompatibility();
if (!compat.compatible) {
  console.warn(`Server ${compat.serverVersion} is below minimum ${compat.minRequired}`);
}
```

## Breaking Changes

### 1. `SyncStatus` renamed to `TerrafirmaSyncStatus`

```diff
- import type { SyncStatus } from "@centient/sdk";
+ import type { TerrafirmaSyncStatus } from "@centient/sdk";
```

The name was freed for the new `SyncStatus` type from the sync resource. If you were using `SyncStatus` for terrafirma file sync status, update your imports.

### 2. `NodeType` union expanded (12 to 14 values)

Added `"system"` and `"memory_space"`. If you have exhaustive switch statements or discriminated unions on `NodeType`, add cases for the new values:

```typescript
case "system":
case "memory_space":
  // handle system/collaboration nodes
  break;
```

### 3. `KnowledgeCrystal` has 6 new required fields

If you construct `KnowledgeCrystal` objects directly (e.g., test mocks), add:

```typescript
{
  // ...existing fields...
  lifecycleStatus: "active",
  lastAccessedAt: null,
  accessCount: 0,
  relevanceScore: null,
  archivedAt: null,
  deletedAt: null,
}
```

### 4. `KnowledgeCrystalEdge` has 3 new required fields

```typescript
{
  // ...existing fields...
  weight: 1.0,
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
}
```

## New Resources

All available on `EngramClient` immediately with no configuration needed:

```typescript
const client = createEngramClient({ baseUrl, apiKey });
```

### Facts (bi-temporal)

```typescript
await client.facts.create({ key: "project.status", value: { state: "active" } });
const fact = await client.facts.getByKey("project.status");
const history = await client.facts.getHistory(fact.id, { limit: 10 });
```

### Memory Spaces (multi-agent shared memory)

```typescript
const space = await client.memorySpaces.create({ title: "Shared Context", visibility: "shared" });
await client.memorySpaces.join(space.id, { agentId: "agent-1", permission: "write" });
const detail = await client.memorySpaces.get(space.id); // includes members
await client.memorySpaces.leave(space.id, "agent-1");
```

### Users and API Key Management

```typescript
const { user, key } = await client.users.create({ name: "my-user" });
// key.value is shown only once -- store it immediately

const users = await client.users.list();
await client.users.delete("my-user", { revokeKeys: true });
```

### Audit Event Ingestion and Querying

```typescript
await client.audit.ingest({ level: "info", component: "api", message: "Request processed" });
await client.audit.ingestBatch([event1, event2, event3]);
await client.audit.flush();

const { events } = await client.audit.listEvents({ since: "2026-04-01T00:00:00Z", limit: 50 });
const stats = await client.audit.getStats();
await client.audit.prune(90); // delete events older than 90 days
```

### Sync (instance-to-instance replication)

```typescript
// Peer management
await client.sync.peers.create({ name: "remote", url: "https://remote.example.com" });
await client.sync.peers.link("remote");

// Push/pull changes
await client.sync.push(changes);
const pulled = await client.sync.pull({ sinceSeq: "1000" });

// Or push/pull to a named peer
await client.sync.pushTo("remote");
await client.sync.pullFrom("remote");

// Conflict resolution
const { conflicts } = await client.sync.listConflicts({ unresolved: true });
await client.sync.resolveConflict(conflicts[0].id, { resolution: "local" });
```

### Garbage Collection

```typescript
const { candidates } = await client.gc.getCandidates({ threshold: 0.3, limit: 100 });
const dryResult = await client.gc.run({ dryRun: true });
const result = await client.gc.run();
const { entries } = await client.gc.getAuditLog({ limit: 20 });
```

### Database Maintenance

```typescript
await client.maintenance.tombstoneCleanup({ days: 30, dryRun: true });
await client.maintenance.changelogCompact({ days: 30 });
```

## New Methods on Existing Resources

### Crystal bulk item management

```typescript
await client.crystals.items(crystalId).bulkAdd([
  { itemId: "id-1" },
  { itemId: "id-2", position: 1 },
]);
await client.crystals.items(crystalId).reorder(["id-2", "id-1"]);
```

### Session lifecycle stats

```typescript
const stats = await client.sessions.getLifecycleStats(sessionId);
// { noteCount, decisionCount, constraintCount, branchCount, stuckDetectionCount, durationMinutes }
// durationMinutes is null for active (non-finalized) sessions
```

### Multi-hop entity graph traversal

```typescript
const { data } = await client.entities.graph(entityId, {
  depth: 2,
  filterClass: "person",
  minConfidence: 0.8,
});
// { root, nodes, edges, totalNodes, depth, truncated }
```

### Content ref on crystal create

Content-type nodes (`pattern`, `learning`, `decision`, `note`, `finding`, `constraint`) now support `contentRef`:

```typescript
await client.crystals.create({
  nodeType: "note",
  title: "My Note",
  contentRef: { type: "inline" },
  contentInline: "Note content here",
  coherenceMode: "advisory", // optional: "blocking" | "advisory" | "bypass"
});
```

### Crystal list filtering by source session

```typescript
const { crystals } = await client.crystals.list({ sourceSessionId: "session-123" });
```

## New Type Exports

```typescript
import type {
  // Facts
  Fact, CreateFactParams, UpdateFactParams, FactHistoryParams,
  // Memory Spaces
  MemorySpace, MemorySpaceWithMembers, MemorySpaceMember, MemorySpacePermission,
  CreateMemorySpaceParams, ListMemorySpacesParams, JoinMemorySpaceParams,
  // Users
  User, ApiKey, CreateUserParams,
  // Audit
  AuditEvent, AuditLevel, AuditOutcome, AuditEventType, AuditStats,
  IngestEventParams, ListAuditEventsParams,
  // Sync
  SyncPeer, SyncConflict, SyncStatus, SyncChange, SyncPushResult,
  CreatePeerParams, SyncPullParams, ListConflictsParams,
  // GC
  GcCandidate, GcAuditEntry, GcRunResult,
  ListGcCandidatesParams, ListGcAuditParams,
  // Maintenance
  MaintenanceParams, TombstoneCleanupResult, ChangelogCompactResult,
} from "@centient/sdk";

// Server compatibility constant
import { MIN_SERVER_VERSION } from "@centient/sdk";
```

## Expanded Enums and Unions

### MembershipAddedBy

Added `"terrafirma"` and `"consolidation"` to the existing union.

### KnowledgeCrystalEdgeRelationship

Added `"supports"` (evidence supporting a claim).

### Session note edge relationships

Added `"supports"`, `"contradicts"`, `"extends"` to the existing set of `"preceded_by"`, `"caused_by"`, `"validated_by"`, `"superseded_by"`, `"related_to"`.

### Search mode

`SearchKnowledgeCrystalsParams.mode` now accepts `"fulltext"` in addition to `"semantic"`, `"keyword"`, and `"hybrid"`.
