"""Fact types for the Engram SDK.

Bi-temporal fact types mirroring the TypeScript SDK's facts types
(``packages/sdk/src/resources/facts.ts``).

Facts are versioned with point-in-time (``validAt`` / ``asOf``) queries and a
full version history. Single-object responses are wrapped in the standard
``{ data }`` envelope; history is a paginated list.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "Fact",
    "CreateFactParams",
    "UpdateFactParams",
    "FactHistoryParams",
]


class Fact(BaseModel):
    """A bi-temporal fact version."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    key: str
    value: Dict[str, Any]
    valid_from: str
    valid_to: Optional[str] = None
    created_at: str
    updated_at: str


class CreateFactParams(BaseModel):
    """Parameters for creating a new fact."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    key: str
    value: Dict[str, Any]
    valid_at: Optional[str] = None


class UpdateFactParams(BaseModel):
    """Parameters for updating an existing fact."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    value: Dict[str, Any]
    valid_at: Optional[str] = None


class FactHistoryParams(BaseModel):
    """Parameters for querying the version history of a fact."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
