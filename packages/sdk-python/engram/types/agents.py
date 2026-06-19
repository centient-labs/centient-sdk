"""Agent identity types for the Engram SDK.

Mirrors the TypeScript SDK's agents types
(``packages/sdk/src/resources/agents.ts``).

Agent records are returned wrapped in a nested envelope: a single agent as
``{ data: { agent } }`` and a list as ``{ data: { agents } }``. The resource
unwraps these inner keys rather than treating ``data`` itself as the payload.

Request params use ``populate_by_name=True`` + ``alias_generator=to_camel`` so
snake_case Python fields serialize to the camelCase wire fields the server
expects (e.g. ``external_id`` -> ``externalId``).
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    "AgentIdentity",
    "CreateAgentParams",
    "UpdateAgentParams",
    "ListAgentsParams",
    "DeleteAgentResult",
]


class AgentIdentity(BaseModel):
    """An agent identity record."""

    model_config = ConfigDict(populate_by_name=True)

    agent_id: str = Field(alias="agentId")
    external_id: str = Field(alias="externalId")
    display_name: str = Field(alias="displayName")
    role: str
    permissions: List[str]
    owner_user_id: Optional[str] = Field(None, alias="ownerUserId")
    created_at: str = Field(alias="createdAt")
    last_active_at: Optional[str] = Field(None, alias="lastActiveAt")


class CreateAgentParams(BaseModel):
    """Parameters for creating (idempotently upserting) an agent."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    external_id: str
    display_name: str
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    owner_user_id: Optional[str] = None


class UpdateAgentParams(BaseModel):
    """Parameters for updating an agent's display name and/or permissions."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    display_name: Optional[str] = None
    permissions: Optional[List[str]] = None


class ListAgentsParams(BaseModel):
    """Parameters for filtering the agent list."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    owner_user_id: Optional[str] = None


class DeleteAgentResult(BaseModel):
    """Result of a soft-delete agent operation."""

    model_config = ConfigDict(populate_by_name=True)

    deleted: bool
