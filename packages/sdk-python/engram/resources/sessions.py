"""Session resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.sessions import (
    CreateLocalNoteParams,
    CreateLocalSessionParams,
    CreateScratchParams,
    FinalizeSessionOptions,
    FinalizeSessionResult,
    LifecycleStats,
    ListLocalNotesParams,
    ListLocalSessionsParams,
    ListScratchParams,
    LocalSearchResult,
    LocalSession,
    LocalSessionNote,
    SearchLocalNotesParams,
    SessionScratch,
    UpdateLocalNoteParams,
    UpdateLocalSessionParams,
    UpdateScratchParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient
    from engram.resources.session_coordination import (
        SessionBranchesResource,
        SessionConstraintsResource,
        SessionDecisionPointsResource,
        SessionNoteEdgesResource,
        SessionStuckDetectionsResource,
        SyncSessionBranchesResource,
        SyncSessionConstraintsResource,
        SyncSessionDecisionPointsResource,
        SyncSessionNoteEdgesResource,
        SyncSessionStuckDetectionsResource,
    )


# ============================================================================
# Session Notes (scoped to session_id)
# ============================================================================


class SessionNotesResource(BaseResource):
    """Async resource for session notes, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(self, params: CreateLocalNoteParams) -> LocalSessionNote:
        """Create a note in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes",
            body,
        )
        return LocalSessionNote.model_validate(response["data"])

    async def list(
        self, params: Optional[ListLocalNotesParams] = None
    ) -> PaginatedResult[LocalSessionNote]:
        """List notes in this session."""
        qs: dict[str, str] = {}
        if params:
            if params.type:
                qs["type"] = params.type
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes",
            params=qs if qs else None,
        )
        return self._parse_list(response, LocalSessionNote)

    async def search(
        self, params: SearchLocalNotesParams
    ) -> list[LocalSearchResult]:
        """Search notes in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes/search",
            body,
        )
        return [LocalSearchResult.model_validate(r) for r in response["data"]]


class SyncSessionNotesResource(SyncBaseResource):
    """Sync resource for session notes, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(self, params: CreateLocalNoteParams) -> LocalSessionNote:
        """Create a note in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes",
            body,
        )
        return LocalSessionNote.model_validate(response["data"])

    def list(
        self, params: Optional[ListLocalNotesParams] = None
    ) -> PaginatedResult[LocalSessionNote]:
        """List notes in this session."""
        qs: dict[str, str] = {}
        if params:
            if params.type:
                qs["type"] = params.type
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes",
            params=qs if qs else None,
        )
        return self._parse_list(response, LocalSessionNote)

    def search(
        self, params: SearchLocalNotesParams
    ) -> list[LocalSearchResult]:
        """Search notes in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/notes/search",
            body,
        )
        return [LocalSearchResult.model_validate(r) for r in response["data"]]


# ============================================================================
# Session Scratch (scoped to session_id)
# ============================================================================


class SessionScratchResource(BaseResource):
    """Async resource for session scratch content, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def get(self, scratch_id: str) -> SessionScratch:
        """Get scratch content by ID."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
        )
        return SessionScratch.model_validate(response["data"])

    async def create(self, params: CreateScratchParams) -> SessionScratch:
        """Create scratch content in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch",
            body,
        )
        return SessionScratch.model_validate(response["data"])

    async def list(
        self, params: Optional[ListScratchParams] = None
    ) -> PaginatedResult[SessionScratch]:
        """List scratch content in this session."""
        qs: dict[str, str] = {}
        if params:
            if params.type:
                qs["type"] = params.type
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionScratch)

    async def update(
        self, scratch_id: str, params: UpdateScratchParams
    ) -> SessionScratch:
        """Update scratch content."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
            body,
        )
        return SessionScratch.model_validate(response["data"])

    async def delete(self, scratch_id: str) -> None:
        """Delete scratch content."""
        await self._request(
            "DELETE",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
        )


class SyncSessionScratchResource(SyncBaseResource):
    """Sync resource for session scratch content, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def get(self, scratch_id: str) -> SessionScratch:
        """Get scratch content by ID."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
        )
        return SessionScratch.model_validate(response["data"])

    def create(self, params: CreateScratchParams) -> SessionScratch:
        """Create scratch content in this session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch",
            body,
        )
        return SessionScratch.model_validate(response["data"])

    def list(
        self, params: Optional[ListScratchParams] = None
    ) -> PaginatedResult[SessionScratch]:
        """List scratch content in this session."""
        qs: dict[str, str] = {}
        if params:
            if params.type:
                qs["type"] = params.type
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionScratch)

    def update(
        self, scratch_id: str, params: UpdateScratchParams
    ) -> SessionScratch:
        """Update scratch content."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
            body,
        )
        return SessionScratch.model_validate(response["data"])

    def delete(self, scratch_id: str) -> None:
        """Delete scratch content."""
        self._request(
            "DELETE",
            f"/v1/sessions/{quote(self._session_id, safe='')}/scratch/{quote(scratch_id, safe='')}",
        )


# ============================================================================
# Sessions (top-level resource)
# ============================================================================


class SessionsResource(BaseResource):
    """Async resource for sessions."""

    async def create(self, params: CreateLocalSessionParams) -> LocalSession:
        """Create a new session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/sessions", body)
        return LocalSession.model_validate(response["data"])

    async def get(self, id: str) -> LocalSession:
        """Get a session by ID."""
        response = await self._request(
            "GET", f"/v1/sessions/{quote(id, safe='')}"
        )
        return LocalSession.model_validate(response["data"])

    async def list(
        self, params: Optional[ListLocalSessionsParams] = None
    ) -> PaginatedResult[LocalSession]:
        """List sessions."""
        qs: dict[str, str] = {}
        if params:
            if params.project_path:
                qs["projectPath"] = params.project_path
            if params.status:
                qs["status"] = params.status
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request("GET", "/v1/sessions", params=qs if qs else None)
        return self._parse_list(response, LocalSession)

    async def update(
        self, id: str, params: UpdateLocalSessionParams
    ) -> LocalSession:
        """Update a session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/sessions/{quote(id, safe='')}", body
        )
        return LocalSession.model_validate(response["data"])

    async def delete(self, id: str) -> None:
        """Delete a session."""
        await self._request("DELETE", f"/v1/sessions/{quote(id, safe='')}")

    def notes(self, session_id: str) -> SessionNotesResource:
        """Get a notes sub-resource scoped to the given session."""
        return SessionNotesResource(self._client, session_id)

    def scratch(self, session_id: str) -> SessionScratchResource:
        """Get a scratch sub-resource scoped to the given session."""
        return SessionScratchResource(self._client, session_id)

    def constraints(self, session_id: str) -> SessionConstraintsResource:
        """Get a constraints sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SessionConstraintsResource,
        )

        return SessionConstraintsResource(self._client, session_id)

    def decision_points(
        self, session_id: str
    ) -> SessionDecisionPointsResource:
        """Get a decision points sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SessionDecisionPointsResource,
        )

        return SessionDecisionPointsResource(self._client, session_id)

    def branches(self, session_id: str) -> SessionBranchesResource:
        """Get a branches sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SessionBranchesResource,
        )

        return SessionBranchesResource(self._client, session_id)

    def note_edges(self, session_id: str) -> SessionNoteEdgesResource:
        """Get a note edges sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SessionNoteEdgesResource,
        )

        return SessionNoteEdgesResource(self._client, session_id)

    def stuck_detections(
        self, session_id: str
    ) -> SessionStuckDetectionsResource:
        """Get a stuck detections sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SessionStuckDetectionsResource,
        )

        return SessionStuckDetectionsResource(self._client, session_id)

    async def get_lifecycle_stats(self, session_id: str) -> LifecycleStats:
        """Get lifecycle status counts for a session.

        Returns aggregate counts of notes grouped by lifecycle status.

        Args:
            session_id: The session ID.

        Returns:
            Lifecycle statistics with counts per status.
        """
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/lifecycle-stats",
        )
        return LifecycleStats.model_validate(response["data"])

    async def finalize(
        self,
        session_id: str,
        options: Optional[FinalizeSessionOptions] = None,
    ) -> FinalizeSessionResult:
        """Finalize a session."""
        body: dict[str, Any] = {}
        if options:
            body = options.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(session_id, safe='')}/finalize",
            body,
        )
        return FinalizeSessionResult.model_validate(response["data"])


class SyncSessionsResource(SyncBaseResource):
    """Sync resource for sessions."""

    def create(self, params: CreateLocalSessionParams) -> LocalSession:
        """Create a new session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/sessions", body)
        return LocalSession.model_validate(response["data"])

    def get(self, id: str) -> LocalSession:
        """Get a session by ID."""
        response = self._request(
            "GET", f"/v1/sessions/{quote(id, safe='')}"
        )
        return LocalSession.model_validate(response["data"])

    def list(
        self, params: Optional[ListLocalSessionsParams] = None
    ) -> PaginatedResult[LocalSession]:
        """List sessions."""
        qs: dict[str, str] = {}
        if params:
            if params.project_path:
                qs["projectPath"] = params.project_path
            if params.status:
                qs["status"] = params.status
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request("GET", "/v1/sessions", params=qs if qs else None)
        return self._parse_list(response, LocalSession)

    def update(
        self, id: str, params: UpdateLocalSessionParams
    ) -> LocalSession:
        """Update a session."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/sessions/{quote(id, safe='')}", body
        )
        return LocalSession.model_validate(response["data"])

    def delete(self, id: str) -> None:
        """Delete a session."""
        self._request("DELETE", f"/v1/sessions/{quote(id, safe='')}")

    def notes(self, session_id: str) -> SyncSessionNotesResource:
        """Get a notes sub-resource scoped to the given session."""
        return SyncSessionNotesResource(self._client, session_id)

    def scratch(self, session_id: str) -> SyncSessionScratchResource:
        """Get a scratch sub-resource scoped to the given session."""
        return SyncSessionScratchResource(self._client, session_id)

    def constraints(
        self, session_id: str
    ) -> SyncSessionConstraintsResource:
        """Get a constraints sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SyncSessionConstraintsResource,
        )

        return SyncSessionConstraintsResource(self._client, session_id)

    def decision_points(
        self, session_id: str
    ) -> SyncSessionDecisionPointsResource:
        """Get a decision points sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SyncSessionDecisionPointsResource,
        )

        return SyncSessionDecisionPointsResource(self._client, session_id)

    def branches(self, session_id: str) -> SyncSessionBranchesResource:
        """Get a branches sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SyncSessionBranchesResource,
        )

        return SyncSessionBranchesResource(self._client, session_id)

    def note_edges(self, session_id: str) -> SyncSessionNoteEdgesResource:
        """Get a note edges sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SyncSessionNoteEdgesResource,
        )

        return SyncSessionNoteEdgesResource(self._client, session_id)

    def stuck_detections(
        self, session_id: str
    ) -> SyncSessionStuckDetectionsResource:
        """Get a stuck detections sub-resource scoped to the given session."""
        from engram.resources.session_coordination import (
            SyncSessionStuckDetectionsResource,
        )

        return SyncSessionStuckDetectionsResource(self._client, session_id)

    def get_lifecycle_stats(self, session_id: str) -> LifecycleStats:
        """Get lifecycle status counts for a session.

        Returns aggregate counts of notes grouped by lifecycle status.

        Args:
            session_id: The session ID.

        Returns:
            Lifecycle statistics with counts per status.
        """
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/lifecycle-stats",
        )
        return LifecycleStats.model_validate(response["data"])

    def finalize(
        self,
        session_id: str,
        options: Optional[FinalizeSessionOptions] = None,
    ) -> FinalizeSessionResult:
        """Finalize a session."""
        body: dict[str, Any] = {}
        if options:
            body = options.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(session_id, safe='')}/finalize",
            body,
        )
        return FinalizeSessionResult.model_validate(response["data"])
