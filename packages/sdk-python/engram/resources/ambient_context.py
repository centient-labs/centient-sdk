"""Ambient context resource for the Engram SDK.

Resource-based interface for role-biased ambient knowledge context: returns
crystals ranked by relevance to the current agent's role.

Mirrors the TypeScript SDK's ``AmbientContextResource``
(``packages/sdk/src/resources/ambient-context.ts``).
"""
from __future__ import annotations

from typing import List, Optional, TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.types.ambient_context import AmbientCrystal, GetAmbientContextParams

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _ambient_query_params(params: GetAmbientContextParams) -> dict[str, str]:
    """Build the ambient-context query params, dropping omitted optionals.

    Mirrors the TS SDK's ``URLSearchParams`` shaping: ``sessionId`` is always
    sent; ``role`` and ``limit`` only when provided.
    """
    qs: dict[str, str] = {"sessionId": params.session_id}
    if params.role is not None:
        qs["role"] = params.role
    if params.limit is not None:
        qs["limit"] = str(params.limit)
    return qs


class AmbientContextResource(BaseResource):
    """Async resource for role-biased ambient knowledge context."""

    async def get(self, params: GetAmbientContextParams) -> List[AmbientCrystal]:
        """Fetch ambient crystals for a session, optionally biased by agent role.

        When ``role`` is provided, crystals with tags matching the role string
        are ranked higher. Results are limited to top-N (default 10 server-side).

        Args:
            params: Session id plus optional role bias and result limit.

        Returns:
            Crystals ranked by relevance to the agent's role.
        """
        response = await self._request(
            "GET",
            "/v1/ambient-context",
            params=_ambient_query_params(params),
        )
        data = response["data"]
        return [
            AmbientCrystal.model_validate(item) for item in data["ambientCrystals"]
        ]


class SyncAmbientContextResource(SyncBaseResource):
    """Sync resource for role-biased ambient knowledge context."""

    def get(self, params: GetAmbientContextParams) -> List[AmbientCrystal]:
        """Fetch ambient crystals for a session, optionally biased by agent role.

        See :meth:`AmbientContextResource.get`.

        Args:
            params: Session id plus optional role bias and result limit.

        Returns:
            Crystals ranked by relevance to the agent's role.
        """
        response = self._request(
            "GET",
            "/v1/ambient-context",
            params=_ambient_query_params(params),
        )
        data = response["data"]
        return [
            AmbientCrystal.model_validate(item) for item in data["ambientCrystals"]
        ]
