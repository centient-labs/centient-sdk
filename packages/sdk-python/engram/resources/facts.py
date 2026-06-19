"""Facts resource for the Engram SDK.

Resource-based interface for bi-temporal fact management: versioned facts with
point-in-time queries and full version history.

Mirrors the TypeScript SDK's ``FactsResource``
(``packages/sdk/src/resources/facts.ts``). Single-object responses are
unwrapped from the standard ``{ data }`` envelope; history is parsed as a
paginated list.
"""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.facts import (
    CreateFactParams,
    Fact,
    FactHistoryParams,
    UpdateFactParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _history_query(params: Optional[FactHistoryParams]) -> Optional[dict[str, str]]:
    """Build the history query params, dropping ``None`` values.

    Mirrors the TS SDK's ``URLSearchParams`` shaping in
    ``packages/sdk/src/resources/facts.ts``.
    """
    if params is None:
        return None
    qs: dict[str, str] = {}
    if params.valid_from is not None:
        qs["validFrom"] = params.valid_from
    if params.valid_to is not None:
        qs["validTo"] = params.valid_to
    if params.limit is not None:
        qs["limit"] = str(params.limit)
    if params.offset is not None:
        qs["offset"] = str(params.offset)
    return qs if qs else None


class FactsResource(BaseResource):
    """Async resource for bi-temporal facts.

    Example::

        # Create a new fact
        fact = await client.facts.create(
            CreateFactParams(key="user.preferences.theme", value={"mode": "dark"})
        )

        # Get a fact by key
        current = await client.facts.get_by_key("user.preferences.theme")

        # Get a fact as it was at a specific point in time
        historical = await client.facts.get(fact.id, as_of="2025-01-15T00:00:00Z")

        # Update a fact
        updated = await client.facts.update(
            fact.id, UpdateFactParams(value={"mode": "light"})
        )

        # Browse version history
        history = await client.facts.get_history(fact.id, FactHistoryParams(limit=10))
    """

    async def create(self, params: CreateFactParams) -> Fact:
        """Create a new fact."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/facts", body)
        return Fact.model_validate(response["data"])

    async def get(self, fact_id: str, as_of: Optional[str] = None) -> Fact:
        """Get a fact by ID, optionally as of a specific point in time.

        Args:
            fact_id: The fact ID.
            as_of: Point-in-time timestamp to resolve the fact at.

        Returns:
            The fact version.
        """
        qs: dict[str, str] = {}
        if as_of is not None:
            qs["asOf"] = as_of
        response = await self._request(
            "GET", f"/v1/facts/{quote(fact_id, safe='')}", params=qs if qs else None
        )
        return Fact.model_validate(response["data"])

    async def get_by_key(self, key: str) -> Fact:
        """Get a fact by its key."""
        response = await self._request("GET", "/v1/facts", params={"key": key})
        return Fact.model_validate(response["data"])

    async def update(self, fact_id: str, params: UpdateFactParams) -> Fact:
        """Update an existing fact."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/facts/{quote(fact_id, safe='')}", body
        )
        return Fact.model_validate(response["data"])

    async def get_history(
        self, fact_id: str, params: Optional[FactHistoryParams] = None
    ) -> PaginatedResult[Fact]:
        """Get the version history of a fact.

        Returns:
            Paginated list of fact versions (``items``), with ``total`` and
            ``has_more`` from the response pagination meta.
        """
        response = await self._request(
            "GET",
            f"/v1/facts/{quote(fact_id, safe='')}/history",
            params=_history_query(params),
        )
        return self._parse_list(response, Fact)


class SyncFactsResource(SyncBaseResource):
    """Sync resource for bi-temporal facts."""

    def create(self, params: CreateFactParams) -> Fact:
        """Create a new fact."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/facts", body)
        return Fact.model_validate(response["data"])

    def get(self, fact_id: str, as_of: Optional[str] = None) -> Fact:
        """Get a fact by ID, optionally as of a specific point in time.

        Args:
            fact_id: The fact ID.
            as_of: Point-in-time timestamp to resolve the fact at.

        Returns:
            The fact version.
        """
        qs: dict[str, str] = {}
        if as_of is not None:
            qs["asOf"] = as_of
        response = self._request(
            "GET", f"/v1/facts/{quote(fact_id, safe='')}", params=qs if qs else None
        )
        return Fact.model_validate(response["data"])

    def get_by_key(self, key: str) -> Fact:
        """Get a fact by its key."""
        response = self._request("GET", "/v1/facts", params={"key": key})
        return Fact.model_validate(response["data"])

    def update(self, fact_id: str, params: UpdateFactParams) -> Fact:
        """Update an existing fact."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/facts/{quote(fact_id, safe='')}", body
        )
        return Fact.model_validate(response["data"])

    def get_history(
        self, fact_id: str, params: Optional[FactHistoryParams] = None
    ) -> PaginatedResult[Fact]:
        """Get the version history of a fact.

        Returns:
            Paginated list of fact versions (``items``), with ``total`` and
            ``has_more`` from the response pagination meta.
        """
        response = self._request(
            "GET",
            f"/v1/facts/{quote(fact_id, safe='')}/history",
            params=_history_query(params),
        )
        return self._parse_list(response, Fact)
