# Changelog

## 1.0.0 Stable (2026-03-11)

**First stable release.** This version graduates engram-py from Alpha to Production/Stable.
Semantic versioning (SemVer) guarantees apply from this version onwards.

### Breaking Changes (from v0.x)

- **Unified Crystal Type**: `KnowledgeItem` and `Crystal` types removed. Use `KnowledgeCrystal` with `node_type` field instead.
- **Field renames**: `type` → `node_type`, `name` → `title` on all crystal-related types.
- **Removed types**: `CreateKnowledgeParams`, `CreateCrystalParams`, `KnowledgeEdge`, `KnowledgeItem`, `Crystal` — use `CreateKnowledgeCrystalParams`, `KnowledgeCrystalEdge`, `KnowledgeCrystal` from `engram.types.knowledge_crystal`.
- **Python version**: Minimum Python version lowered from 3.10 to 3.9.

### New in v1.0.0

- **Async test coverage**: Comprehensive async test suite (`test_async_comprehensive.py`) with 54 tests covering all 12 resource types.
- **Integration test scaffold**: `test_integration_scaffold.py` for live-server testing (gated on `ENGRAM_TEST_URL`).
- **Framework integration examples**: LangChain memory backend (`examples/langchain_memory.py`), CrewAI shared memory (`examples/crewai_shared_memory.py`), AutoGen memory plugin (`examples/autogen_memory.py`).
- **CI matrix**: Python SDK tested in CI on Python 3.9, 3.10, 3.11, 3.12.
- **PyPI publication workflow**: Automated release via `sdk-python-v*` tag push.
- **Stability guarantees**: SemVer policy, supported Python versions, API freeze scope documented in README.

### TypeScript SDK Parity

Full API parity achieved for all 16 core resources (Sessions, Coordination, Crystals, Export/Import, Terrafirma).
Python SDK also includes bonus features: **BlobsResource** and **AuditResource** (not in TS SDK).

**Known limitation:** `EntitiesResource` (entity extraction) and `ExtractionResource` are present in the
TypeScript SDK but not yet implemented in the Python SDK. Planned for v1.1.0.

### Included from [Unreleased]

- `crystals.rerank(request: RerankRequest) -> RerankResponse` (sync and async)
- Optional `reranking: RerankingConfig | None = None` parameter on `crystals.search()`
- New Pydantic v2 types: `RerankingConfig`, `RerankingMetadata`, `RerankingBudgetUsage`, `RankedSearchResult`, `RerankingBoost`, `DiagnosticRerankInfo`, `RerankRequest`, `RerankResponse`

## 0.17.0 Alpha (2026-03-01)

### Added
- Unified `KnowledgeCrystal` type merging former `KnowledgeItem` and `Crystal` types (ADR-055)
- Unified `KnowledgeCrystalEdge` type merging former `KnowledgeEdge` and `CrystalEdge` types
- New module `engram.types.knowledge_crystal` with all unified types
- CRUD param types: `CreateKnowledgeCrystalParams`, `UpdateKnowledgeCrystalParams`, `ListKnowledgeCrystalsParams`, `SearchKnowledgeCrystalsParams`
- Edge param types: `CreateKnowledgeCrystalEdgeParams`, `UpdateKnowledgeCrystalEdgeParams`, `ListKnowledgeCrystalEdgesParams`
- Enum types: `NodeType`, `NodeVisibility`, `EmbeddingStatus`, `MembershipAddedBy`, `KnowledgeCrystalEdgeRelationship`, `SourceType`, `ContentNodeType`

### Deprecated
- `KnowledgeItem` -- use `KnowledgeCrystal` instead (removal in 0.18.0)
- `Crystal` -- use `KnowledgeCrystal` instead (removal in 0.18.0)
- `KnowledgeEdge` -- use `KnowledgeCrystalEdge` instead (removal in 0.18.0)
- `CreateKnowledgeParams` -- use `CreateKnowledgeCrystalParams` instead (removal in 0.18.0)
- `CreateCrystalParams` -- use `CreateKnowledgeCrystalParams` instead (removal in 0.18.0)

### Changed
- Version: 0.16.0 to 0.17.0
- Field renames: `type` to `node_type`, `name` to `title`, `crystalType` to `nodeType`

## 0.16.0 Alpha (2026-02-21)

### Added -- Phase 0: Transport Layer
- Binary transport (`_request_raw`) for blob upload/download with raw bytes
- Streaming transport (`_request_stream`) for memory-efficient export via `AsyncIterator[bytes]` / `Iterator[bytes]`
- Multipart transport (`_request_multipart`) for file import via `multipart/form-data`

### Added -- Phase 1: Core Parity
- Terrafirma resource (`client.terrafirma`): `get_status`, `get_file_info`, `get_migration_status`, `start_migration`, `trigger_sync`
- Embeddings client methods: `embed`, `embed_batch`, `embedding_info`
- Health client methods: `health`, `health_ready`, `health_detailed`
- Terrafirma types: `TerrafirmaMode`, `ProcessStatus`, `SyncStatus`, `MigrationStatus`, `SyncScope`, `TerrafirmaWatcherStatus`, `TerrafirmaReconcilerStatus`, `TerrafirmaSyncCounts`, `TerrafirmaSuggestedAction`, `TerrafirmaStatus`, `CrystalMembershipInfo`, `FileConflictInfo`, `TerrafirmaFileInfo`, `MigrationStartResult`, `MigrationError`, `MigrationCurrentStatus`, `SyncResult`, `StartMigrationOptions`, `TriggerSyncOptions`
- Embedding types: `EmbeddingModule`, `EmbeddingRequest`, `EmbeddingResponse`, `BatchEmbeddingResponse`, `EmbeddingInfoResponse`

### Added -- Phase 2: New Resources
- Blobs resource (`client.blobs`): `upload`, `download`, `get_metadata`, `delete`, `add_reference`, `gc`
- Audit resource (`client.audit`): `ingest`, `ingest_batch`, `flush`, `list_events`, `get_event`, `get_stats`, `prune`
- Export/Import resource (`client.export_import`): `export_data`, `estimate_export`, `import_data`, `preview_import`
- Blob types: `BlobMetadata`, `BlobUploadResponse`, `BlobReference`, `GcResult`
- Audit types: `LogLevel`, `AuditEventType`, `AuditOutcome`, `AuditEvent`, `AuditIngestResult`, `AuditBatchIngestResult`, `AuditFlushResult`, `AuditStats`, `AuditIngesterStats`, `AuditPruneResult`, `AuditIngestParams`, `AuditBatchIngestParams`, `AuditListParams`, `AuditStatsParams`, `AuditPruneParams`
- Export/Import types: `ExportScope`, `ExportFormat`, `ConflictResolution`, `ExportFilter`, `ExportParams`, `ImportOptions`, `ExportEstimate`, `ImportConflict`, `ImportPreview`, `ImportPreviewSchemaVersion`, `ImportPreviewCounts`, `ImportPreviewError`, `ImportResult`, `ImportResultError`, `ImportResultCounts`

### Added -- Phase 3: Extended Resources
- Crystal advanced ops (12 methods on `client.crystals`): `bulk_add`, `reorder`, `get_acl`, `grant_permission`, `revoke_permission`, `create_share_link`, `get_shared`, `delete_share_link`, `fork`, `generate_embedding`, plus hierarchy scope via `client.crystals.hierarchy(id)`: `get_crystal_scope`, `search_in_scope`
- Note lifecycle method: `client.notes.update_lifecycle`
- Session lifecycle: `client.sessions.get_lifecycle_stats`
- Knowledge extensions: `client.knowledge.generate_embedding`, `client.knowledge.get_crystals`
- ACL/sharing types: `AclEntry`, `ShareLink`, `SharedCrystalResult`, `GrantPermissionParams`, `RevokePermissionParams`, `CreateShareLinkParams`, `ForkCrystalParams`, `BulkAddParams`, `ReorderParams`, `ScopedSearchParams`, `ScopedSearchResult`
- Lifecycle types: `LifecycleStatus`, `UpdateLifecycleParams`, `LifecycleStats`
- Knowledge types: `PromotionSummary`
- Session types: `NoteEmbeddingStatus`

### Added -- Phase 4: Housekeeping
- Version bump to 0.16.0
- Alpha classifier in pyproject.toml (`Development Status :: 3 - Alpha`)
- 99 new unit tests (261 total, all passing)
- Type validation tests for all exported types

### Changed
- Version: 0.14.0 to 0.16.0
- Classifier: Pre-Alpha to Alpha

## 0.1.0 (initial release)

### Added
- Initial release of the Engram Python SDK
- Sync client (`EngramClient`) and async client (`AsyncEngramClient`)
- Session management (create, get, list, update, delete, finalize)
- Session notes (create, list, search)
- Session scratch (create, get, list, update, delete)
- Session coordination (constraints, decision points, branches, note edges, stuck detections)
- Session links (create, get, delete, list outgoing/incoming)
- Knowledge management (create, get, list, update, delete, search, promote, versions, edges, related)
- Crystal management (create, get, list, update, delete, search, items, versions, hierarchy)
- Edge management (create, get, list, update, delete)
- Global notes (get, update, delete, search)
- Typed error hierarchy (EngramError, NotFoundError, ValidationError, etc.)
- Pydantic v2 type models for all request/response types
- Automatic retry with linear backoff on 5xx errors and network failures
- py.typed marker for PEP 561 compliance
