"""Event types for the Engram SDK (SSE streaming)."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    "EngramEventType",
    "EngramStreamEvent",
]


class EngramEventType(str, Enum):
    """Event types emitted by the Engram SSE stream."""

    CRYSTAL_CREATED = "crystal.created"
    CRYSTAL_UPDATED = "crystal.updated"
    CRYSTAL_DELETED = "crystal.deleted"
    NOTE_CREATED = "note.created"
    NOTE_UPDATED = "note.updated"
    NOTE_DELETED = "note.deleted"
    SESSION_STARTED = "session.started"
    SESSION_ENDED = "session.ended"
    COHERENCE_CONTRADICTION_DETECTED = "coherence.contradiction_detected"


class EngramStreamEvent(BaseModel):
    """A single event from the Engram SSE stream."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )

    id: str
    type: EngramEventType
    timestamp: str
    entity_type: str = Field(alias="entityType")
    entity_id: str = Field(alias="entityId")
    summary: str
    data: Optional[Dict[str, Any]] = None
