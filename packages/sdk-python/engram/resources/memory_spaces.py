"""Memory space resources for the Engram SDK.

Resource-based interface for shared memory space management. Memory spaces
allow agents to collaborate within shared knowledge containers.

Mirrors the TypeScript SDK's ``MemorySpacesResource``
(``packages/sdk/src/resources/memory-spaces.ts``).

These endpoints use the standard ``{ data }`` envelope, but the inner payload
is keyed by member name (``{ data: { space } }``, ``{ data: { spaces } }``,
``{ data: { member } }``). Each method unwraps ``data`` and then the named
member, matching the TS contract exactly.
"""
from __future__ import annotations

from typing import Any, List, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.memory_spaces import (
    CreateMemorySpaceParams,
    JoinMemorySpaceParams,
    MemorySpace,
    MemorySpaceMember,
    MemorySpaceWithMembers,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _unwrap_member(response: Any, key: str) -> Any:
    """Unwrap ``response["data"][key]`` from a memory-spaces envelope.

    The memory-spaces routes wrap their payload as ``{ data: { <key> } }``
    (e.g. ``{ data: { space } }``). This mirrors the TS ``unwrapDataObject``
    followed by the named-member read.
    """
    data = response["data"]
    return data[key]


class MemorySpacesResource(BaseResource):
    """Async resource for shared memory spaces."""

    async def list(self, agent_id: Optional[str] = None) -> List[MemorySpace]:
        """List memory spaces, optionally filtered by agent membership.

        Args:
            agent_id: Filter to spaces the given agent is a member of.

        Returns:
            List of memory spaces.
        """
        qs: dict[str, str] = {}
        if agent_id is not None:
            qs["agentId"] = agent_id
        response = await self._request(
            "GET", "/v1/memory-spaces", params=qs if qs else None
        )
        spaces = _unwrap_member(response, "spaces")
        return [MemorySpace.model_validate(item) for item in spaces]

    async def create(self, params: CreateMemorySpaceParams) -> MemorySpace:
        """Create a new memory space.

        Args:
            params: Title, optional description/visibility, and initial members.

        Returns:
            The created memory space.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/memory-spaces", body)
        return MemorySpace.model_validate(_unwrap_member(response, "space"))

    async def get(self, space_id: str) -> MemorySpaceWithMembers:
        """Get a memory space by ID, including its members.

        Args:
            space_id: The memory space ID.

        Returns:
            The memory space with its members.
        """
        response = await self._request(
            "GET", f"/v1/memory-spaces/{quote(space_id, safe='')}"
        )
        return MemorySpaceWithMembers.model_validate(_unwrap_member(response, "space"))

    async def join(
        self, space_id: str, params: JoinMemorySpaceParams
    ) -> MemorySpaceMember:
        """Join a memory space as an agent with a given permission level.

        Args:
            space_id: The memory space ID.
            params: The agent ID and permission level.

        Returns:
            The created membership record.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST", f"/v1/memory-spaces/{quote(space_id, safe='')}/join", body
        )
        return MemorySpaceMember.model_validate(_unwrap_member(response, "member"))

    async def leave(self, space_id: str, agent_id: str) -> dict[str, Any]:
        """Leave a memory space (remove an agent from the space).

        Args:
            space_id: The memory space ID.
            agent_id: The agent to remove.

        Returns:
            ``{"removed": True}`` on success.
        """
        response = await self._request(
            "DELETE",
            f"/v1/memory-spaces/{quote(space_id, safe='')}/leave",
            params={"agentId": agent_id},
        )
        return response["data"]


class SyncMemorySpacesResource(SyncBaseResource):
    """Sync resource for shared memory spaces."""

    def list(self, agent_id: Optional[str] = None) -> List[MemorySpace]:
        """List memory spaces, optionally filtered by agent membership.

        Args:
            agent_id: Filter to spaces the given agent is a member of.

        Returns:
            List of memory spaces.
        """
        qs: dict[str, str] = {}
        if agent_id is not None:
            qs["agentId"] = agent_id
        response = self._request(
            "GET", "/v1/memory-spaces", params=qs if qs else None
        )
        spaces = _unwrap_member(response, "spaces")
        return [MemorySpace.model_validate(item) for item in spaces]

    def create(self, params: CreateMemorySpaceParams) -> MemorySpace:
        """Create a new memory space.

        Args:
            params: Title, optional description/visibility, and initial members.

        Returns:
            The created memory space.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/memory-spaces", body)
        return MemorySpace.model_validate(_unwrap_member(response, "space"))

    def get(self, space_id: str) -> MemorySpaceWithMembers:
        """Get a memory space by ID, including its members.

        Args:
            space_id: The memory space ID.

        Returns:
            The memory space with its members.
        """
        response = self._request(
            "GET", f"/v1/memory-spaces/{quote(space_id, safe='')}"
        )
        return MemorySpaceWithMembers.model_validate(_unwrap_member(response, "space"))

    def join(self, space_id: str, params: JoinMemorySpaceParams) -> MemorySpaceMember:
        """Join a memory space as an agent with a given permission level.

        Args:
            space_id: The memory space ID.
            params: The agent ID and permission level.

        Returns:
            The created membership record.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST", f"/v1/memory-spaces/{quote(space_id, safe='')}/join", body
        )
        return MemorySpaceMember.model_validate(_unwrap_member(response, "member"))

    def leave(self, space_id: str, agent_id: str) -> dict[str, Any]:
        """Leave a memory space (remove an agent from the space).

        Args:
            space_id: The memory space ID.
            agent_id: The agent to remove.

        Returns:
            ``{"removed": True}`` on success.
        """
        response = self._request(
            "DELETE",
            f"/v1/memory-spaces/{quote(space_id, safe='')}/leave",
            params={"agentId": agent_id},
        )
        return response["data"]
