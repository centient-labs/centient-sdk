"""Tests for the LangChain memory backend example."""
from __future__ import annotations

from unittest.mock import MagicMock, call
import pytest

from engram.client import EngramClient
from engram.types.sessions import LocalSession, LocalSessionNote
from engram.types.common import PaginatedResult


def _make_session(id: str = "sess-lc") -> LocalSession:
    return LocalSession.model_validate({
        "id": id, "externalId": None, "projectPath": "/langchain",
        "status": "active", "startedAt": "2026-01-01T00:00:00Z",
        "endedAt": None, "metadata": {"source": "langchain"},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


def _make_note(id: str, content: str, role: str = "human") -> LocalSessionNote:
    return LocalSessionNote.model_validate({
        "id": id, "sessionId": "sess-lc", "type": "observation",
        "content": content, "embeddingStatus": "pending", "embeddingUpdatedAt": None,
        "metadata": {"role": role},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


def _make_paginated(notes: list[LocalSessionNote]) -> PaginatedResult[LocalSessionNote]:
    """Wrap a list of notes in a PaginatedResult."""
    return PaginatedResult(items=notes, total=len(notes), has_more=False)


class TestEngramMemory:
    def _make_client_mock(self, session_id: str = "sess-lc") -> MagicMock:
        """Build a mocked EngramClient with pre-configured session and notes."""
        client = MagicMock(spec=EngramClient)
        session = _make_session(session_id)
        client.sessions.create.return_value = session
        client.sessions.notes.return_value = MagicMock()
        return client

    def test_init_creates_session_when_no_session_id(self):
        """EngramMemory creates a new session when session_id is not provided."""
        from examples.langchain_memory import EngramMemory
        client = self._make_client_mock()
        memory = EngramMemory(client=client, project_path="/test")
        client.sessions.create.assert_called_once()
        assert memory.session_id == "sess-lc"

    def test_init_uses_provided_session_id(self):
        """EngramMemory uses provided session_id without creating a new session."""
        from examples.langchain_memory import EngramMemory
        client = self._make_client_mock()
        memory = EngramMemory(client=client, session_id="existing-sess")
        client.sessions.create.assert_not_called()
        assert memory.session_id == "existing-sess"

    def test_save_context_creates_two_notes(self):
        """save_context() creates one note for human input and one for AI output."""
        from examples.langchain_memory import EngramMemory
        client = self._make_client_mock()
        memory = EngramMemory(client=client, session_id="sess-lc")
        notes_mock = MagicMock()
        client.sessions.notes.return_value = notes_mock
        memory.save_context({"input": "Hello"}, {"output": "Hi there"})
        assert notes_mock.create.call_count == 2

    def test_load_memory_variables_returns_history(self):
        """load_memory_variables() returns formatted conversation string."""
        from examples.langchain_memory import EngramMemory
        client = self._make_client_mock()
        notes_mock = MagicMock()
        notes_mock.list.return_value = _make_paginated([
            _make_note("n1", "Hello", "human"),
            _make_note("n2", "Hi there", "ai"),
        ])
        client.sessions.notes.return_value = notes_mock
        memory = EngramMemory(client=client, session_id="sess-lc")
        result = memory.load_memory_variables({})
        assert "history" in result
        assert "Hello" in result["history"]
        assert "Hi there" in result["history"]

    def test_clear_deletes_all_notes(self):
        """clear() deletes all notes in the session via the global notes resource."""
        from examples.langchain_memory import EngramMemory
        client = self._make_client_mock()
        notes_mock = MagicMock()
        notes_mock.list.return_value = _make_paginated([
            _make_note("n1", "Hello", "human"),
            _make_note("n2", "Hi", "ai"),
        ])
        client.sessions.notes.return_value = notes_mock
        memory = EngramMemory(client=client, session_id="sess-lc")
        memory.clear()
        assert client.notes.delete.call_count == 2
        client.notes.delete.assert_any_call("n1")
        client.notes.delete.assert_any_call("n2")
