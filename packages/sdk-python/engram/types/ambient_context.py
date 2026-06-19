"""Ambient context types for the Engram SDK.

Mirrors the TypeScript SDK's ambient-context types
(``packages/sdk/src/resources/ambient-context.ts``).

Role-biased ambient knowledge context: crystals ranked by relevance to the
current agent's role.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "AmbientCrystal",
    "GetAmbientContextParams",
]


class AmbientCrystal(BaseModel):
    """A crystal returned in an ambient-context query, with a relevance score."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    title: str
    description: Optional[str] = None
    node_type: str
    tags: List[str]
    relevance_score: float


class GetAmbientContextParams(BaseModel):
    """Parameters for fetching ambient context for a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    session_id: str
    role: Optional[str] = None
    limit: Optional[int] = None
