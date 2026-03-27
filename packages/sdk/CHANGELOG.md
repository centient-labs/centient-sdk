# Changelog

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
