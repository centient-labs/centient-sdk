"""Tests for sessions resource."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
import httpx
import pytest

from engram.client import EngramClient
from engram.resources.sessions import (
    SyncSessionNotesResource,
    SyncSessionScratchResource,
)
from engram.resources.session_coordination import (
    SyncSessionConstraintsResource,
    SyncSessionDecisionPointsResource,
    SyncSessionBranchesResource,
    SyncSessionNoteEdgesResource,
    SyncSessionStuckDetectionsResource,
)
from engram.types.sessions import (
    LocalSession,
    CreateLocalSessionParams,
    LifecycleStats,
    ListLocalSessionsParams,
    UpdateLocalSessionParams,
    FinalizeSessionResult,
)
from tests.conftest import make_api_response, SAMPLE_SESSION, SAMPLE_CRYSTAL


class TestSyncSessionsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_session(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SESSION),
            request=httpx.Request("POST", "http://test:3100/v1/sessions"),
        )

        params = CreateLocalSessionParams(project_path="/test/project")
        session = self.client.sessions.create(params)

        assert isinstance(session, LocalSession)
        assert session.id == "sess-123"
        assert session.project_path == "/test/project"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_session(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SESSION),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123"),
        )

        session = self.client.sessions.get("sess-123")

        assert session.id == "sess-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/sessions/sess-123" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_sessions(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_SESSION], total=1, has_more=False),
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )

        result = self.client.sessions.list()

        assert len(result.items) == 1
        assert result.total == 1
        assert result.has_more is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"

    @patch.object(httpx.Client, "request")
    def test_delete_session(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/sessions/sess-123"),
        )

        self.client.sessions.delete("sess-123")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/sessions/sess-123" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_update_session(self, mock_request):
        updated_session = {**SAMPLE_SESSION, "status": "finalized"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated_session),
            request=httpx.Request("PATCH", "http://test:3100/v1/sessions/sess-123"),
        )

        params = UpdateLocalSessionParams(status="finalized")
        session = self.client.sessions.update("sess-123", params)

        assert isinstance(session, LocalSession)
        assert session.status == "finalized"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/sessions/sess-123" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_finalize_session(self, mock_request):
        finalize_result = {
            "session": {**SAMPLE_SESSION, "status": "finalized"},
            "crystal": SAMPLE_CRYSTAL,
            "promotedItems": 5,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(finalize_result),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/finalize"),
        )

        result = self.client.sessions.finalize("sess-123")

        assert isinstance(result, FinalizeSessionResult)
        assert result.promoted_items == 5
        assert result.session.status == "finalized"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/finalize" in call_args[0][1]


class TestSyncSessionSubResources:
    """Test that sub-resource factory methods return the correct types."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    def test_notes_sub_resource(self):
        notes = self.client.sessions.notes("sess-123")
        assert isinstance(notes, SyncSessionNotesResource)

    def test_scratch_sub_resource(self):
        scratch = self.client.sessions.scratch("sess-123")
        assert isinstance(scratch, SyncSessionScratchResource)

    def test_constraints_sub_resource(self):
        constraints = self.client.sessions.constraints("sess-123")
        assert isinstance(constraints, SyncSessionConstraintsResource)

    def test_decision_points_sub_resource(self):
        dp = self.client.sessions.decision_points("sess-123")
        assert isinstance(dp, SyncSessionDecisionPointsResource)

    def test_branches_sub_resource(self):
        branches = self.client.sessions.branches("sess-123")
        assert isinstance(branches, SyncSessionBranchesResource)

    def test_note_edges_sub_resource(self):
        edges = self.client.sessions.note_edges("sess-123")
        assert isinstance(edges, SyncSessionNoteEdgesResource)

    def test_stuck_detections_sub_resource(self):
        detections = self.client.sessions.stuck_detections("sess-123")
        assert isinstance(detections, SyncSessionStuckDetectionsResource)


class TestSyncSessionLifecycleStats:
    """Tests for session lifecycle stats (Phase 3)."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_get_lifecycle_stats(self, mock_request):
        """get_lifecycle_stats sends GET to /v1/sessions/:id/lifecycle-stats."""
        stats_data = {
            "draft": 2,
            "active": 5,
            "finalized": 3,
            "archived": 1,
            "superseded": 0,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(stats_data),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/lifecycle-stats"),
        )

        result = self.client.sessions.get_lifecycle_stats("sess-123")

        assert isinstance(result, LifecycleStats)
        assert result.draft == 2
        assert result.active == 5
        assert result.finalized == 3
        assert result.archived == 1
        assert result.superseded == 0
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/sessions/sess-123/lifecycle-stats" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_lifecycle_stats_empty(self, mock_request):
        """get_lifecycle_stats defaults to zero when fields are missing."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({}),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/lifecycle-stats"),
        )

        result = self.client.sessions.get_lifecycle_stats("sess-123")

        assert isinstance(result, LifecycleStats)
        assert result.draft == 0
        assert result.active == 0
        assert result.finalized == 0
        assert result.archived == 0
        assert result.superseded == 0
