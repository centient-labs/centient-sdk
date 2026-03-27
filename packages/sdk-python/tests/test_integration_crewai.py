"""Tests for the CrewAI shared memory example."""
from __future__ import annotations

from unittest.mock import MagicMock
import pytest

from engram.client import EngramClient
from engram.types.sessions import LocalSession, LocalSessionNote
from engram.types.common import PaginatedResult


def _make_session(id: str = "sess-crew") -> LocalSession:
    return LocalSession.model_validate({
        "id": id, "externalId": None, "projectPath": "/crewai",
        "status": "active", "startedAt": "2026-01-01T00:00:00Z",
        "endedAt": None, "metadata": {"source": "crewai"},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


def _make_note(id: str, content: str, agent: str = "researcher", key: str = "research") -> LocalSessionNote:
    return LocalSessionNote.model_validate({
        "id": id, "sessionId": "sess-crew", "type": "observation",
        "content": content, "embeddingStatus": "pending", "embeddingUpdatedAt": None,
        "metadata": {"agent": agent, "key": key},
        "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
    })


def _make_paginated(notes: list[LocalSessionNote]) -> PaginatedResult[LocalSessionNote]:
    return PaginatedResult(items=notes, total=len(notes), has_more=False)


class TestEngramSharedMemory:

    def _make_client_mock(self) -> MagicMock:
        client = MagicMock(spec=EngramClient)
        client.sessions.create.return_value = _make_session()
        notes_mock = MagicMock()
        notes_mock.list.return_value = _make_paginated([])
        client.sessions.notes.return_value = notes_mock
        return client

    def test_init_creates_session(self):
        """EngramSharedMemory creates a session when none provided."""
        from examples.crewai_shared_memory import EngramSharedMemory
        client = self._make_client_mock()
        sm = EngramSharedMemory(client=client)
        client.sessions.create.assert_called_once()
        assert sm.session_id == "sess-crew"

    def test_for_agent_returns_agent_view(self):
        """for_agent() returns an AgentMemoryView with the correct agent name."""
        from examples.crewai_shared_memory import EngramSharedMemory, AgentMemoryView
        client = self._make_client_mock()
        sm = EngramSharedMemory(client=client, session_id="sess-crew")
        view = sm.for_agent("researcher")
        assert isinstance(view, AgentMemoryView)
        assert view.agent_name == "researcher"

    def test_two_agents_share_same_session(self):
        """Two agents created from same pool share the same session_id."""
        from examples.crewai_shared_memory import EngramSharedMemory
        client = self._make_client_mock()
        sm = EngramSharedMemory(client=client, session_id="sess-crew")
        agent1 = sm.for_agent("researcher")
        agent2 = sm.for_agent("writer")
        assert agent1._session_id == agent2._session_id == "sess-crew"

    def test_agent_store_creates_note(self):
        """AgentMemoryView.store() calls sessions.notes().create()."""
        from examples.crewai_shared_memory import EngramSharedMemory
        client = self._make_client_mock()
        notes_mock = MagicMock()
        new_note = _make_note("n-new", "Quantum computing paper", "researcher", "research")
        notes_mock.create.return_value = new_note
        notes_mock.list.return_value = _make_paginated([])
        client.sessions.notes.return_value = notes_mock
        sm = EngramSharedMemory(client=client, session_id="sess-crew")
        agent_view = sm.for_agent("researcher")
        note_id = agent_view.store("research", "Quantum computing paper")
        notes_mock.create.assert_called_once()
        assert note_id == "n-new"

    def test_retrieve_all_returns_all_notes(self):
        """retrieve_all() returns notes from all agents."""
        from examples.crewai_shared_memory import EngramSharedMemory
        client = self._make_client_mock()
        notes_mock = MagicMock()
        notes_mock.list.return_value = _make_paginated([
            _make_note("n1", "Research finding", "researcher"),
            _make_note("n2", "Draft text", "writer", "draft"),
        ])
        client.sessions.notes.return_value = notes_mock
        sm = EngramSharedMemory(client=client, session_id="sess-crew")
        result = sm.retrieve_all()
        assert len(result) == 2
        agents = {r["agent"] for r in result}
        assert "researcher" in agents
        assert "writer" in agents
