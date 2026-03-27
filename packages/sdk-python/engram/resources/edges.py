"""Edge resources for the Engram SDK."""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.knowledge_crystal import (
    KnowledgeCrystalEdge,
    CreateKnowledgeCrystalEdgeParams,
    UpdateKnowledgeCrystalEdgeParams,
    ListKnowledgeCrystalEdgesParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class EdgesResource(BaseResource):
    """Async resource for knowledge edges."""

    async def create(
        self,
        params: CreateKnowledgeCrystalEdgeParams,
    ) -> KnowledgeCrystalEdge:
        """Create an edge between knowledge items."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/edges", body)
        return KnowledgeCrystalEdge.model_validate(response["data"])

    async def get(self, id: str) -> KnowledgeCrystalEdge:
        """Get an edge by ID."""
        response = await self._request(
            "GET", f"/v1/edges/{quote(id, safe='')}"
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    async def list(
        self,
        params: Optional[ListKnowledgeCrystalEdgesParams] = None,
    ) -> PaginatedResult[KnowledgeCrystalEdge]:
        """List edges."""
        qs: dict[str, str] = {}
        if params:
            if params.source_id:
                qs["sourceId"] = params.source_id
            if params.target_id:
                qs["targetId"] = params.target_id
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request("GET", "/v1/edges", params=qs if qs else None)
        return self._parse_list(response, KnowledgeCrystalEdge)

    async def update(
        self,
        id: str,
        params: UpdateKnowledgeCrystalEdgeParams,
    ) -> KnowledgeCrystalEdge:
        """Update an edge."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/edges/{quote(id, safe='')}", body
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    async def delete(self, id: str) -> None:
        """Delete an edge."""
        await self._request("DELETE", f"/v1/edges/{quote(id, safe='')}")


class SyncEdgesResource(SyncBaseResource):
    """Sync resource for knowledge edges."""

    def create(
        self,
        params: CreateKnowledgeCrystalEdgeParams,
    ) -> KnowledgeCrystalEdge:
        """Create an edge between knowledge items."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/edges", body)
        return KnowledgeCrystalEdge.model_validate(response["data"])

    def get(self, id: str) -> KnowledgeCrystalEdge:
        """Get an edge by ID."""
        response = self._request(
            "GET", f"/v1/edges/{quote(id, safe='')}"
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    def list(
        self,
        params: Optional[ListKnowledgeCrystalEdgesParams] = None,
    ) -> PaginatedResult[KnowledgeCrystalEdge]:
        """List edges."""
        qs: dict[str, str] = {}
        if params:
            if params.source_id:
                qs["sourceId"] = params.source_id
            if params.target_id:
                qs["targetId"] = params.target_id
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request("GET", "/v1/edges", params=qs if qs else None)
        return self._parse_list(response, KnowledgeCrystalEdge)

    def update(
        self,
        id: str,
        params: UpdateKnowledgeCrystalEdgeParams,
    ) -> KnowledgeCrystalEdge:
        """Update an edge."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/edges/{quote(id, safe='')}", body
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    def delete(self, id: str) -> None:
        """Delete an edge."""
        self._request("DELETE", f"/v1/edges/{quote(id, safe='')}")
