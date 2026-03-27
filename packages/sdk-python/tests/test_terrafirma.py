"""Tests for terrafirma resource."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import EngramClient
from engram.errors import NotFoundError
from engram.types.terrafirma import (
    CrystalMembershipInfo,
    MigrationCurrentStatus,
    MigrationStartResult,
    StartMigrationOptions,
    SyncResult,
    TerrafirmaFileInfo,
    TerrafirmaStatus,
    TriggerSyncOptions,
)
from tests.conftest import make_api_response


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

SAMPLE_STATUS = {
    "mode": "steady_state",
    "watcher": {
        "status": "running",
        "uptimeSeconds": 3600,
        "eventsProcessed24h": 150,
        "lastEventAt": "2026-01-01T12:00:00Z",
    },
    "reconciler": {
        "status": "idle",
        "lastRunAt": "2026-01-01T11:55:00Z",
        "nextRunAt": "2026-01-01T12:05:00Z",
    },
    "sync": {
        "total": 100,
        "synced": 95,
        "pending": 3,
        "syncing": 1,
        "fsDirty": 1,
        "conflict": 0,
        "orphaned": 0,
        "error": 0,
        "lastSyncedAt": "2026-01-01T12:00:00Z",
    },
    "suggestedActions": [
        {
            "action": "sync_pending",
            "label": "Sync pending files",
            "endpoint": "/v1/terrafirma/sync",
            "count": 3,
        }
    ],
}

SAMPLE_FILE_INFO = {
    "filePath": "/project/src/main.ts",
    "syncStatus": "synced",
    "contentHash": "abc123",
    "lastModified": "2026-01-01T12:00:00Z",
    "sizeBytes": 1024,
    "entityId": "entity-1",
    "crystalMemberships": [
        {
            "crystalId": "crystal-1",
            "nodeType": "collection",
            "tags": ["tf-category"],
            "folderPath": "/src",
        }
    ],
    "engramItemId": "ki-1",
    "version": 3,
    "lastSyncedAt": "2026-01-01T12:00:00Z",
    "conflict": None,
}

SAMPLE_MIGRATION_STATUS = {
    "status": "completed",
    "migrationId": "mig-1",
    "filesTotal": 50,
    "filesProcessed": 50,
    "filesErrored": 0,
    "filesRemaining": 0,
    "currentEntity": None,
    "entitiesCompleted": ["entity-1", "entity-2"],
    "entitiesRemaining": [],
    "startedAt": "2026-01-01T10:00:00Z",
    "completedAt": "2026-01-01T10:05:00Z",
    "elapsedSeconds": 300.5,
    "checkpointId": "cp-1",
    "errors": [],
}

SAMPLE_MIGRATION_START = {
    "dryRun": False,
}

SAMPLE_SYNC_RESULT = {
    "dryRun": True,
}


# ===========================================================================
# Tests
# ===========================================================================


class TestSyncTerrafirmaResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_get_status(self, mock_request):
        """get_status returns TerrafirmaStatus with correct fields."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_STATUS),
            request=httpx.Request("GET", "http://test:3100/v1/terrafirma/status"),
        )

        status = self.client.terrafirma.get_status()

        assert isinstance(status, TerrafirmaStatus)
        assert status.mode == "steady_state"
        assert status.watcher.status == "running"
        assert status.watcher.uptime_seconds == 3600
        assert status.watcher.events_processed_24h == 150
        assert status.reconciler.status == "idle"
        assert status.sync.total == 100
        assert status.sync.synced == 95
        assert status.sync.fs_dirty == 1
        assert len(status.suggested_actions) == 1
        assert status.suggested_actions[0].action == "sync_pending"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/terrafirma/status" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_file_info(self, mock_request):
        """get_file_info returns TerrafirmaFileInfo with snake_case fields."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_FILE_INFO),
            request=httpx.Request("GET", "http://test:3100/v1/terrafirma/files/test"),
        )

        info = self.client.terrafirma.get_file_info("/project/src/main.ts")

        assert isinstance(info, TerrafirmaFileInfo)
        assert info.file_path == "/project/src/main.ts"
        assert info.sync_status == "synced"
        assert info.content_hash == "abc123"
        assert info.size_bytes == 1024
        assert len(info.crystal_memberships) == 1
        assert info.crystal_memberships[0].crystal_id == "crystal-1"
        assert info.engram_item_id == "ki-1"
        assert info.version == 3
        assert info.conflict is None
        # Verify URL encoding of file path
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/terrafirma/files/" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_file_info_returns_none_on_404(self, mock_request):
        """get_file_info returns None when file is not found (404)."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "file not found"},
            request=httpx.Request("GET", "http://test:3100/v1/terrafirma/files/missing"),
        )

        result = self.client.terrafirma.get_file_info("/project/missing.ts")

        assert result is None

    @patch.object(httpx.Client, "request")
    def test_get_file_info_raises_non_404_errors(self, mock_request):
        """get_file_info raises on non-404 errors (e.g. 500)."""
        mock_request.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "server error"},
            request=httpx.Request("GET", "http://test:3100/v1/terrafirma/files/test"),
        )

        from engram.errors import InternalError
        with pytest.raises(InternalError, match="server error"):
            self.client.terrafirma.get_file_info("/project/src/main.ts")

    @patch.object(httpx.Client, "request")
    def test_get_migration_status(self, mock_request):
        """get_migration_status returns MigrationCurrentStatus."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_MIGRATION_STATUS),
            request=httpx.Request("GET", "http://test:3100/v1/terrafirma/migrations/current"),
        )

        status = self.client.terrafirma.get_migration_status()

        assert isinstance(status, MigrationCurrentStatus)
        assert status.status == "completed"
        assert status.migration_id == "mig-1"
        assert status.files_total == 50
        assert status.files_processed == 50
        assert status.files_errored == 0
        assert status.files_remaining == 0
        assert status.elapsed_seconds == 300.5
        assert len(status.entities_completed) == 2
        assert len(status.errors) == 0
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/terrafirma/migrations/current" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_start_migration(self, mock_request):
        """start_migration sends snake_case body and returns MigrationStartResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_MIGRATION_START),
            request=httpx.Request("POST", "http://test:3100/v1/terrafirma/migrations"),
        )

        options = StartMigrationOptions(dry_run=False, entity_ids=["e1", "e2"])
        result = self.client.terrafirma.start_migration(options)

        assert isinstance(result, MigrationStartResult)
        assert result.dry_run is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/terrafirma/migrations" in call_args[0][1]
        # Verify snake_case body (NOT camelCase)
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert "dry_run" in body
        assert "dryRun" not in body
        assert body["dry_run"] is False
        assert body["entity_ids"] == ["e1", "e2"]

    @patch.object(httpx.Client, "request")
    def test_start_migration_snake_case_no_camel(self, mock_request):
        """StartMigrationOptions serializes to snake_case only, never camelCase."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_MIGRATION_START),
            request=httpx.Request("POST", "http://test:3100/v1/terrafirma/migrations"),
        )

        options = StartMigrationOptions(dry_run=True)
        self.client.terrafirma.start_migration(options)

        call_args = mock_request.call_args
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert "dry_run" in body
        assert body["dry_run"] is True
        # Must NOT have camelCase keys
        for key in body:
            assert key == key.lower().replace(" ", "_"), f"Unexpected camelCase key: {key}"

    @patch.object(httpx.Client, "request")
    def test_trigger_sync(self, mock_request):
        """trigger_sync sends snake_case body and returns SyncResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SYNC_RESULT),
            request=httpx.Request("POST", "http://test:3100/v1/terrafirma/sync"),
        )

        options = TriggerSyncOptions(
            dry_run=True, scope="errors", file_paths=["/src/a.ts"]
        )
        result = self.client.terrafirma.trigger_sync(options)

        assert isinstance(result, SyncResult)
        assert result.dry_run is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/terrafirma/sync" in call_args[0][1]
        # Verify snake_case body
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert "dry_run" in body
        assert "scope" in body
        assert body["scope"] == "errors"
        assert "file_paths" in body
        assert "filePaths" not in body

    @patch.object(httpx.Client, "request")
    def test_trigger_sync_excludes_none(self, mock_request):
        """TriggerSyncOptions excludes None fields from the body."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SYNC_RESULT),
            request=httpx.Request("POST", "http://test:3100/v1/terrafirma/sync"),
        )

        options = TriggerSyncOptions(dry_run=False)
        self.client.terrafirma.trigger_sync(options)

        call_args = mock_request.call_args
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body == {"dry_run": False}
        assert "scope" not in body
        assert "entity_id" not in body
        assert "file_paths" not in body


# ---------------------------------------------------------------------------
# Coverage Gap Remediation Tests
# ---------------------------------------------------------------------------


class TestCrystalMembershipInfoEdgeCases:
    """CrystalMembershipInfo standalone edge-case tests."""

    def test_file_info_asserts_node_type_and_tags(self):
        """TerrafirmaFileInfo nested CrystalMembershipInfo has node_type and tags."""
        info = TerrafirmaFileInfo.model_validate(SAMPLE_FILE_INFO)
        membership = info.crystal_memberships[0]
        assert membership.node_type == "collection"
        assert membership.tags == ["tf-category"]

    def test_crystal_membership_info_empty_tags(self):
        """CrystalMembershipInfo with empty tags list."""
        data = {
            "crystalId": "c-empty",
            "nodeType": "pattern",
            "tags": [],
            "folderPath": "/src",
        }
        info = CrystalMembershipInfo.model_validate(data)
        assert info.crystal_id == "c-empty"
        assert info.node_type == "pattern"
        assert info.tags == []
        assert info.folder_path == "/src"

    def test_crystal_membership_info_multiple_tags(self):
        """CrystalMembershipInfo with multiple tags."""
        data = {
            "crystalId": "c-multi",
            "nodeType": "collection",
            "tags": ["tf-entity", "custom-tag"],
            "folderPath": "/lib",
        }
        info = CrystalMembershipInfo.model_validate(data)
        assert info.tags == ["tf-entity", "custom-tag"]
        assert len(info.tags) == 2

    def test_crystal_membership_info_folder_path_none(self):
        """CrystalMembershipInfo with folder_path: None."""
        data = {
            "crystalId": "c-no-folder",
            "nodeType": "domain",
            "tags": ["tf-entity"],
            "folderPath": None,
        }
        info = CrystalMembershipInfo.model_validate(data)
        assert info.folder_path is None
        assert info.crystal_id == "c-no-folder"
        assert info.node_type == "domain"

    def test_crystal_membership_info_folder_path_absent(self):
        """CrystalMembershipInfo with folderPath omitted defaults to None."""
        data = {
            "crystalId": "c-absent",
            "nodeType": "project",
            "tags": [],
        }
        info = CrystalMembershipInfo.model_validate(data)
        assert info.folder_path is None
