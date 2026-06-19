"""Memory space types for the Engram SDK.

Mirrors the TypeScript SDK's memory-spaces types
(``packages/sdk/src/resources/memory-spaces.ts``).

Memory spaces are shared knowledge containers that let multiple agents
collaborate within a single space. These endpoints use the standard
``{ data }`` envelope, with the inner payload keyed by member name
(``{ data: { space } }``, ``{ data: { spaces } }``, ``{ data: { member } }``).
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "MemorySpacePermission",
    "MemorySpace",
    "MemorySpaceMember",
    "MemorySpaceWithMembers",
    "MemorySpaceInitialMember",
    "CreateMemorySpaceParams",
    "JoinMemorySpaceParams",
]


MemorySpacePermission = Literal["read", "write", "admin"]


class MemorySpace(BaseModel):
    """A shared memory space."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    title: str
    description: Optional[str] = None
    visibility: Literal["private", "shared"]
    node_type: Literal["memory_space"]
    created_at: str
    updated_at: str


class MemorySpaceMember(BaseModel):
    """A member of a memory space."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    agent_id: str
    permission: MemorySpacePermission
    joined_at: str


class MemorySpaceWithMembers(MemorySpace):
    """A memory space including its members."""

    members: List[MemorySpaceMember] = []


class MemorySpaceInitialMember(BaseModel):
    """An initial member specification used when creating a memory space."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    agent_id: str
    permission: MemorySpacePermission


class CreateMemorySpaceParams(BaseModel):
    """Parameters for creating a memory space."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    title: str
    description: Optional[str] = None
    visibility: Optional[Literal["private", "shared"]] = None
    initial_members: Optional[List[MemorySpaceInitialMember]] = None


class JoinMemorySpaceParams(BaseModel):
    """Parameters for joining a memory space."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    agent_id: str
    permission: MemorySpacePermission
