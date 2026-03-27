"""Tests for Pydantic type models."""
from __future__ import annotations

import copy

import pytest

from engram.types.sessions import (
    LifecycleStatus,
    LifecycleStats,
    LocalSession,
    LocalSessionNote,
    CreateLocalSessionParams,
    SessionScratch,
)
from engram.types.knowledge_crystal import (
    ContentRef,
    ContainedCrystal,
    CrystalHierarchy,
    CrystalMembership,
    CrystalVersion,
    KnowledgeCrystal,
    KnowledgeCrystalEdge,
    KnowledgeCrystalEdgeRelationship,
    KnowledgeCrystalSearchResult,
    CreateKnowledgeCrystalParams,
    ListKnowledgeCrystalsParams,
    ParentCrystal,
    PromotionSummary,
    ScopedSearchResult,
    SearchKnowledgeCrystalsParams,
    UpdateKnowledgeCrystalParams,
)
from pydantic import ValidationError

from engram.types.crystals import (
    AclEntry,
    GrantPermissionParams,
    ShareLink,
)
from engram.types.coordination import (
    SessionConstraint,
    DecisionPoint,
    ExplorationBranch,
    SessionLink,
    StuckDetection,
)
from engram.types.terrafirma import (
    TerrafirmaStatus,
    TerrafirmaWatcherStatus,
    TerrafirmaReconcilerStatus,
    TerrafirmaSyncCounts,
    TerrafirmaSuggestedAction,
    CrystalMembershipInfo as TfCrystalMembershipInfo,
    TerrafirmaFileInfo,
    MigrationCurrentStatus,
    MigrationError,
    StartMigrationOptions,
    TriggerSyncOptions,
)
from engram.types.blobs import BlobMetadata, BlobUploadResponse
from engram.types.audit import AuditEvent, AuditIngestParams, AuditStats
from engram.types.embeddings import (
    EmbeddingInfoResponse,
    EmbeddingRequest,
    EmbeddingResponse,
)
from engram.types.export_import import (
    ExportEstimate,
    ExportParams,
    ImportConflict,
    ImportOptions,
    ImportPreview,
    ImportPreviewCounts,
    ImportPreviewSchemaVersion,
    ImportResult,
    ImportResultCounts,
    ImportResultError,
)
from tests.conftest import SAMPLE_KNOWLEDGE_CRYSTAL


# ---------------------------------------------------------------------------
# Factory helpers — reduce boilerplate in factory-pattern tests
# ---------------------------------------------------------------------------


def make_crystal(
    id: str = "kc-test",
    node_type: str = "pattern",
    title: str = "Test Crystal",
    **overrides,
) -> "KnowledgeCrystal":
    """Build a minimal KnowledgeCrystal for testing."""
    data = {
        "id": id,
        "slug": None,
        "nodeType": node_type,
        "title": title,
        "summary": None,
        "description": None,
        "tags": [],
        "contentRef": None,
        "contentInline": None,
        "embeddingStatus": "pending",
        "embeddingUpdatedAt": None,
        "confidence": None,
        "verified": False,
        "visibility": "private",
        "license": None,
        "ownerIds": [],
        "version": 1,
        "forkCount": 0,
        "starCount": 0,
        "itemCount": 0,
        "versionCount": 1,
        "parentId": None,
        "parentVersion": None,
        "sourceType": "manual",
        "sourceSessionId": None,
        "sourceProject": None,
        "typeMetadata": {},
        "path": None,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return KnowledgeCrystal.model_validate(data)


def make_session(
    id: str = "sess-test",
    project_path: str = "/test",
    **overrides,
) -> "LocalSession":
    """Build a minimal LocalSession for testing."""
    data = {
        "id": id,
        "externalId": None,
        "projectPath": project_path,
        "status": "active",
        "startedAt": "2026-01-01T00:00:00Z",
        "endedAt": None,
        "metadata": {},
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return LocalSession.model_validate(data)


def make_note(
    id: str = "note-test",
    session_id: str = "sess-test",
    content: str = "Test note",
    note_type: str = "observation",
    **overrides,
) -> "LocalSessionNote":
    """Build a minimal LocalSessionNote for testing."""
    data = {
        "id": id,
        "sessionId": session_id,
        "type": note_type,
        "content": content,
        "embeddingStatus": "pending",
        "embeddingUpdatedAt": None,
        "metadata": {},
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return LocalSessionNote.model_validate(data)


class TestSessionTypes:
    def test_local_session_from_api(self):
        data = {
            "id": "s1",
            "externalId": None,
            "projectPath": "/test",
            "status": "active",
            "startedAt": "2026-01-01T00:00:00Z",
            "endedAt": None,
            "metadata": {"key": "val"},
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        session = LocalSession.model_validate(data)
        assert session.id == "s1"
        assert session.project_path == "/test"
        assert session.external_id is None
        assert session.metadata == {"key": "val"}

    def test_local_session_snake_case(self):
        session = LocalSession(
            id="s1",
            project_path="/test",
            status="active",
            started_at="2026-01-01T00:00:00Z",
            metadata={},
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        )
        assert session.project_path == "/test"

    def test_create_session_params_serialization(self):
        params = CreateLocalSessionParams(project_path="/test")
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert "projectPath" in dumped
        assert dumped["projectPath"] == "/test"

    def test_session_scratch(self):
        data = {
            "id": "sc-1",
            "sessionId": "s1",
            "type": "observation",
            "content": "test",
            "suggestedType": "learning",
            "promotionScore": 0.8,
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        scratch = SessionScratch.model_validate(data)
        assert scratch.suggested_type == "learning"
        assert scratch.promotion_score == 0.8


class TestKnowledgeTypes:
    def test_knowledge_crystal(self):
        """KnowledgeCrystal (unified type) validates from unified API shape."""
        data = {
            "id": "kc-1",
            "slug": None,
            "nodeType": "pattern",
            "title": "Test",
            "summary": None,
            "description": None,
            "tags": ["t1"],
            "contentRef": {"type": "inline"},
            "contentInline": "content",
            "embeddingStatus": "pending",
            "embeddingUpdatedAt": None,
            "confidence": 0.9,
            "verified": True,
            "visibility": "private",
            "license": None,
            "ownerIds": [],
            "version": 1,
            "forkCount": 0,
            "starCount": 0,
            "itemCount": 0,
            "versionCount": 1,
            "parentId": None,
            "parentVersion": None,
            "sourceType": "manual",
            "sourceSessionId": None,
            "sourceProject": None,
            "typeMetadata": {},
            "path": None,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        item = KnowledgeCrystal.model_validate(data)
        assert item.node_type == "pattern"
        assert item.content_ref.type == "inline"
        assert item.embedding_status == "pending"
        assert item.visibility == "private"
        assert item.version == 1

    def test_knowledge_crystal_learning_type(self):
        """KnowledgeCrystal validates learning node type."""
        data = {
            "id": "kc-2",
            "nodeType": "learning",
            "title": "Test Learning",
            "summary": None,
            "description": None,
            "tags": [],
            "contentRef": None,
            "contentInline": None,
            "embeddingStatus": "pending",
            "embeddingUpdatedAt": None,
            "confidence": None,
            "verified": False,
            "visibility": "private",
            "license": None,
            "ownerIds": [],
            "version": 1,
            "forkCount": 0,
            "starCount": 0,
            "itemCount": 0,
            "versionCount": 1,
            "parentId": None,
            "parentVersion": None,
            "sourceType": None,
            "sourceSessionId": None,
            "sourceProject": None,
            "typeMetadata": {},
            "path": None,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        item = KnowledgeCrystal.model_validate(data)
        assert item.node_type == "learning"

    def test_knowledge_crystal_edge(self):
        """KnowledgeCrystalEdge validates all 6 relationship types."""
        for rel in ["contains", "derived_from", "related_to", "contradicts", "implements", "depends_on"]:
            data = {
                "id": f"edge-{rel}",
                "sourceId": "kc-1",
                "targetId": "kc-2",
                "relationship": rel,
                "metadata": {},
                "createdAt": "2026-01-01T00:00:00Z",
                "createdBy": None,
            }
            edge = KnowledgeCrystalEdge.model_validate(data)
            assert edge.relationship == rel
            assert edge.created_by is None

    def test_knowledge_crystal_edge_basic(self):
        """KnowledgeCrystalEdge validates basic edge data."""
        data = {
            "id": "edge-1",
            "sourceId": "kc-1",
            "targetId": "kc-2",
            "relationship": "related_to",
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
            "createdBy": None,
        }
        edge = KnowledgeCrystalEdge.model_validate(data)
        assert edge.source_id == "kc-1"
        assert edge.relationship == "related_to"

    def test_create_knowledge_crystal_params(self):
        """CreateKnowledgeCrystalParams uses node_type field."""
        params = CreateKnowledgeCrystalParams(
            node_type="pattern",
            title="Test Pattern",
            tags=["test"],
        )
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert dumped["nodeType"] == "pattern"
        assert dumped["title"] == "Test Pattern"


class TestCrystalTypes:
    def test_crystal_unified_shape(self):
        """KnowledgeCrystal validates collection node type from unified API shape."""
        data = {
            "id": "c-1",
            "slug": "test",
            "nodeType": "collection",
            "title": "Test",
            "summary": None,
            "description": None,
            "tags": [],
            "contentRef": None,
            "contentInline": None,
            "embeddingStatus": "pending",
            "embeddingUpdatedAt": None,
            "confidence": None,
            "verified": False,
            "visibility": "private",
            "license": None,
            "ownerIds": [],
            "version": 1,
            "forkCount": 0,
            "starCount": 0,
            "itemCount": 0,
            "versionCount": 1,
            "parentId": None,
            "parentVersion": None,
            "sourceType": None,
            "sourceSessionId": None,
            "sourceProject": None,
            "typeMetadata": {},
            "path": None,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        crystal = KnowledgeCrystal.model_validate(data)
        assert crystal.node_type == "collection"
        assert crystal.title == "Test"
        assert crystal.item_count == 0

    def test_create_knowledge_crystal_params_collection(self):
        """CreateKnowledgeCrystalParams with collection node_type."""
        params = CreateKnowledgeCrystalParams(
            title="My Crystal",
            node_type="collection",
        )
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert dumped["nodeType"] == "collection"
        assert dumped["title"] == "My Crystal"


class TestCoordinationTypes:
    def test_session_constraint(self):
        data = {
            "id": "con-1",
            "sessionId": "s1",
            "content": "No console.log",
            "keywords": ["console"],
            "scope": "session",
            "active": True,
            "detectedFrom": "explicit",
            "liftedAt": None,
            "liftReason": None,
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        constraint = SessionConstraint.model_validate(data)
        assert constraint.active is True
        assert constraint.scope == "session"

    def test_decision_point(self):
        data = {
            "id": "dp-1",
            "sessionId": "s1",
            "description": "Choose DB",
            "category": "architecture",
            "alternatives": ["postgres", "mysql"],
            "rationale": None,
            "surpriseScore": 0.5,
            "resolved": False,
            "resolvedAt": None,
            "chosenBranchId": None,
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        dp = DecisionPoint.model_validate(data)
        assert dp.category == "architecture"
        assert len(dp.alternatives) == 2

    def test_session_link(self):
        data = {
            "id": "sl-1",
            "sourceSessionId": "s1",
            "targetSessionId": "s2",
            "relationship": "builds_on",
            "evidence": "continued work",
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
        }
        link = SessionLink.model_validate(data)
        assert link.relationship == "builds_on"


# ---------------------------------------------------------------------------
# Phase 2+3 Type Validation Tests
# ---------------------------------------------------------------------------


class TestTerrafirmaTypes:
    """CamelCase alias round-trip + snake_case request param validation."""

    def test_terrafirma_status_round_trip(self):
        """Full TerrafirmaStatus from camelCase API response."""
        data = {
            "mode": "steady_state",
            "watcher": {
                "status": "running",
                "uptimeSeconds": 3600,
                "eventsProcessed24h": 42,
                "lastEventAt": "2026-01-01T12:00:00Z",
            },
            "reconciler": {
                "status": "idle",
                "lastRunAt": "2026-01-01T11:00:00Z",
                "nextRunAt": "2026-01-01T12:00:00Z",
            },
            "sync": {
                "total": 100,
                "synced": 90,
                "pending": 5,
                "syncing": 2,
                "fsDirty": 1,
                "conflict": 1,
                "orphaned": 0,
                "error": 1,
                "lastSyncedAt": "2026-01-01T11:30:00Z",
            },
            "suggestedActions": [
                {
                    "action": "sync",
                    "label": "Sync dirty files",
                    "endpoint": "/v1/terrafirma/sync",
                    "count": 1,
                },
            ],
        }
        status = TerrafirmaStatus.model_validate(data)
        assert status.mode == "steady_state"
        assert status.watcher.status == "running"
        assert status.watcher.uptime_seconds == 3600
        assert status.watcher.events_processed_24h == 42
        assert status.reconciler.last_run_at == "2026-01-01T11:00:00Z"
        assert status.sync.fs_dirty == 1
        assert status.sync.last_synced_at == "2026-01-01T11:30:00Z"
        assert len(status.suggested_actions) == 1
        assert status.suggested_actions[0].count == 1

    def test_terrafirma_file_info_with_nested_models(self):
        """TerrafirmaFileInfo with CrystalMembershipInfo nested models."""
        data = {
            "filePath": "/src/main.ts",
            "syncStatus": "synced",
            "contentHash": "sha256:abc",
            "lastModified": "2026-01-01T00:00:00Z",
            "sizeBytes": 2048,
            "entityId": "ent-1",
            "crystalMemberships": [
                {
                    "crystalId": "c-1",
                    "nodeType": "collection",
                    "tags": ["tf-category"],
                    "folderPath": "/src",
                },
            ],
            "engramItemId": "ki-1",
            "version": 3,
            "lastSyncedAt": "2026-01-01T00:00:00Z",
            "conflict": None,
        }
        info = TerrafirmaFileInfo.model_validate(data)
        assert info.file_path == "/src/main.ts"
        assert info.sync_status == "synced"
        assert info.size_bytes == 2048
        assert len(info.crystal_memberships) == 1
        assert info.crystal_memberships[0].crystal_id == "c-1"
        assert info.crystal_memberships[0].folder_path == "/src"
        assert info.conflict is None

    def test_migration_current_status_with_errors(self):
        """MigrationCurrentStatus round-trip including nested MigrationError."""
        data = {
            "status": "running",
            "migrationId": "mig-1",
            "filesTotal": 100,
            "filesProcessed": 50,
            "filesErrored": 2,
            "filesRemaining": 48,
            "currentEntity": "knowledge",
            "entitiesCompleted": ["sessions"],
            "entitiesRemaining": ["knowledge", "crystals"],
            "startedAt": "2026-01-01T00:00:00Z",
            "completedAt": None,
            "elapsedSeconds": 30.5,
            "checkpointId": "cp-1",
            "errors": [
                {
                    "filePath": "/bad.ts",
                    "errorCode": "PARSE_ERROR",
                    "message": "invalid syntax",
                    "recoverable": True,
                },
            ],
        }
        status = MigrationCurrentStatus.model_validate(data)
        assert status.migration_id == "mig-1"
        assert status.files_remaining == 48
        assert status.elapsed_seconds == 30.5
        assert status.completed_at is None
        assert len(status.errors) == 1
        assert status.errors[0].file_path == "/bad.ts"
        assert status.errors[0].recoverable is True

    def test_start_migration_options_snake_case(self):
        """StartMigrationOptions serializes as snake_case (no alias_generator)."""
        opts = StartMigrationOptions(dry_run=True, entity_ids=["e1", "e2"])
        dumped = opts.model_dump(exclude_none=True)
        assert "dry_run" in dumped
        assert dumped["dry_run"] is True
        assert dumped["entity_ids"] == ["e1", "e2"]
        # Must NOT produce camelCase keys
        assert "dryRun" not in dumped
        assert "entityIds" not in dumped

    def test_trigger_sync_options_snake_case(self):
        """TriggerSyncOptions serializes as snake_case (no alias_generator)."""
        opts = TriggerSyncOptions(dry_run=False, scope="errors", file_paths=["/a.ts"])
        dumped = opts.model_dump(exclude_none=True)
        assert dumped["dry_run"] is False
        assert dumped["scope"] == "errors"
        assert dumped["file_paths"] == ["/a.ts"]
        assert "dryRun" not in dumped
        assert "filePaths" not in dumped


class TestBlobTypes:
    """CamelCase alias round-trip for blob response models."""

    def test_blob_metadata_round_trip(self):
        """BlobMetadata from camelCase API data."""
        data = {
            "id": "blob-1",
            "checksum": "sha256:xyz",
            "mimeType": "image/png",
            "sizeBytes": 4096,
            "storagePath": "/storage/blob-1",
            "referenceCount": 3,
            "createdAt": "2026-01-01T00:00:00Z",
            "lastAccessedAt": "2026-01-15T00:00:00Z",
        }
        meta = BlobMetadata.model_validate(data)
        assert meta.mime_type == "image/png"
        assert meta.size_bytes == 4096
        assert meta.reference_count == 3
        assert meta.last_accessed_at == "2026-01-15T00:00:00Z"
        # Round-trip: dump back to camelCase
        dumped = meta.model_dump(by_alias=True)
        assert dumped["mimeType"] == "image/png"
        assert dumped["sizeBytes"] == 4096


class TestAuditTypes:
    """CamelCase alias round-trip + enum validation for audit types."""

    def test_audit_event_round_trip(self):
        """AuditEvent from camelCase API data with all optional fields."""
        data = {
            "id": "ev-1",
            "timestamp": "2026-01-01T00:00:00Z",
            "level": "warn",
            "component": "api",
            "message": "slow query",
            "service": "engram",
            "version": "0.16.0",
            "pid": 1234,
            "hostname": "localhost",
            "eventType": "tool_call",
            "tool": "search",
            "outcome": "success",
            "durationMs": 300,
            "projectPath": "/test",
            "sessionId": "sess-1",
            "input": {"q": "test"},
            "output": {"count": 5},
            "context": {},
            "metadata": {},
            "createdAt": "2026-01-01T00:00:00Z",
        }
        event = AuditEvent.model_validate(data)
        assert event.event_type == "tool_call"
        assert event.duration_ms == 300
        assert event.project_path == "/test"
        assert event.session_id == "sess-1"
        assert event.outcome == "success"

    def test_audit_event_optional_fields_missing(self):
        """AuditEvent with only required fields (optional fields omitted)."""
        data = {
            "id": "ev-2",
            "timestamp": "2026-01-01T00:00:00Z",
            "level": "info",
            "component": "sdk",
            "message": "basic event",
            "service": "engram",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        event = AuditEvent.model_validate(data)
        assert event.event_type is None
        assert event.duration_ms is None
        assert event.tool is None
        assert event.input == {}
        assert event.output == {}

    def test_audit_ingest_params_camel_case(self):
        """AuditIngestParams serializes to camelCase for server."""
        params = AuditIngestParams(
            level="error",
            component="sdk",
            message="test",
            event_type="tool_call",
            duration_ms=150,
            project_path="/test",
            session_id="sess-1",
        )
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert dumped["eventType"] == "tool_call"
        assert dumped["durationMs"] == 150
        assert dumped["projectPath"] == "/test"
        assert dumped["sessionId"] == "sess-1"

    def test_audit_stats_round_trip(self):
        """AuditStats from camelCase with nested dict fields."""
        data = {
            "total": 200,
            "byLevel": {"info": 150, "error": 50},
            "byOutcome": {"success": 180, "failure": 20},
            "byComponent": {"sdk": 120, "api": 80},
        }
        stats = AuditStats.model_validate(data)
        assert stats.total == 200
        assert stats.by_level["info"] == 150
        assert stats.by_outcome["failure"] == 20
        assert stats.by_component["sdk"] == 120
        assert stats.ingester is None


class TestExportImportTypes:
    """CamelCase alias round-trip for export/import models."""

    def test_export_estimate_round_trip(self):
        """ExportEstimate from camelCase API data."""
        data = {
            "knowledgeItems": 100,
            "knowledgeEdges": 50,
            "crystals": 10,
            "crystalMemberships": 200,
            "sessions": 25,
            "sessionNotes": 300,
            "totalEntities": 685,
            "estimatedSizeBytes": 524288,
        }
        est = ExportEstimate.model_validate(data)
        assert est.knowledge_items == 100
        assert est.crystal_memberships == 200
        assert est.total_entities == 685
        assert est.estimated_size_bytes == 524288

    def test_export_params_serialization(self):
        """ExportParams serializes to camelCase with defaults."""
        params = ExportParams(scopes=["knowledge", "crystals"])
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert dumped["scopes"] == ["knowledge", "crystals"]
        assert dumped["format"] == "ndjson"
        assert dumped["compress"] is True

    def test_import_options_serialization(self):
        """ImportOptions serializes to camelCase."""
        opts = ImportOptions(on_conflict="overwrite", force=True, wipe=False)
        dumped = opts.model_dump(by_alias=True, exclude_none=True)
        assert dumped["onConflict"] == "overwrite"
        assert dumped["force"] is True
        assert dumped["wipe"] is False

    def test_import_result_with_nested_counts(self):
        """ImportResult round-trip with nested ImportResultCounts."""
        data = {
            "success": True,
            "counts": {
                "knowledge": {"inserted": 10, "updated": 5, "skipped": 2},
                "crystals": {"inserted": 3, "updated": 1, "skipped": 0},
            },
            "errors": [],
            "duration": 2.5,
        }
        result = ImportResult.model_validate(data)
        assert result.success is True
        assert result.counts["knowledge"].inserted == 10
        assert result.counts["crystals"].skipped == 0
        assert result.duration == 2.5
        assert len(result.errors) == 0

    def test_import_preview_round_trip(self):
        """ImportPreview with nested schema version and counts."""
        data = {
            "success": True,
            "schemaVersion": {
                "archive": "1.0.0",
                "current": "1.1.0",
                "migrationRequired": True,
            },
            "counts": {
                "knowledge": {"new": 10, "updated": 5, "skipped": 0},
            },
            "conflicts": [
                {
                    "id": "k-1",
                    "entityType": "knowledge",
                    "title": "Conflict item",
                    "localUpdatedAt": "2026-01-01T00:00:00Z",
                    "importUpdatedAt": "2026-01-02T00:00:00Z",
                },
            ],
            "conflictCount": 1,
        }
        preview = ImportPreview.model_validate(data)
        assert preview.schema_version.migration_required is True
        assert preview.schema_version.archive == "1.0.0"
        assert preview.counts["knowledge"].new == 10
        assert preview.conflict_count == 1
        assert preview.conflicts[0].entity_type == "knowledge"


class TestEmbeddingTypes:
    """Embedding type round-trip validation."""

    def test_embedding_request_serialization(self):
        """EmbeddingRequest serializes module to camelCase (though it's a simple field)."""
        req = EmbeddingRequest(text="hello world", module="search")
        dumped = req.model_dump(by_alias=True, exclude_none=True)
        assert dumped["text"] == "hello world"
        assert dumped["module"] == "search"

    def test_embedding_response_round_trip(self):
        """EmbeddingResponse parses flat fields correctly."""
        data = {
            "embedding": [0.1, 0.2, 0.3],
            "dimensions": 3,
            "model": "test-model",
            "cached": True,
            "took": 0.05,
        }
        resp = EmbeddingResponse.model_validate(data)
        assert resp.dimensions == 3
        assert resp.cached is True
        assert resp.took == 0.05
        assert len(resp.embedding) == 3

    def test_embedding_info_response_round_trip(self):
        """EmbeddingInfoResponse with nested cache info using Field alias."""
        data = {
            "available": True,
            "model": "nomic-embed-text",
            "dimensions": 768,
            "maxInputChars": 8192,
            "cache": {"size": 100, "maxSize": 1000},
        }
        info = EmbeddingInfoResponse.model_validate(data)
        assert info.available is True
        assert info.max_input_chars == 8192
        assert info.cache.size == 100
        assert info.cache.max_size == 1000


class TestEnumValidation:
    """Enum value validation for Literal-based and str-Enum types."""

    def test_lifecycle_status_values(self):
        """LifecycleStatus enum has all 5 expected values."""
        assert LifecycleStatus.DRAFT.value == "draft"
        assert LifecycleStatus.ACTIVE.value == "active"
        assert LifecycleStatus.FINALIZED.value == "finalized"
        assert LifecycleStatus.ARCHIVED.value == "archived"
        assert LifecycleStatus.SUPERSEDED.value == "superseded"
        assert len(LifecycleStatus) == 5

    def test_lifecycle_stats_defaults(self):
        """LifecycleStats fields default to 0."""
        stats = LifecycleStats()
        assert stats.draft == 0
        assert stats.active == 0
        assert stats.finalized == 0
        assert stats.archived == 0
        assert stats.superseded == 0

    def test_crystal_acl_entry_round_trip(self):
        """AclEntry from camelCase API data validates enum literals."""
        data = {
            "id": "acl-1",
            "crystalId": "c-1",
            "granteeType": "user",
            "granteeId": "u-1",
            "permission": "write",
            "grantedBy": "admin-1",
            "grantedAt": "2026-01-01T00:00:00Z",
        }
        entry = AclEntry.model_validate(data)
        assert entry.grantee_type == "user"
        assert entry.permission == "write"
        assert entry.granted_by == "admin-1"

    def test_grant_permission_params_camel_case(self):
        """GrantPermissionParams serializes to camelCase."""
        params = GrantPermissionParams(
            grantee_type="project",
            grantee_id="proj-1",
            permission="read",
        )
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert dumped["granteeType"] == "project"
        assert dumped["granteeId"] == "proj-1"
        assert dumped["permission"] == "read"

    def test_share_link_round_trip(self):
        """ShareLink from camelCase API data."""
        data = {
            "id": "sl-1",
            "crystalId": "c-1",
            "token": "tok-abc",
            "permission": "read",
            "createdBy": "u-1",
            "maxUses": 10,
            "useCount": 3,
            "expiresAt": "2026-12-31T00:00:00Z",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        link = ShareLink.model_validate(data)
        assert link.token == "tok-abc"
        assert link.max_uses == 10
        assert link.use_count == 3
        assert link.expires_at == "2026-12-31T00:00:00Z"


# ---------------------------------------------------------------------------
# Coverage Gap Remediation Tests
# ---------------------------------------------------------------------------

ALL_NODE_TYPES = [
    "pattern",
    "learning",
    "decision",
    "note",
    "finding",
    "constraint",
    "collection",
    "session_artifact",
    "project",
    "domain",
    "file_ref",
    "directory",
]


@pytest.mark.parametrize("node_type", ALL_NODE_TYPES)
def test_knowledge_crystal_accepts_all_node_types(node_type: str):
    """KnowledgeCrystal.model_validate() accepts each of the 12 NodeType values."""
    data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data["nodeType"] = node_type
    item = KnowledgeCrystal.model_validate(data)
    assert item.node_type == node_type


def test_knowledge_crystal_edge_with_created_by():
    """KnowledgeCrystalEdge correctly parses a non-None createdBy value."""
    data = {
        "id": "edge-user",
        "sourceId": "kc-1",
        "targetId": "kc-2",
        "relationship": "related_to",
        "metadata": {},
        "createdAt": "2026-01-01T00:00:00Z",
        "createdBy": "user-123",
    }
    edge = KnowledgeCrystalEdge.model_validate(data)
    assert edge.created_by == "user-123"


def test_update_knowledge_crystal_params_serialization():
    """UpdateKnowledgeCrystalParams serializes to camelCase correctly."""
    params = UpdateKnowledgeCrystalParams(
        title="Updated", node_type="learning", version=2
    )
    dumped = params.model_dump(by_alias=True, exclude_none=True)
    assert dumped == {"title": "Updated", "nodeType": "learning", "version": 2}


def test_list_knowledge_crystals_params_serialization():
    """ListKnowledgeCrystalsParams serializes to camelCase correctly."""
    params = ListKnowledgeCrystalsParams(node_type="pattern", limit=10)
    dumped = params.model_dump(by_alias=True, exclude_none=True)
    assert dumped["nodeType"] == "pattern"
    assert dumped["limit"] == 10


def test_search_knowledge_crystals_params_serialization():
    """SearchKnowledgeCrystalsParams serializes to camelCase correctly."""
    params = SearchKnowledgeCrystalsParams(
        query="test", node_type="pattern", mode="semantic", threshold=0.5
    )
    dumped = params.model_dump(by_alias=True, exclude_none=True)
    assert dumped["query"] == "test"
    assert dumped["nodeType"] == "pattern"
    assert dumped["mode"] == "semantic"
    assert dumped["threshold"] == 0.5


def test_contained_crystal():
    """ContainedCrystal validates from camelCase API data."""
    data = {"crystalId": "c-1", "depth": 2, "path": ["c-root", "c-1"]}
    contained = ContainedCrystal.model_validate(data)
    assert contained.crystal_id == "c-1"
    assert contained.depth == 2
    assert contained.path == ["c-root", "c-1"]


def test_parent_crystal():
    """ParentCrystal validates from camelCase API data."""
    data = {"crystalId": "c-root", "depth": 1, "path": ["c-root"]}
    parent = ParentCrystal.model_validate(data)
    assert parent.crystal_id == "c-root"
    assert parent.depth == 1
    assert parent.path == ["c-root"]


def test_crystal_hierarchy_with_nested_children():
    """CrystalHierarchy validates recursive tree structure."""
    data = {
        "crystalId": "c-root",
        "depth": 0,
        "children": [
            {
                "crystalId": "c-child-1",
                "depth": 1,
                "children": [
                    {
                        "crystalId": "c-grandchild",
                        "depth": 2,
                        "children": [],
                    }
                ],
            },
            {
                "crystalId": "c-child-2",
                "depth": 1,
                "children": [],
            },
        ],
    }
    hierarchy = CrystalHierarchy.model_validate(data)
    assert hierarchy.crystal_id == "c-root"
    assert hierarchy.depth == 0
    assert len(hierarchy.children) == 2
    assert hierarchy.children[0].crystal_id == "c-child-1"
    assert len(hierarchy.children[0].children) == 1
    assert hierarchy.children[0].children[0].crystal_id == "c-grandchild"
    assert hierarchy.children[0].children[0].depth == 2
    assert hierarchy.children[1].crystal_id == "c-child-2"
    assert hierarchy.children[1].children == []


def test_promotion_summary():
    """PromotionSummary validates from camelCase API data."""
    data = {"promotedCount": 5, "skippedCount": 2, "errorCount": 1}
    summary = PromotionSummary.model_validate(data)
    assert summary.promoted_count == 5
    assert summary.skipped_count == 2
    assert summary.error_count == 1


def test_scoped_search_result():
    """ScopedSearchResult validates from camelCase API data."""
    data = {
        "id": "kc-1",
        "type": "pattern",
        "title": "Auth Pattern",
        "contentInline": "Use JWT tokens",
        "summary": "JWT-based auth",
        "tags": ["auth", "security"],
        "similarity": 0.92,
        "createdAt": "2026-01-01T00:00:00Z",
    }
    result = ScopedSearchResult.model_validate(data)
    assert result.id == "kc-1"
    assert result.type == "pattern"
    assert result.title == "Auth Pattern"
    assert result.content_inline == "Use JWT tokens"
    assert result.summary == "JWT-based auth"
    assert result.tags == ["auth", "security"]
    assert result.similarity == 0.92
    assert result.created_at == "2026-01-01T00:00:00Z"


def test_scoped_search_result_minimal():
    """ScopedSearchResult validates with optional fields omitted."""
    data = {
        "id": "kc-2",
        "type": "learning",
        "title": "Minimal Result",
        "similarity": 0.5,
        "createdAt": "2026-01-01T00:00:00Z",
    }
    result = ScopedSearchResult.model_validate(data)
    assert result.content_inline is None
    assert result.summary is None
    assert result.tags == []


def test_knowledge_crystal_confidence_none():
    """KnowledgeCrystal with confidence: None validates correctly."""
    data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data["confidence"] = None
    item = KnowledgeCrystal.model_validate(data)
    assert item.confidence is None


def test_knowledge_crystal_content_ref_none():
    """KnowledgeCrystal with contentRef: None validates correctly."""
    data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data["contentRef"] = None
    item = KnowledgeCrystal.model_validate(data)
    assert item.content_ref is None


ALL_SOURCE_TYPES = ["session", "manual", "import", "promotion", "finalization"]


@pytest.mark.parametrize("source_type", ALL_SOURCE_TYPES)
def test_knowledge_crystal_all_source_types(source_type: str):
    """KnowledgeCrystal accepts all 5 sourceType values."""
    data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data["sourceType"] = source_type
    item = KnowledgeCrystal.model_validate(data)
    assert item.source_type == source_type


def test_knowledge_crystal_search_result_with_highlights():
    """KnowledgeCrystalSearchResult validates with highlights present."""
    crystal_data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data = {
        "item": crystal_data,
        "score": 0.95,
        "highlights": {
            "title": ["<em>Auth</em> Pattern"],
            "contentInline": ["Use <em>JWT</em> tokens"],
        },
    }
    result = KnowledgeCrystalSearchResult.model_validate(data)
    assert result.score == 0.95
    assert result.highlights is not None
    assert "title" in result.highlights
    assert len(result.highlights["title"]) == 1
    assert result.item.title == "Auth Pattern"


def test_knowledge_crystal_search_result_without_highlights():
    """KnowledgeCrystalSearchResult validates with highlights absent."""
    crystal_data = copy.deepcopy(SAMPLE_KNOWLEDGE_CRYSTAL)
    data = {
        "item": crystal_data,
        "score": 0.7,
    }
    result = KnowledgeCrystalSearchResult.model_validate(data)
    assert result.score == 0.7
    assert result.highlights is None


# ---------------------------------------------------------------------------
# Factory Helper Tests
# ---------------------------------------------------------------------------


class TestFactoryHelpers:
    """Tests that validate factory helper functions work correctly."""

    def test_make_crystal_defaults(self):
        """make_crystal() returns a valid KnowledgeCrystal with defaults."""
        crystal = make_crystal()
        assert crystal.id == "kc-test"
        assert crystal.node_type == "pattern"
        assert crystal.title == "Test Crystal"

    def test_make_crystal_override(self):
        """make_crystal() accepts overrides for any field."""
        crystal = make_crystal(id="custom", node_type="learning", title="My Learning")
        assert crystal.id == "custom"
        assert crystal.node_type == "learning"
        assert crystal.title == "My Learning"

    def test_make_crystal_used_3_times(self):
        """make_crystal() can be called multiple times to generate independent instances."""
        c1 = make_crystal(id="c1", title="First")
        c2 = make_crystal(id="c2", title="Second")
        c3 = make_crystal(id="c3", title="Third")
        assert c1.id != c2.id
        assert c2.id != c3.id
        assert c1.title == "First"
        assert c3.title == "Third"

    def test_make_session_defaults(self):
        """make_session() returns a valid LocalSession with defaults."""
        session = make_session()
        assert session.id == "sess-test"
        assert session.project_path == "/test"
        assert session.status == "active"

    def test_make_session_override(self):
        """make_session() accepts overrides for id and project_path."""
        session = make_session(id="sess-custom", project_path="/workspace/myproject")
        assert session.id == "sess-custom"
        assert session.project_path == "/workspace/myproject"

    def test_make_session_used_3_times(self):
        """make_session() can be called multiple times to generate independent instances."""
        s1 = make_session(id="s1", project_path="/a")
        s2 = make_session(id="s2", project_path="/b")
        s3 = make_session(id="s3", project_path="/c")
        assert s1.id != s2.id
        assert s2.id != s3.id
        assert s1.project_path == "/a"
        assert s3.project_path == "/c"

    def test_make_note_defaults(self):
        """make_note() returns a valid LocalSessionNote with defaults."""
        note = make_note()
        assert note.id == "note-test"
        assert note.session_id == "sess-test"
        assert note.content == "Test note"
        assert note.type == "observation"

    def test_make_note_override(self):
        """make_note() accepts overrides for content and note_type."""
        note = make_note(id="note-custom", content="Custom content", note_type="decision")
        assert note.id == "note-custom"
        assert note.content == "Custom content"
        assert note.type == "decision"

    def test_make_note_used_3_times(self):
        """make_note() can be called multiple times to generate independent instances."""
        n1 = make_note(id="n1", content="First note")
        n2 = make_note(id="n2", content="Second note")
        n3 = make_note(id="n3", content="Third note")
        assert n1.id != n2.id
        assert n2.id != n3.id
        assert n1.content == "First note"
        assert n3.content == "Third note"


# ---------------------------------------------------------------------------
# Validation Error Tests
# ---------------------------------------------------------------------------


class TestValidationErrors:
    """Tests that invalid data raises Pydantic ValidationError."""

    def test_knowledge_crystal_missing_required_id(self):
        """KnowledgeCrystal raises ValidationError when 'id' is missing."""
        data = {
            "nodeType": "pattern",
            "title": "Missing ID",
            # "id" intentionally omitted
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        with pytest.raises(ValidationError):
            KnowledgeCrystal.model_validate(data)

    def test_local_session_missing_project_path(self):
        """LocalSession raises ValidationError when projectPath is missing."""
        data = {
            "id": "sess-bad",
            "status": "active",
            "startedAt": "2026-01-01T00:00:00Z",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
            # "projectPath" intentionally omitted
        }
        with pytest.raises(ValidationError):
            LocalSession.model_validate(data)

    def test_local_session_note_missing_session_id(self):
        """LocalSessionNote raises ValidationError when sessionId is missing."""
        data = {
            "id": "note-bad",
            # "sessionId" intentionally omitted
            "type": "observation",
            "content": "Some content",
            "embeddingStatus": "pending",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        with pytest.raises(ValidationError):
            LocalSessionNote.model_validate(data)

    def test_knowledge_crystal_missing_node_type(self):
        """KnowledgeCrystal raises ValidationError when nodeType is missing."""
        data = {
            "id": "kc-bad",
            "title": "No Node Type",
            # "nodeType" intentionally omitted
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        with pytest.raises(ValidationError):
            KnowledgeCrystal.model_validate(data)


# ---------------------------------------------------------------------------
# CamelCase <-> snake_case Alias Mapping Tests
# ---------------------------------------------------------------------------


class TestCamelSnakeMappings:
    """Tests that camelCase <-> snake_case alias mapping works bidirectionally."""

    def test_crystal_camel_to_snake_aliases(self):
        """KnowledgeCrystal maps nodeType->node_type, sourceType->source_type, etc."""
        crystal = make_crystal()
        assert hasattr(crystal, "node_type")
        assert hasattr(crystal, "source_type")
        assert hasattr(crystal, "content_ref")
        assert hasattr(crystal, "embedding_status")

    def test_crystal_round_trip_camel(self):
        """KnowledgeCrystal.model_dump(by_alias=True) produces camelCase keys."""
        crystal = make_crystal(node_type="learning", title="Round Trip")
        dumped = crystal.model_dump(by_alias=True)
        assert "nodeType" in dumped
        assert dumped["nodeType"] == "learning"
        assert "contentRef" in dumped
        assert "embeddingStatus" in dumped

    def test_crystal_snake_case_not_in_camel_dump(self):
        """KnowledgeCrystal.model_dump(by_alias=True) does not contain snake_case keys."""
        crystal = make_crystal()
        dumped = crystal.model_dump(by_alias=True)
        assert "node_type" not in dumped
        assert "source_type" not in dumped
        assert "embedding_status" not in dumped

    def test_session_camel_to_snake(self):
        """LocalSession maps projectPath->project_path, externalId->external_id."""
        session = make_session()
        assert hasattr(session, "project_path")
        assert hasattr(session, "external_id")
        assert hasattr(session, "started_at")
        assert session.project_path == "/test"
        assert session.external_id is None

    def test_note_camel_to_snake(self):
        """LocalSessionNote maps sessionId->session_id, embeddingStatus->embedding_status."""
        note = make_note()
        assert hasattr(note, "session_id")
        assert hasattr(note, "embedding_status")
        assert note.session_id == "sess-test"
        assert note.embedding_status == "pending"

    def test_create_crystal_params_by_alias(self):
        """CreateKnowledgeCrystalParams dumps node_type as nodeType."""
        params = CreateKnowledgeCrystalParams(node_type="pattern", title="Test")
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert "nodeType" in dumped
        assert "node_type" not in dumped
        assert dumped["nodeType"] == "pattern"

    def test_create_session_params_by_alias(self):
        """CreateLocalSessionParams dumps project_path as projectPath."""
        params = CreateLocalSessionParams(project_path="/my/project")
        dumped = params.model_dump(by_alias=True, exclude_none=True)
        assert "projectPath" in dumped
        assert "project_path" not in dumped
        assert dumped["projectPath"] == "/my/project"
