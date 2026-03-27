"""CrewAI shared memory pattern using Engram.

This example shows how to use the Engram Python SDK as a shared memory
backend for CrewAI agents. Multiple agents can read from and write to
a shared engram session, enabling persistent, cross-agent memory.

Usage:
    from examples.crewai_shared_memory import EngramSharedMemory
    from engram.client import EngramClient

    client = EngramClient()
    shared_memory = EngramSharedMemory(client=client)

    # Create agent-scoped views of shared memory
    agent1_memory = shared_memory.for_agent("researcher")
    agent2_memory = shared_memory.for_agent("writer")

    # Agents write to shared memory
    agent1_memory.store("research", "Found relevant paper on quantum computing")
    agent2_memory.store("draft", "Based on research: ...")

    # Any agent can read all memories
    all_memories = shared_memory.retrieve_all()
"""
from __future__ import annotations

from typing import Any

from engram.client import EngramClient
from engram.types.sessions import (
    CreateLocalSessionParams,
    CreateLocalNoteParams,
    SearchLocalNotesParams,
)


class EngramSharedMemory:
    """Shared memory pool for CrewAI agents backed by an Engram session.

    All agents that receive a view from the same EngramSharedMemory instance
    share a single Engram session. Notes are tagged with the agent name so
    each agent's contributions are traceable.
    """

    def __init__(
        self,
        client: EngramClient,
        session_id: str | None = None,
        project_path: str = "/crewai",
    ) -> None:
        self._client = client
        if session_id is not None:
            self._session_id = session_id
        else:
            session = client.sessions.create(
                CreateLocalSessionParams(
                    project_path=project_path,
                    metadata={"source": "crewai"},
                )
            )
            self._session_id = session.id

    @property
    def session_id(self) -> str:
        return self._session_id

    def for_agent(self, agent_name: str) -> "AgentMemoryView":
        """Create an agent-scoped view of the shared memory pool."""
        return AgentMemoryView(
            client=self._client,
            session_id=self._session_id,
            agent_name=agent_name,
        )

    def retrieve_all(self, limit: int = 50) -> list[dict[str, Any]]:
        """Retrieve all notes from the shared memory pool."""
        result = self._client.sessions.notes(self._session_id).list()
        notes = result.items
        return [
            {
                "id": note.id,
                "agent": note.metadata.get("agent", "unknown"),
                "key": note.metadata.get("key", ""),
                "content": note.content,
                "created_at": note.created_at,
            }
            for note in notes[:limit]
        ]

    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search the shared memory pool for relevant memories."""
        results = self._client.sessions.notes(self._session_id).search(
            SearchLocalNotesParams(query=query, limit=limit)
        )
        return [
            {
                "id": r.id,
                "agent": r.metadata.get("agent", "unknown"),
                "content": r.content,
            }
            for r in results
        ]


class AgentMemoryView:
    """Agent-scoped view of a shared Engram memory pool.

    Provides store/retrieve/search methods namespaced to this agent.
    Writes are tagged with the agent name for traceability.
    """

    def __init__(
        self,
        client: EngramClient,
        session_id: str,
        agent_name: str,
    ) -> None:
        self._client = client
        self._session_id = session_id
        self._agent_name = agent_name

    @property
    def agent_name(self) -> str:
        return self._agent_name

    def store(self, key: str, content: str, note_type: str = "observation") -> str:
        """Store a memory entry. Returns the created note's ID."""
        note = self._client.sessions.notes(self._session_id).create(
            CreateLocalNoteParams(
                type=note_type,
                content=content,
                metadata={"agent": self._agent_name, "key": key},
            )
        )
        return note.id

    def retrieve(self, limit: int = 20) -> list[dict[str, Any]]:
        """Retrieve memories written by this agent."""
        result = self._client.sessions.notes(self._session_id).list()
        all_notes = result.items
        agent_notes = [
            n for n in all_notes
            if n.metadata.get("agent") == self._agent_name
        ]
        return [
            {"id": n.id, "key": n.metadata.get("key", ""), "content": n.content}
            for n in agent_notes[:limit]
        ]

    def retrieve_all(self) -> list[dict[str, Any]]:
        """Retrieve all memories from the shared pool (not just this agent's)."""
        result = self._client.sessions.notes(self._session_id).list()
        all_notes = result.items
        return [
            {
                "id": n.id,
                "agent": n.metadata.get("agent", "unknown"),
                "content": n.content,
            }
            for n in all_notes
        ]
