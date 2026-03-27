"""Session types for the Engram SDK."""
from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

if TYPE_CHECKING:
    from engram.types.knowledge_crystal import KnowledgeCrystal

__all__ = [
    # Core entities
    "LocalSession",
    "LocalSessionNote",
    "LocalSearchResult",
    "SessionScratch",
    "FinalizeSessionResult",
    # Enums / Literal types
    "NoteEmbeddingStatus",
    # Lifecycle types (ADR-050 Phase 4b-1)
    "LifecycleStatus",
    "UpdateLifecycleParams",
    "LifecycleStats",
    # Create/Update parameters
    "CreateLocalSessionParams",
    "UpdateLocalSessionParams",
    "ListLocalSessionsParams",
    "CreateLocalNoteParams",
    "UpdateLocalNoteParams",
    "ListLocalNotesParams",
    "SearchLocalNotesParams",
    "CreateScratchParams",
    "UpdateScratchParams",
    "ListScratchParams",
    "FinalizeSessionOptions",
]


# ============================================================================
# Enums / Literal Types
# ============================================================================

# Note embedding status values:
#   "pending" - Embedding has not yet been generated
#   "synced"  - Embedding is up to date
#   "failed"  - Embedding generation failed
#   "stale"   - Content has changed since the last embedding
NoteEmbeddingStatus = Literal["pending", "synced", "failed", "stale"]


# ============================================================================
# Core Entities
# ============================================================================


class LocalSession(BaseModel):
    """A local session entity."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    external_id: Optional[str] = Field(None, alias="externalId")
    project_path: str = Field(alias="projectPath")
    status: Literal["active", "finalized", "abandoned"]
    started_at: str = Field(alias="startedAt")
    ended_at: Optional[str] = Field(None, alias="endedAt")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class LocalSessionNote(BaseModel):
    """A note within a local session."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    type: str
    content: str
    embedding_status: Literal["pending", "synced", "failed", "stale"] = Field(
        alias="embeddingStatus"
    )
    embedding_updated_at: Optional[str] = Field(None, alias="embeddingUpdatedAt")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class LocalSearchResult(LocalSessionNote):
    """A search result extending a session note with a relevance score."""

    score: float


class SessionScratch(BaseModel):
    """Scratch content within a session, pending promotion."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    type: str
    content: str
    suggested_type: Optional[str] = Field(None, alias="suggestedType")
    promotion_score: Optional[float] = Field(None, alias="promotionScore")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class FinalizeSessionResult(BaseModel):
    """Result of finalizing a session."""

    model_config = ConfigDict(populate_by_name=True)

    session: LocalSession
    crystal: KnowledgeCrystal
    promoted_items: int = Field(alias="promotedItems")


# ============================================================================
# Lifecycle Types (ADR-050 Phase 4b-1)
# ============================================================================


class LifecycleStatus(str, Enum):
    """Lifecycle status of a session note.

    Notes move through lifecycle stages that control their visibility and
    eligibility for promotion to permanent knowledge.
    """

    DRAFT = "draft"
    ACTIVE = "active"
    FINALIZED = "finalized"
    ARCHIVED = "archived"
    SUPERSEDED = "superseded"


class UpdateLifecycleParams(BaseModel):
    """Parameters for updating a note's lifecycle status."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: LifecycleStatus


class LifecycleStats(BaseModel):
    """Aggregate counts of notes grouped by lifecycle status for a session."""

    model_config = ConfigDict(populate_by_name=True)

    draft: int = 0
    active: int = 0
    finalized: int = 0
    archived: int = 0
    superseded: int = 0


# ============================================================================
# Create/Update Parameters
# ============================================================================


class CreateLocalSessionParams(BaseModel):
    """Parameters for creating a local session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    external_id: Optional[str] = None
    project_path: str
    metadata: Optional[dict[str, Any]] = None


class UpdateLocalSessionParams(BaseModel):
    """Parameters for updating a local session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: Optional[Literal["active", "finalized", "abandoned"]] = None
    ended_at: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ListLocalSessionsParams(BaseModel):
    """Parameters for listing local sessions."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    project_path: Optional[str] = None
    status: Optional[Literal["active", "finalized", "abandoned"]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class CreateLocalNoteParams(BaseModel):
    """Parameters for creating a note in a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: str
    content: str
    metadata: Optional[dict[str, Any]] = None


class UpdateLocalNoteParams(BaseModel):
    """Parameters for updating a note."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ListLocalNotesParams(BaseModel):
    """Parameters for listing notes in a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class SearchLocalNotesParams(BaseModel):
    """Parameters for searching notes in a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    query: str
    limit: Optional[int] = None


class CreateScratchParams(BaseModel):
    """Parameters for creating scratch content in a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: str
    content: str
    suggested_type: Optional[str] = None
    promotion_score: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None


class UpdateScratchParams(BaseModel):
    """Parameters for updating scratch content."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: Optional[str] = None
    content: Optional[str] = None
    suggested_type: Optional[str] = None
    promotion_score: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None


class ListScratchParams(BaseModel):
    """Parameters for listing scratch content in a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class FinalizeSessionOptions(BaseModel):
    """Options for finalizing a session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    crystal_name: Optional[str] = None
    crystal_description: Optional[str] = None
    tags: Optional[list[str]] = None


def _rebuild_forward_refs() -> None:
    """Rebuild models with forward references once KnowledgeCrystal is available.

    FinalizeSessionResult references the KnowledgeCrystal type from
    ``types/knowledge_crystal.py``. Because KnowledgeCrystal is only available
    under TYPE_CHECKING at import time (to avoid circular imports), Pydantic
    cannot resolve the forward reference automatically. This function is called
    at module load time to supply the concrete type so that
    FinalizeSessionResult can validate instances at runtime.
    """
    from engram.types.knowledge_crystal import KnowledgeCrystal  # noqa: F811

    FinalizeSessionResult.model_rebuild(_types_namespace={"KnowledgeCrystal": KnowledgeCrystal})


_rebuild_forward_refs()
