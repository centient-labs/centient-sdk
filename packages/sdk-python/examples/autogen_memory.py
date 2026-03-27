"""AutoGen memory plugin using Engram.

This example shows how to use the Engram Python SDK as a persistent memory
backend for AutoGen agents. The plugin stores agent messages and retrieved
memories in an Engram session, enabling cross-session recall.

Usage:
    from examples.autogen_memory import EngramMemoryPlugin
    from engram import create_engram_client

    client = create_engram_client()
    plugin = EngramMemoryPlugin(client=client, agent_name="assistant")

    # Store a memory
    plugin.add("The user prefers concise answers")

    # Retrieve relevant memories
    memories = plugin.get_relevant("user preferences", limit=5)

    # Log a message exchange
    plugin.log_message(role="user", content="What did we discuss before?")
"""
from __future__ import annotations

from typing import Any

from engram.client import EngramClient
from engram.types.sessions import (
    CreateLocalSessionParams,
    CreateLocalNoteParams,
    SearchLocalNotesParams,
)
from engram.types.knowledge_crystal import (
    CreateKnowledgeCrystalParams,
    SearchKnowledgeCrystalsParams,
)


class EngramMemoryPlugin:
    """AutoGen-compatible memory plugin backed by Engram.

    Provides add/get/clear/log_message methods compatible with
    the AutoGen MemoryAgent memory interface pattern.

    Note: Does not inherit from AutoGen classes to avoid requiring
    pyautogen as a dependency. Designed to be compatible with the
    AutoGen memory plugin interface.
    """

    def __init__(
        self,
        client: EngramClient,
        agent_name: str = "agent",
        session_id: str | None = None,
        project_path: str = "/autogen",
    ) -> None:
        """Initialize the AutoGen memory plugin.

        Args:
            client: An initialized EngramClient instance.
            agent_name: Name of the AutoGen agent using this memory.
            session_id: Existing session ID. If None, creates a new session.
            project_path: Path used when creating a new session.
        """
        self._client = client
        self._agent_name = agent_name
        if session_id is not None:
            self._session_id = session_id
        else:
            session = client.sessions.create(
                CreateLocalSessionParams(
                    project_path=project_path,
                    metadata={"source": "autogen", "agent": agent_name},
                )
            )
            self._session_id = session.id

    @property
    def session_id(self) -> str:
        """The active Engram session ID."""
        return self._session_id

    @property
    def agent_name(self) -> str:
        """The name of the agent this plugin belongs to."""
        return self._agent_name

    def add(self, content: str, memory_type: str = "observation") -> str:
        """Store a new memory entry.

        Args:
            content: The memory content to store.
            memory_type: Type of note (observation, decision, learning, etc.)

        Returns:
            The ID of the created note.
        """
        note = self._client.sessions.notes(self._session_id).create(
            CreateLocalNoteParams(
                type=memory_type,
                content=content,
                metadata={"agent": self._agent_name, "source": "autogen"},
            )
        )
        return note.id

    def get_relevant(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Retrieve memories relevant to a query using semantic search.

        Args:
            query: Search query to find relevant memories.
            limit: Maximum number of memories to return.

        Returns:
            List of memory dicts with 'id', 'content', 'score' fields.
        """
        results = self._client.sessions.notes(self._session_id).search(
            SearchLocalNotesParams(query=query, limit=limit)
        )
        return [
            {
                "id": r.id,
                "content": r.content,
                "type": r.type,
            }
            for r in results
        ]

    def get_all(self, limit: int = 50) -> list[dict[str, Any]]:
        """Retrieve all stored memories.

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of memory dicts.
        """
        notes = self._client.sessions.notes(self._session_id).list()
        return [
            {"id": n.id, "content": n.content, "type": n.type}
            for n in list(notes)[:limit]
        ]

    def log_message(self, role: str, content: str) -> str:
        """Log a message exchange to persistent memory.

        Useful for recording conversation history across sessions.

        Args:
            role: Message role (e.g., 'user', 'assistant', 'system').
            content: Message content.

        Returns:
            The ID of the created note.
        """
        note = self._client.sessions.notes(self._session_id).create(
            CreateLocalNoteParams(
                type="observation",
                content=f"[{role}] {content}",
                metadata={"agent": self._agent_name, "role": role, "source": "autogen"},
            )
        )
        return note.id

    def clear(self) -> int:
        """Clear all memories for this agent.

        Returns:
            Number of memories cleared.
        """
        notes_resource = self._client.sessions.notes(self._session_id)
        all_notes = notes_resource.list()
        count = 0
        for note in all_notes:
            notes_resource.delete(note.id)
            count += 1
        return count
