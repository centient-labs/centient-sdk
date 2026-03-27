"""LangChain memory backend using Engram.

This example shows how to use the Engram Python SDK as a persistent memory
backend for LangChain. It implements the BaseMemory interface so it can be
used as a drop-in replacement for ConversationBufferMemory.

Usage:
    from examples.langchain_memory import EngramMemory
    from engram import create_engram_client

    client = create_engram_client()
    memory = EngramMemory(client=client, session_id="my-session")

    # Use in a LangChain chain
    chain = ConversationChain(llm=llm, memory=memory)
"""
from __future__ import annotations

from typing import Any

from engram.client import EngramClient
from engram.types.sessions import (
    CreateLocalSessionParams,
    CreateLocalNoteParams,
    SearchLocalNotesParams,
)


class EngramMemory:
    """LangChain BaseMemory adapter backed by Engram session notes.

    Implements the core memory interface:
    - load_memory_variables(inputs) -> dict
    - save_context(inputs, outputs) -> None
    - clear() -> None

    Note: This class does not inherit from langchain BaseMemory to avoid
    requiring langchain as a dependency. It is designed to be compatible
    with the BaseMemory interface so it can be used with LangChain when
    langchain is installed in the user's environment.
    """

    memory_key: str = "history"
    input_key: str = "input"
    output_key: str = "output"

    def __init__(
        self,
        client: EngramClient,
        session_id: str | None = None,
        project_path: str = "/langchain",
        max_history: int = 20,
    ) -> None:
        """Initialize the Engram memory backend.

        Args:
            client: An initialized EngramClient instance.
            session_id: Existing session ID to use. If None, a new session
                is created automatically.
            project_path: Path used when creating a new session.
            max_history: Maximum number of recent notes to include in context.
        """
        self._client = client
        self._max_history = max_history
        if session_id is not None:
            self._session_id = session_id
        else:
            session = client.sessions.create(
                CreateLocalSessionParams(
                    project_path=project_path,
                    metadata={"source": "langchain"},
                )
            )
            self._session_id = session.id

    @property
    def session_id(self) -> str:
        """The active engram session ID."""
        return self._session_id

    @property
    def memory_variables(self) -> list[str]:
        """Memory variable keys provided by this memory."""
        return [self.memory_key]

    def load_memory_variables(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """Load recent conversation history from Engram session notes.

        Args:
            inputs: Current chain inputs (unused; history is loaded in full).

        Returns:
            Dict with 'history' key containing formatted conversation string.
        """
        result = self._client.sessions.notes(self._session_id).list()
        # PaginatedResult — access .items for the note list
        all_notes = result.items
        # Take most recent N notes
        recent = all_notes[-self._max_history:]
        history_lines = []
        for note in recent:
            role = note.metadata.get("role", "unknown") if note.metadata else "unknown"
            history_lines.append(f"{role}: {note.content}")
        return {self.memory_key: "\n".join(history_lines)}

    def save_context(self, inputs: dict[str, Any], outputs: dict[str, Any]) -> None:
        """Save input/output pair to Engram as session notes.

        Args:
            inputs: Chain inputs (e.g., {"input": "user message"}).
            outputs: Chain outputs (e.g., {"output": "assistant reply"}).
        """
        notes_resource = self._client.sessions.notes(self._session_id)

        human_msg = inputs.get(self.input_key, "")
        if human_msg:
            notes_resource.create(
                CreateLocalNoteParams(
                    type="observation",
                    content=str(human_msg),
                    metadata={"role": "human"},
                )
            )

        ai_msg = outputs.get(self.output_key, "")
        if ai_msg:
            notes_resource.create(
                CreateLocalNoteParams(
                    type="observation",
                    content=str(ai_msg),
                    metadata={"role": "ai"},
                )
            )

    def clear(self) -> None:
        """Clear conversation history by deleting all notes in the session.

        Note: This deletes all notes in the current session. Use a new
        session_id if you want to preserve the existing session.
        """
        result = self._client.sessions.notes(self._session_id).list()
        existing_notes = result.items
        for note in existing_notes:
            self._client.notes.delete(note.id)
