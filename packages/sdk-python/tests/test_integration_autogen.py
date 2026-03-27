"""Tests for the AutoGen memory plugin example."""
from __future__ import annotations

from unittest.mock import MagicMock
import pytest

from engram.client import EngramClient
from engram.types.sessions import LocalSession, LocalSessionNote


def _make_session(id: str = "sess-ag") -> LocalSession:
    return LocalSession.model_validate({
        "id": id, "externalId": None, "projectPath": "/autogen",
        "status": "active", "startedAt": "2026-01-01T00:00:00Z",
        "endedAt": None, "metadata": {"source": "autogen"},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


def _make_note(id: str, content: str, note_type: str = "observation") -> LocalSessionNote:
    return LocalSessionNote.model_validate({
        "id": id, "sessionId": "sess-ag", "type": note_type,
        "content": content, "embeddingStatus": "pending", "embeddingUpdatedAt": None,
        "metadata": {"agent": "assistant"},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


class TestEngramMemoryPlugin:

    def _make_client_mock(self) -> MagicMock:
        client = MagicMock(spec=EngramClient)
        client.sessions.create.return_value = _make_session()
        client.sessions.notes.return_value = MagicMock()
        return client

    def test_init_creates_session(self):
        """EngramMemoryPlugin creates a session on init."""
        from examples.autogen_memory import EngramMemoryPlugin
        client = self._make_client_mock()
        plugin = EngramMemoryPlugin(client=client, agent_name="assistant")
        client.sessions.create.assert_called_once()
        assert plugin.session_id == "sess-ag"
        assert plugin.agent_name == "assistant"

    def test_add_stores_note(self):
        """add() calls sessions.notes().create() and returns note id."""
        from examples.autogen_memory import EngramMemoryPlugin
        client = self._make_client_mock()
        notes_mock = MagicMock()
        notes_mock.create.return_value = _make_note("n-new", "remember this")
        client.sessions.notes.return_value = notes_mock
        plugin = EngramMemoryPlugin(client=client, session_id="sess-ag", agent_name="assistant")
        note_id = plugin.add("remember this")
        notes_mock.create.assert_called_once()
        assert note_id == "n-new"

    def test_get_all_returns_all_notes(self):
        """get_all() returns all stored memories."""
        from examples.autogen_memory import EngramMemoryPlugin
        client = self._make_client_mock()
        notes_mock = MagicMock()
        notes_mock.list.return_value = [
            _make_note("n1", "Memory 1"),
            _make_note("n2", "Memory 2"),
        ]
        client.sessions.notes.return_value = notes_mock
        plugin = EngramMemoryPlugin(client=client, session_id="sess-ag", agent_name="assistant")
        results = plugin.get_all()
        assert len(results) == 2
        assert results[0]["content"] == "Memory 1"
