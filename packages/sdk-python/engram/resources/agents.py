"""Agents resource for the Engram SDK.

Resource-based interface for agent identity management: CRUD operations on
agent records with an idempotent upsert on creation.

Mirrors the TypeScript SDK's ``AgentsResource``
(``packages/sdk/src/resources/agents.ts``).

Agent responses use a **nested** envelope: a single agent arrives as
``{ data: { agent } }`` and a list as ``{ data: { agents } }``. These helpers
unwrap the inner ``agent``/``agents`` key and raise :class:`~engram.errors.EngramError`
(code ``INTERNAL_ERROR``) on a contract drift, mirroring the TS resource's
``ResponseShapeError`` — so a regression fails loudly instead of returning a
model with missing fields.
"""
from __future__ import annotations

from typing import Any, List, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError
from engram.types.agents import (
    AgentIdentity,
    CreateAgentParams,
    DeleteAgentResult,
    ListAgentsParams,
    UpdateAgentParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _require_agent(response: Any, route: str) -> AgentIdentity:
    """Unwrap ``{ data: { agent } }`` into an :class:`AgentIdentity`.

    Raises if the response, its ``data`` envelope, or the inner ``agent`` field
    is missing or not an object, mirroring the TS resource's ``requireAgent``.
    """
    data = response.get("data") if isinstance(response, dict) else None
    agent = data.get("agent") if isinstance(data, dict) else None
    if not isinstance(agent, dict):
        raise EngramError(
            f"Unexpected {route} response shape (expected {{ data: {{ agent }} }})",
            code="INTERNAL_ERROR",
        )
    return AgentIdentity.model_validate(agent)


def _require_agents(response: Any, route: str) -> List[AgentIdentity]:
    """Unwrap ``{ data: { agents } }`` into a list of :class:`AgentIdentity`.

    Raises if the response, its ``data`` envelope, or the inner ``agents`` field
    is missing or not an array, mirroring the TS resource's ``requireArray``.
    """
    data = response.get("data") if isinstance(response, dict) else None
    agents = data.get("agents") if isinstance(data, dict) else None
    if not isinstance(agents, list):
        raise EngramError(
            f"Unexpected {route} response shape (expected {{ data: {{ agents }} }})",
            code="INTERNAL_ERROR",
        )
    return [AgentIdentity.model_validate(item) for item in agents]


def _list_query_params(
    params: Optional[ListAgentsParams],
) -> Optional[dict[str, str]]:
    """Build the list query params, dropping ``None``/empty values."""
    if params and params.owner_user_id:
        return {"ownerUserId": params.owner_user_id}
    return None


class AgentsResource(BaseResource):
    """Async resource for agent identity management."""

    async def create(self, params: CreateAgentParams) -> AgentIdentity:
        """Create or idempotently upsert an agent.

        Returns 200 (not 201) because this is an idempotent upsert. If an agent
        with the given ``external_id`` already exists (including soft-deleted),
        it is updated/resurrected rather than duplicated.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/agents", body)
        return _require_agent(response, "POST /v1/agents")

    async def list(
        self, params: Optional[ListAgentsParams] = None
    ) -> List[AgentIdentity]:
        """List all non-deleted agents, optionally filtered by ``owner_user_id``."""
        response = await self._request(
            "GET", "/v1/agents", params=_list_query_params(params)
        )
        return _require_agents(response, "GET /v1/agents")

    async def get(self, agent_id: str) -> AgentIdentity:
        """Get a single agent by its internal UUID."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        response = await self._request("GET", path)
        return _require_agent(response, f"GET {path}")

    async def update(
        self, agent_id: str, params: UpdateAgentParams
    ) -> AgentIdentity:
        """Update an agent's display name and/or permissions."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("PUT", path, body)
        return _require_agent(response, f"PUT {path}")

    async def delete(self, agent_id: str) -> DeleteAgentResult:
        """Soft-delete an agent and clean up associated ACL rows."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        response = await self._request("DELETE", path)
        data = response.get("data") if isinstance(response, dict) else None
        if not isinstance(data, dict):
            raise EngramError(
                f"Unexpected DELETE {path} response shape (expected {{ data: {{ deleted }} }})",
                code="INTERNAL_ERROR",
            )
        return DeleteAgentResult.model_validate(data)


class SyncAgentsResource(SyncBaseResource):
    """Sync resource for agent identity management."""

    def create(self, params: CreateAgentParams) -> AgentIdentity:
        """Create or idempotently upsert an agent.

        See :meth:`AgentsResource.create`.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/agents", body)
        return _require_agent(response, "POST /v1/agents")

    def list(
        self, params: Optional[ListAgentsParams] = None
    ) -> List[AgentIdentity]:
        """List all non-deleted agents, optionally filtered by ``owner_user_id``."""
        response = self._request(
            "GET", "/v1/agents", params=_list_query_params(params)
        )
        return _require_agents(response, "GET /v1/agents")

    def get(self, agent_id: str) -> AgentIdentity:
        """Get a single agent by its internal UUID."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        response = self._request("GET", path)
        return _require_agent(response, f"GET {path}")

    def update(self, agent_id: str, params: UpdateAgentParams) -> AgentIdentity:
        """Update an agent's display name and/or permissions."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("PUT", path, body)
        return _require_agent(response, f"PUT {path}")

    def delete(self, agent_id: str) -> DeleteAgentResult:
        """Soft-delete an agent and clean up associated ACL rows."""
        path = f"/v1/agents/{quote(agent_id, safe='')}"
        response = self._request("DELETE", path)
        data = response.get("data") if isinstance(response, dict) else None
        if not isinstance(data, dict):
            raise EngramError(
                f"Unexpected DELETE {path} response shape (expected {{ data: {{ deleted }} }})",
                code="INTERNAL_ERROR",
            )
        return DeleteAgentResult.model_validate(data)
