"""Tests for notes resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.types.sessions import (
    LifecycleStatus,
    LocalSessionNote,
    LocalSearchResult,
    UpdateLocalNoteParams,
    SearchLocalNotesParams,
)
from tests.conftest import make_api_response, SAMPLE_NOTE


class TestSyncNotesResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_get_note(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_NOTE),
            request=httpx.Request("GET", "http://test:3100/v1/notes/note-456"),
        )

        note = self.client.notes.get("note-456")

        assert isinstance(note, LocalSessionNote)
        assert note.id == "note-456"
        assert note.content == "Use PostgreSQL"
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/notes/note-456" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_update_note(self, mock_request):
        updated_note = {**SAMPLE_NOTE, "content": "Use MySQL"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated_note),
            request=httpx.Request("PATCH", "http://test:3100/v1/notes/note-456"),
        )

        params = UpdateLocalNoteParams(content="Use MySQL")
        note = self.client.notes.update("note-456", params)

        assert isinstance(note, LocalSessionNote)
        assert note.content == "Use MySQL"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/notes/note-456" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_note(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/notes/note-456"),
        )

        self.client.notes.delete("note-456")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/notes/note-456" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_search_notes(self, mock_request):
        search_result = {
            **SAMPLE_NOTE,
            "score": 0.95,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/notes/search"),
        )

        params = SearchLocalNotesParams(query="postgres")
        results = self.client.notes.search(params)

        assert len(results) == 1
        assert isinstance(results[0], LocalSearchResult)
        assert results[0].score == 0.95
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/notes/search" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_note_url_encodes_id(self, mock_request):
        """Verify special characters in note ID are URL-encoded."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_NOTE),
            request=httpx.Request("GET", "http://test:3100/v1/notes/note%2F456"),
        )

        self.client.notes.get("note/456")

        call_args = mock_request.call_args
        assert "note%2F456" in call_args[0][1]


class TestSyncNotesLifecycle:
    """Tests for note lifecycle status update (Phase 3)."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @pytest.mark.parametrize("status", [
        LifecycleStatus.DRAFT,
        LifecycleStatus.ACTIVE,
        LifecycleStatus.FINALIZED,
        LifecycleStatus.ARCHIVED,
        LifecycleStatus.SUPERSEDED,
    ])
    @patch.object(httpx.Client, "request")
    def test_update_lifecycle_all_statuses(self, mock_request, status):
        """update_lifecycle sends PATCH to /v1/notes/:id/lifecycle with each status."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_NOTE),
            request=httpx.Request("PATCH", "http://test:3100/v1/notes/note-456/lifecycle"),
        )

        result = self.client.notes.update_lifecycle("note-456", status)

        assert isinstance(result, LocalSessionNote)
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/notes/note-456/lifecycle" in call_args[0][1]
        # Verify the status was sent in the body
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body["status"] == status.value

    @patch.object(httpx.Client, "request")
    def test_update_lifecycle_error(self, mock_request):
        """404 error on update_lifecycle raises NotFoundError."""
        from engram.errors import NotFoundError

        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "note not found"},
            request=httpx.Request("PATCH", "http://test:3100/v1/notes/bad-id/lifecycle"),
        )

        with pytest.raises(NotFoundError, match="note not found"):
            self.client.notes.update_lifecycle("bad-id", LifecycleStatus.ACTIVE)
