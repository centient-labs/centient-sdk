"""Notes resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError
from engram.types.dedup_merge import DedupNoteParams, DedupNoteResult
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


def _dedup_body(params: Optional[DedupNoteParams]) -> dict:
    """Build the snake_case dedup request body, omitting absent fields.

    The server's ``DedupRequestSchema`` is strict and snake_case; only the two
    known fields are copied so any extra attribute never reaches the wire.
    """
    body: dict[str, Any] = {}
    if params is not None:
        if params.merge_method is not None:
            body["merge_method"] = params.merge_method
        if params.threshold is not None:
            body["threshold"] = params.threshold
    return body


def _require_bare_dedup(body: Any, route: str) -> DedupNoteResult:
    """Validate the bare (non-enveloped) dedup body and return the result."""
    if not isinstance(body, dict) or "data" in body or "action" not in body:
        excerpt = repr(body)
        if len(excerpt) > 200:
            excerpt = excerpt[:200] + "...(truncated)"
        raise EngramError(
            f"Unexpected {route} response shape (expected a bare "
            f"{{ action, merge_id, confidence, canonical_id }}); got: {excerpt}",
            code="INTERNAL_ERROR",
        )
    return DedupNoteResult.model_validate(body)


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


    async def dedup(
        self, id: str, params: Optional[DedupNoteParams] = None
    ) -> DedupNoteResult:
        """Trigger an explicit dedup check for a session note (P11 Tier 1).

        Returns one of ``merged`` / ``deferred`` / ``no_match`` plus the
        matched-item id and similarity confidence. When the embedding service
        is not ready the result is ``{ action: "no_match", ...None }``. The
        server returns a **bare** object — NOT the standard ``{ data }``
        envelope. The body fields are accepted on the wire but currently ignored
        server-side.
        """
        response = await self._request(
            "POST", f"/v1/notes/{quote(id, safe='')}/dedup", _dedup_body(params)
        )
        return _require_bare_dedup(response, f"POST /v1/notes/{id}/dedup")


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

    def dedup(
        self, id: str, params: Optional[DedupNoteParams] = None
    ) -> DedupNoteResult:
        """Trigger an explicit dedup check for a session note (P11 Tier 1).

        See :meth:`NotesResource.dedup`. The server returns a **bare** object —
        NOT the standard ``{ data }`` envelope.
        """
        response = self._request(
            "POST", f"/v1/notes/{quote(id, safe='')}/dedup", _dedup_body(params)
        )
        return _require_bare_dedup(response, f"POST /v1/notes/{id}/dedup")
