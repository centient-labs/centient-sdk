"""Session link resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.coordination import (
    CreateSessionLinkParams,
    ListSessionLinksParams,
    SessionLink,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class SessionLinksResource(BaseResource):
    """Async resource for session links."""

    async def create(self, params: CreateSessionLinkParams) -> SessionLink:
        """Create a session link."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/session-links", body)
        return SessionLink.model_validate(response["data"])

    async def get(self, id: str) -> SessionLink:
        """Get a session link by ID."""
        response = await self._request(
            "GET", f"/v1/session-links/{quote(id, safe='')}"
        )
        return SessionLink.model_validate(response["data"])

    async def delete(self, id: str) -> None:
        """Delete a session link."""
        await self._request(
            "DELETE", f"/v1/session-links/{quote(id, safe='')}"
        )

    async def list_outgoing(
        self,
        session_id: str,
        params: Optional[ListSessionLinksParams] = None,
    ) -> PaginatedResult[SessionLink]:
        """List outgoing links from a session."""
        qs: dict[str, str] = {}
        if params:
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/session-links/outgoing/{quote(session_id, safe='')}",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionLink)

    async def list_incoming(
        self,
        session_id: str,
        params: Optional[ListSessionLinksParams] = None,
    ) -> PaginatedResult[SessionLink]:
        """List incoming links to a session."""
        qs: dict[str, str] = {}
        if params:
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/session-links/incoming/{quote(session_id, safe='')}",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionLink)


class SyncSessionLinksResource(SyncBaseResource):
    """Sync resource for session links."""

    def create(self, params: CreateSessionLinkParams) -> SessionLink:
        """Create a session link."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/session-links", body)
        return SessionLink.model_validate(response["data"])

    def get(self, id: str) -> SessionLink:
        """Get a session link by ID."""
        response = self._request(
            "GET", f"/v1/session-links/{quote(id, safe='')}"
        )
        return SessionLink.model_validate(response["data"])

    def delete(self, id: str) -> None:
        """Delete a session link."""
        self._request(
            "DELETE", f"/v1/session-links/{quote(id, safe='')}"
        )

    def list_outgoing(
        self,
        session_id: str,
        params: Optional[ListSessionLinksParams] = None,
    ) -> PaginatedResult[SessionLink]:
        """List outgoing links from a session."""
        qs: dict[str, str] = {}
        if params:
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/session-links/outgoing/{quote(session_id, safe='')}",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionLink)

    def list_incoming(
        self,
        session_id: str,
        params: Optional[ListSessionLinksParams] = None,
    ) -> PaginatedResult[SessionLink]:
        """List incoming links to a session."""
        qs: dict[str, str] = {}
        if params:
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/session-links/incoming/{quote(session_id, safe='')}",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionLink)
