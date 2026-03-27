"""Comprehensive async tests for all AsyncEngramClient resource types.

Covers all 12 resource types using pytest-asyncio (asyncio_mode = auto) and
AsyncMock patched on httpx.AsyncClient.request.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from engram.client import AsyncEngramClient
from engram.types.sessions import (
    CreateLocalSessionParams,
    CreateLocalNoteParams,
    FinalizeSessionOptions,
    ListLocalSessionsParams,
    SearchLocalNotesParams,
    UpdateLocalSessionParams,
)
from engram.types.knowledge_crystal import (
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
    ListKnowledgeCrystalsParams,
    SearchKnowledgeCrystalsParams,
    CreateKnowledgeCrystalEdgeParams,
    ListKnowledgeCrystalEdgesParams,
)
from engram.types.audit import (
    AuditIngestParams,
    AuditListParams,
    AuditStatsParams,
)
from engram.types.export_import import ExportParams
from engram.types.terrafirma import TriggerSyncOptions
from engram.types.coordination import CreateSessionLinkParams
from tests.conftest import (
    make_api_response,
    SAMPLE_SESSION,
    SAMPLE_NOTE,
    SAMPLE_KNOWLEDGE_CRYSTAL,
    SAMPLE_CRYSTAL,
    SAMPLE_EDGE,
    SAMPLE_SESSION_LINK,
)

# ---------------------------------------------------------------------------
# Shared sample data
# ---------------------------------------------------------------------------

SAMPLE_FINALIZE_RESULT = {
    "session": SAMPLE_SESSION,
    "crystal": SAMPLE_KNOWLEDGE_CRYSTAL,
    "promotedItems": 3,
}

SAMPLE_LIFECYCLE_STATS = {
    "sessionId": "sess-123",
    "counts": {"active": 2, "archived": 1},
}

SAMPLE_CRYSTAL_SEARCH_RESULT = {
    "item": SAMPLE_KNOWLEDGE_CRYSTAL,
    "score": 0.95,
    "highlights": {"title": ["Auth Pattern"]},
}

SAMPLE_AUDIT_EVENT = {
    "id": "evt-001",
    "timestamp": "2026-01-01T00:00:00Z",
    "level": "info",
    "component": "test",
    "message": "test event",
    "service": "engram",
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_AUDIT_INGEST_RESULT = {"accepted": True}

SAMPLE_AUDIT_STATS = {
    "total": 10,
    "byLevel": {"info": 8, "error": 2},
    "byOutcome": {"success": 9, "failure": 1},
    "byComponent": {"test": 10},
}

SAMPLE_EXPORT_ESTIMATE = {
    "knowledgeItems": 5,
    "knowledgeEdges": 2,
    "crystals": 3,
    "crystalMemberships": 0,
    "sessions": 1,
    "sessionNotes": 5,
    "totalEntities": 16,
    "estimatedSizeBytes": 4096,
}

SAMPLE_IMPORT_PREVIEW = {
    "success": True,
    "schemaVersion": None,
    "counts": None,
    "conflicts": None,
    "conflictCount": None,
    "error": None,
}

SAMPLE_TERRAFIRMA_STATUS = {
    "mode": "steady_state",
    "watcher": {
        "status": "running",
        "uptimeSeconds": 3600,
        "eventsProcessed24h": 100,
        "lastEventAt": None,
    },
    "reconciler": {
        "status": "idle",
        "lastRunAt": "2026-01-01T00:00:00Z",
        "nextRunAt": "2026-01-01T01:00:00Z",
    },
    "sync": {
        "total": 10,
        "synced": 8,
        "pending": 1,
        "syncing": 0,
        "fsDirty": 1,
        "conflict": 0,
        "orphaned": 0,
        "error": 0,
    },
    "suggestedActions": [],
}

SAMPLE_TERRAFIRMA_FILE_INFO = {
    "filePath": "/test/file.md",
    "syncStatus": "synced",
    "contentHash": "abc123",
    "lastModified": "2026-01-01T00:00:00Z",
    "sizeBytes": 1024,
    "entityId": "kc-789",
    "crystalMemberships": [],
    "engramItemId": "kc-789",
    "version": 1,
    "lastSyncedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_SYNC_RESULT = {
    "dry_run": False,
}

SAMPLE_BLOB_UPLOAD = {
    "id": "blob-001",
    "checksum": "sha256:abc",
    "mimeType": "text/plain",
    "sizeBytes": 13,
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_BLOB_METADATA = {
    "id": "blob-001",
    "checksum": "sha256:abc",
    "mimeType": "text/plain",
    "sizeBytes": 13,
    "storagePath": "/blobs/blob-001",
    "referenceCount": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "lastAccessedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_EMBEDDING_RESPONSE = {
    "embedding": [0.1, 0.2, 0.3],
    "dimensions": 3,
    "model": "minilm",
    "cached": False,
    "took": 10.0,
}

SAMPLE_BATCH_EMBEDDING_RESPONSE = {
    "embeddings": [
        {"embedding": [0.1, 0.2, 0.3], "dimensions": 3, "cached": False},
        {"embedding": [0.4, 0.5, 0.6], "dimensions": 3, "cached": False},
    ],
    "count": 2,
    "model": "minilm",
    "took": 20.0,
}

SAMPLE_EMBEDDING_INFO = {
    "available": True,
    "model": "minilm",
    "dimensions": 384,
    "maxInputChars": 512,
    "cache": {"size": 50, "maxSize": 1000},
}


def _make_response(json_data, method="GET", url="http://test:3100/"):
    return httpx.Response(
        200,
        json=json_data,
        request=httpx.Request(method, url),
    )


def _make_no_content_response(method="DELETE", url="http://test:3100/"):
    return httpx.Response(
        204,
        request=httpx.Request(method, url),
    )


# ===========================================================================
# 1. Sessions Resource (6 tests)
# ===========================================================================


class TestAsyncSessionsResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_session(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_SESSION), "POST", "http://test:3100/v1/sessions"
            )
            session = await self.client.sessions.create(
                CreateLocalSessionParams(project_path="/test/project")
            )
            assert session.id == "sess-123"
            assert session.status == "active"

    async def test_get_session(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_SESSION), "GET", "http://test:3100/v1/sessions/sess-123"
            )
            session = await self.client.sessions.get("sess-123")
            assert session.id == "sess-123"

    async def test_list_sessions(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_SESSION], total=1), "GET", "http://test:3100/v1/sessions"
            )
            result = await self.client.sessions.list()
            assert len(result.items) == 1
            assert result.items[0].id == "sess-123"

    async def test_list_sessions_with_params(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_SESSION], total=1), "GET", "http://test:3100/v1/sessions"
            )
            result = await self.client.sessions.list(
                ListLocalSessionsParams(status="active", limit=10)
            )
            assert len(result.items) == 1

    async def test_update_session(self):
        updated = {**SAMPLE_SESSION, "status": "finalized"}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(updated), "PATCH", "http://test:3100/v1/sessions/sess-123"
            )
            session = await self.client.sessions.update(
                "sess-123", UpdateLocalSessionParams(status="finalized")
            )
            assert session.status == "finalized"

    async def test_delete_session(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_no_content_response("DELETE", "http://test:3100/v1/sessions/sess-123")
            result = await self.client.sessions.delete("sess-123")
            assert result is None

    async def test_finalize_session(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_FINALIZE_RESULT), "POST", "http://test:3100/v1/sessions/sess-123/finalize"
            )
            result = await self.client.sessions.finalize("sess-123")
            assert result.session.id == "sess-123"
            assert result.promoted_items == 3

    async def test_finalize_session_with_options(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_FINALIZE_RESULT), "POST", "http://test:3100/v1/sessions/sess-123/finalize"
            )
            result = await self.client.sessions.finalize(
                "sess-123", FinalizeSessionOptions(crystal_name="My Crystal")
            )
            assert result.session.id == "sess-123"


# ===========================================================================
# 2. Notes Resource (5 tests — via sessions.notes sub-resource)
# ===========================================================================


class TestAsyncNotesResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_note(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_NOTE), "POST", "http://test:3100/v1/sessions/sess-123/notes"
            )
            note = await self.client.sessions.notes("sess-123").create(
                CreateLocalNoteParams(type="decision", content="Use PostgreSQL")
            )
            assert note.id == "note-456"
            assert note.content == "Use PostgreSQL"

    async def test_list_notes(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_NOTE], total=1), "GET", "http://test:3100/v1/sessions/sess-123/notes"
            )
            result = await self.client.sessions.notes("sess-123").list()
            assert len(result.items) == 1
            assert result.items[0].id == "note-456"

    async def test_search_notes_in_session(self):
        search_result = {**SAMPLE_NOTE, "score": 0.9}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([search_result]), "POST", "http://test:3100/v1/sessions/sess-123/notes/search"
            )
            results = await self.client.sessions.notes("sess-123").search(
                SearchLocalNotesParams(query="PostgreSQL")
            )
            assert len(results) == 1

    async def test_get_note_globally(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_NOTE), "GET", "http://test:3100/v1/notes/note-456"
            )
            note = await self.client.notes.get("note-456")
            assert note.id == "note-456"

    async def test_search_notes_globally(self):
        search_result = {**SAMPLE_NOTE, "score": 0.9}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([search_result]), "POST", "http://test:3100/v1/notes/search"
            )
            results = await self.client.notes.search(
                SearchLocalNotesParams(query="PostgreSQL")
            )
            assert len(results) == 1


# ===========================================================================
# 3. Crystals Resource (6 tests)
# ===========================================================================


class TestAsyncCrystalsResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_crystal(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_CRYSTAL), "POST", "http://test:3100/v1/crystals"
            )
            crystal = await self.client.crystals.create(
                CreateKnowledgeCrystalParams(node_type="collection", title="Test Crystal")
            )
            assert crystal.id == "crystal-201"
            assert crystal.title == "Test Crystal"

    async def test_get_crystal(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_CRYSTAL), "GET", "http://test:3100/v1/crystals/crystal-201"
            )
            crystal = await self.client.crystals.get("crystal-201")
            assert crystal.id == "crystal-201"

    async def test_list_crystals(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_CRYSTAL], total=1), "GET", "http://test:3100/v1/crystals"
            )
            result = await self.client.crystals.list()
            assert len(result.items) == 1
            assert result.items[0].id == "crystal-201"

    async def test_list_crystals_with_params(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_CRYSTAL], total=1), "GET", "http://test:3100/v1/crystals"
            )
            result = await self.client.crystals.list(
                ListKnowledgeCrystalsParams(node_type="collection", limit=5)
            )
            assert len(result.items) == 1

    async def test_update_crystal(self):
        updated = {**SAMPLE_CRYSTAL, "title": "Updated Crystal"}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(updated), "PATCH", "http://test:3100/v1/crystals/crystal-201"
            )
            crystal = await self.client.crystals.update(
                "crystal-201", UpdateKnowledgeCrystalParams(title="Updated Crystal")
            )
            assert crystal.title == "Updated Crystal"

    async def test_delete_crystal(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_no_content_response("DELETE", "http://test:3100/v1/crystals/crystal-201")
            result = await self.client.crystals.delete("crystal-201")
            assert result is None

    async def test_search_crystals(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_CRYSTAL_SEARCH_RESULT]), "POST", "http://test:3100/v1/crystals/search"
            )
            results = await self.client.crystals.search(
                SearchKnowledgeCrystalsParams(query="test crystal")
            )
            assert len(results) == 1


# ===========================================================================
# 4. Knowledge (crystals) Resource — additional tests (4 tests)
# ===========================================================================


class TestAsyncKnowledgeCrystalsResource:
    """Tests for knowledge operations using the crystals resource."""

    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_knowledge_crystal(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_KNOWLEDGE_CRYSTAL), "POST", "http://test:3100/v1/crystals"
            )
            crystal = await self.client.crystals.create(
                CreateKnowledgeCrystalParams(node_type="pattern", title="Auth Pattern")
            )
            assert crystal.id == "kc-789"
            assert crystal.node_type == "pattern"

    async def test_get_knowledge_crystal(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_KNOWLEDGE_CRYSTAL), "GET", "http://test:3100/v1/crystals/kc-789"
            )
            crystal = await self.client.crystals.get("kc-789")
            assert crystal.id == "kc-789"
            assert crystal.title == "Auth Pattern"
            assert crystal.verified is True

    async def test_list_knowledge_crystals_by_type(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_KNOWLEDGE_CRYSTAL], total=1), "GET", "http://test:3100/v1/crystals"
            )
            result = await self.client.crystals.list(
                ListKnowledgeCrystalsParams(node_type="pattern")
            )
            assert len(result.items) == 1
            assert result.items[0].node_type == "pattern"

    async def test_search_knowledge_crystals(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_CRYSTAL_SEARCH_RESULT]), "POST", "http://test:3100/v1/crystals/search"
            )
            results = await self.client.crystals.search(
                SearchKnowledgeCrystalsParams(query="auth patterns")
            )
            assert len(results) == 1


# ===========================================================================
# 5. Edges Resource (4 tests)
# ===========================================================================


class TestAsyncEdgesResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_edge(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_EDGE), "POST", "http://test:3100/v1/edges"
            )
            edge = await self.client.edges.create(
                CreateKnowledgeCrystalEdgeParams(
                    source_id="kc-789",
                    target_id="kc-790",
                    relationship="related_to",
                )
            )
            assert edge.id == "edge-101"
            assert edge.source_id == "kc-789"

    async def test_get_edge(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_EDGE), "GET", "http://test:3100/v1/edges/edge-101"
            )
            edge = await self.client.edges.get("edge-101")
            assert edge.id == "edge-101"
            assert edge.relationship == "related_to"

    async def test_list_edges(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_EDGE], total=1), "GET", "http://test:3100/v1/edges"
            )
            result = await self.client.edges.list()
            assert len(result.items) == 1
            assert result.items[0].id == "edge-101"

    async def test_list_edges_with_params(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_EDGE], total=1), "GET", "http://test:3100/v1/edges"
            )
            result = await self.client.edges.list(
                ListKnowledgeCrystalEdgesParams(source_id="kc-789")
            )
            assert len(result.items) == 1


# ===========================================================================
# 6. Health (3 tests)
# ===========================================================================


class TestAsyncHealth:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_health(self):
        health_data = {"status": "ok", "version": "1.0.0"}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(health_data, "GET", "http://test:3100/v1/health")
            result = await self.client.health()
            assert result["status"] == "ok"

    async def test_health_ready(self):
        ready_data = {"ready": True}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(ready_data, "GET", "http://test:3100/health/ready")
            result = await self.client.health_ready()
            assert result["ready"] is True

    async def test_health_detailed(self):
        detailed_data = {"status": "ok", "db": {"status": "ok"}, "embedding": {"available": True}}
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(detailed_data, "GET", "http://test:3100/health/detailed")
            result = await self.client.health_detailed()
            assert result["status"] == "ok"
            assert "db" in result


# ===========================================================================
# 7. Blobs Resource (4 tests)
# ===========================================================================


class TestAsyncBlobsResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_upload_blob(self):
        content = b"Hello, World!"
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_success = True
        mock_response.json.return_value = {"data": SAMPLE_BLOB_UPLOAD}
        mock_response.status_code = 200
        mock_response.content = content
        mock_response.headers = {}

        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = mock_response
            result = await self.client.blobs.upload(content, mime_type="text/plain")
            assert result.id == "blob-001"
            assert result.mime_type == "text/plain"

    async def test_download_blob(self):
        content = b"Hello, World!"
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_success = True
        mock_response.content = content
        mock_response.status_code = 200
        mock_response.headers = {}

        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = mock_response
            data = await self.client.blobs.download("blob-001")
            assert data == content

    async def test_get_blob_metadata(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_BLOB_METADATA), "GET", "http://test:3100/v1/blobs/blob-001/metadata"
            )
            meta = await self.client.blobs.get_metadata("blob-001")
            assert meta is not None
            assert meta.id == "blob-001"
            assert meta.size_bytes == 13

    async def test_delete_blob(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_no_content_response("DELETE", "http://test:3100/v1/blobs/blob-001")
            result = await self.client.blobs.delete("blob-001")
            assert result is None


# ===========================================================================
# 8. Audit Resource (4 tests)
# ===========================================================================


class TestAsyncAuditResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_ingest_audit_event(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_AUDIT_INGEST_RESULT), "POST", "http://test:3100/v1/audit/ingest"
            )
            result = await self.client.audit.ingest(
                AuditIngestParams(
                    timestamp="2026-01-01T00:00:00Z",
                    level="info",
                    component="test",
                    message="test event",
                    service="engram",
                )
            )
            assert result.accepted is True

    async def test_list_audit_events(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_AUDIT_EVENT], total=1), "GET", "http://test:3100/v1/audit/events"
            )
            result = await self.client.audit.list_events()
            assert len(result.items) == 1
            assert result.items[0].id == "evt-001"

    async def test_list_audit_events_with_params(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_AUDIT_EVENT], total=1), "GET", "http://test:3100/v1/audit/events"
            )
            result = await self.client.audit.list_events(
                AuditListParams(limit=10)
            )
            assert len(result.items) == 1

    async def test_get_audit_stats(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_AUDIT_STATS), "GET", "http://test:3100/v1/audit/stats"
            )
            stats = await self.client.audit.get_stats()
            assert stats.total == 10


# ===========================================================================
# 9. Export/Import Resource (4 tests)
# ===========================================================================


class TestAsyncExportImportResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_estimate_export(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_EXPORT_ESTIMATE), "POST", "http://test:3100/v1/export/estimate"
            )
            estimate = await self.client.export_import.estimate_export(
                ExportParams(scopes=["crystals"])
            )
            assert estimate.crystals == 3
            assert estimate.estimated_size_bytes == 4096

    async def test_estimate_export_multiple_scopes(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_EXPORT_ESTIMATE), "POST", "http://test:3100/v1/export/estimate"
            )
            estimate = await self.client.export_import.estimate_export(
                ExportParams(scopes=["crystals", "sessions"])
            )
            assert estimate.sessions == 1
            assert estimate.session_notes == 5

    async def test_preview_import(self):
        file_bytes = b'{"type": "engram-export"}'
        mock_multipart_response = {"data": SAMPLE_IMPORT_PREVIEW}
        with patch.object(
            self.client, "_request_multipart", new_callable=AsyncMock
        ) as mock_mp:
            mock_mp.return_value = mock_multipart_response
            preview = await self.client.export_import.preview_import(
                file=file_bytes,
                filename="export.ndjson",
                content_type="application/x-ndjson",
            )
            assert preview.success is True
            mock_mp.assert_called_once()

    async def test_estimate_export_knowledge_scope(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_EXPORT_ESTIMATE), "POST", "http://test:3100/v1/export/estimate"
            )
            estimate = await self.client.export_import.estimate_export(
                ExportParams(scopes=["knowledge"])
            )
            assert estimate.estimated_size_bytes > 0


# ===========================================================================
# 10. Embeddings (3 tests)
# ===========================================================================


class TestAsyncEmbeddings:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_embed_single_text(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                SAMPLE_EMBEDDING_RESPONSE, "POST", "http://test:3100/v1/embeddings"
            )
            result = await self.client.embed("hello")
            assert result.dimensions == 3
            assert len(result.embedding) == 3
            assert result.model == "minilm"

    async def test_embed_batch(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                SAMPLE_BATCH_EMBEDDING_RESPONSE, "POST", "http://test:3100/v1/embeddings/batch"
            )
            result = await self.client.embed_batch(["hello", "world"])
            assert result.count == 2
            assert len(result.embeddings) == 2
            assert result.model == "minilm"

    async def test_embedding_info(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                SAMPLE_EMBEDDING_INFO, "GET", "http://test:3100/v1/embeddings/info"
            )
            info = await self.client.embedding_info()
            assert info.available is True
            assert info.dimensions == 384
            assert info.model == "minilm"


# ===========================================================================
# 11. Terrafirma Resource (4 tests)
# ===========================================================================


class TestAsyncTerrafirmaResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_get_status(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_TERRAFIRMA_STATUS), "GET", "http://test:3100/v1/terrafirma/status"
            )
            status = await self.client.terrafirma.get_status()
            assert status.mode == "steady_state"

    async def test_get_file_info(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_TERRAFIRMA_FILE_INFO), "GET", "http://test:3100/v1/terrafirma/files/..."
            )
            info = await self.client.terrafirma.get_file_info("/test/file.md")
            assert info is not None
            assert info.file_path == "/test/file.md"
            assert info.sync_status == "synced"

    async def test_get_file_info_not_found(self):
        from engram.errors import EngramError
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            error_response = httpx.Response(
                404,
                json={"error": {"code": "NOT_FOUND", "message": "File not found"}},
                request=httpx.Request("GET", "http://test:3100/v1/terrafirma/files/missing"),
            )
            mock_req.return_value = error_response
            info = await self.client.terrafirma.get_file_info("/missing/file.md")
            assert info is None

    async def test_trigger_sync(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_SYNC_RESULT), "POST", "http://test:3100/v1/terrafirma/sync"
            )
            result = await self.client.terrafirma.trigger_sync(
                TriggerSyncOptions(dry_run=False, scope="all")
            )
            assert result.dry_run is False


# ===========================================================================
# 12. Session Links Resource (4 tests)
# ===========================================================================


class TestAsyncSessionLinksResource:
    def setup_method(self):
        self.client = AsyncEngramClient(base_url="http://test:3100")

    async def teardown_method(self):
        await self.client.close()

    async def test_create_session_link(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_SESSION_LINK), "POST", "http://test:3100/v1/session-links"
            )
            link = await self.client.session_links.create(
                CreateSessionLinkParams(
                    source_session_id="sess-123",
                    target_session_id="sess-456",
                    relationship="builds_on",
                )
            )
            assert link.id == "sl-1"
            assert link.source_session_id == "sess-123"
            assert link.relationship == "builds_on"

    async def test_list_outgoing_session_links(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response([SAMPLE_SESSION_LINK], total=1),
                "GET",
                "http://test:3100/v1/session-links/outgoing/sess-123",
            )
            result = await self.client.session_links.list_outgoing("sess-123")
            assert len(result.items) == 1
            assert result.items[0].id == "sl-1"

    async def test_get_session_link(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_response(
                make_api_response(SAMPLE_SESSION_LINK), "GET", "http://test:3100/v1/session-links/sl-1"
            )
            link = await self.client.session_links.get("sl-1")
            assert link.id == "sl-1"

    async def test_delete_session_link(self):
        with patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _make_no_content_response("DELETE", "http://test:3100/v1/session-links/sl-1")
            result = await self.client.session_links.delete("sl-1")
            assert result is None
