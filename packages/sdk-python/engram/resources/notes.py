"""Notes resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.sessions import (
    LifecycleStatus,
    LocalSearchResult,
    LocalSessionNote,
    SearchLocalNotesParams,
    UpdateLifecycleParams,
    UpdateLocalNoteParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class NotesResource(BaseResource):
    """Async resource for global note operations."""

    async def get(self, id: str) -> LocalSessionNote:
        """Get a note by ID."""
        response = await self._request(
            "GET", f"/v1/notes/{quote(id, safe='')}"
        )
        return LocalSessionNote.model_validate(response["data"])

    async def update(
        self, id: str, params: UpdateLocalNoteParams
    ) -> LocalSessionNote:
        """Update a note."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/notes/{quote(id, safe='')}", body
        )
        return LocalSessionNote.model_validate(response["data"])

    async def delete(self, id: str) -> None:
        """Delete a note."""
        await self._request("DELETE", f"/v1/notes/{quote(id, safe='')}")

    async def search(
        self, params: SearchLocalNotesParams
    ) -> list[LocalSearchResult]:
        """Search notes globally."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/notes/search", body)
        return [LocalSearchResult.model_validate(r) for r in response["data"]]

    async def update_lifecycle(
        self, id: str, status: LifecycleStatus
    ) -> LocalSessionNote:
        """Update a note's lifecycle status.

        Args:
            id: The note ID.
            status: The new lifecycle status.

        Returns:
            The updated note.
        """
        body = UpdateLifecycleParams(status=status).model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/notes/{quote(id, safe='')}/lifecycle", body
        )
        return LocalSessionNote.model_validate(response["data"])


class SyncNotesResource(SyncBaseResource):
    """Sync resource for global note operations."""

    def get(self, id: str) -> LocalSessionNote:
        """Get a note by ID."""
        response = self._request(
            "GET", f"/v1/notes/{quote(id, safe='')}"
        )
        return LocalSessionNote.model_validate(response["data"])

    def update(
        self, id: str, params: UpdateLocalNoteParams
    ) -> LocalSessionNote:
        """Update a note."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/notes/{quote(id, safe='')}", body
        )
        return LocalSessionNote.model_validate(response["data"])

    def delete(self, id: str) -> None:
        """Delete a note."""
        self._request("DELETE", f"/v1/notes/{quote(id, safe='')}")

    def search(
        self, params: SearchLocalNotesParams
    ) -> list[LocalSearchResult]:
        """Search notes globally."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/notes/search", body)
        return [LocalSearchResult.model_validate(r) for r in response["data"]]

    def update_lifecycle(
        self, id: str, status: LifecycleStatus
    ) -> LocalSessionNote:
        """Update a note's lifecycle status.

        Args:
            id: The note ID.
            status: The new lifecycle status.

        Returns:
            The updated note.
        """
        body = UpdateLifecycleParams(status=status).model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/notes/{quote(id, safe='')}/lifecycle", body
        )
        return LocalSessionNote.model_validate(response["data"])
