"""Entity and extraction types for the Engram SDK."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    # Enums
    "EntityClass",
    "EntityReviewAction",
    "ExtractionJobStatus",
    # Entity types
    "EntityCard",
    "EntityEdge",
    "EntityWithEdges",
    "EntityMention",
    "EntityRelationship",
    "EntityReviewResult",
    # Extraction types
    "ExtractionJob",
    "ExtractionConfig",
    "ExtractionStats",
]


# ============================================================================
# Enums
# ============================================================================


class EntityClass(str, Enum):
    PERSON = "PERSON"
    PROJECT = "PROJECT"
    SYSTEM = "SYSTEM"
    CONCEPT = "CONCEPT"
    TECHNOLOGY = "TECHNOLOGY"
    ORGANIZATION = "ORGANIZATION"


class EntityReviewAction(str, Enum):
    APPROVE_MERGE = "APPROVE_MERGE"
    CREATE_NEW = "CREATE_NEW"
    DISMISS = "DISMISS"


class ExtractionJobStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


# ============================================================================
# Entity Types
# ============================================================================


class EntityCard(BaseModel):
    """An entity card representing a recognized entity."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    canonical_name: str = Field(alias="canonicalName")
    entity_class: EntityClass = Field(alias="entityClass")
    confidence: float
    mention_count: int = Field(alias="mentionCount")
    verified: bool
    auto_constructed: bool = Field(alias="autoConstructed")
    corroborating_sources: int = Field(alias="corroboratingSources")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class EntityEdge(BaseModel):
    """An edge between two entities."""

    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(alias="sourceId")
    target_id: str = Field(alias="targetId")
    edge_type: str = Field(alias="edgeType")
    metadata: Optional[Dict[str, Any]] = None


class EntityWithEdges(EntityCard):
    """An entity card with its edges."""

    edges: List[EntityEdge] = []


class EntityMention(BaseModel):
    """A mention of an entity in text."""

    model_config = ConfigDict(populate_by_name=True)

    text: str
    entity_class: EntityClass = Field(alias="entityClass")
    confidence: float
    char_start: int = Field(alias="charStart")
    char_end: int = Field(alias="charEnd")


class EntityRelationship(BaseModel):
    """A relationship between two entities."""

    model_config = ConfigDict(populate_by_name=True)

    source_text: str = Field(alias="sourceText")
    target_text: str = Field(alias="targetText")
    relationship_type: str = Field(alias="relationshipType")
    confidence: float


class EntityReviewResult(BaseModel):
    """Result of an entity review action."""

    model_config = ConfigDict(populate_by_name=True)

    review_id: str = Field(alias="reviewId")
    action: EntityReviewAction
    resolved_entity_id: Optional[str] = Field(None, alias="resolvedEntityId")
    status: str


# ============================================================================
# Extraction Types
# ============================================================================


class ExtractionJob(BaseModel):
    """An extraction job."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    source_id: str = Field(alias="sourceId")
    source_type: str = Field(alias="sourceType")
    status: ExtractionJobStatus
    content_hash: Optional[str] = Field(None, alias="contentHash")
    attempt_count: int = Field(0, alias="attemptCount")
    last_error: Optional[str] = Field(None, alias="lastError")
    retry_after: Optional[str] = Field(None, alias="retryAfter")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ExtractionConfig(BaseModel):
    """Extraction configuration."""

    model_config = ConfigDict(populate_by_name=True)

    threshold: Optional[float] = None
    daily_cap: Optional[int] = Field(None, alias="dailyCap")


class ExtractionStats(BaseModel):
    """Extraction statistics."""

    model_config = ConfigDict(populate_by_name=True)

    jobs: Dict[str, int]
    daily_api_call_usage: int = Field(alias="dailyApiCallUsage")
    average_confidence: float = Field(alias="averageConfidence")
    entity_counts_by_class: Dict[str, int] = Field(alias="entityCountsByClass")
    total_entities: int = Field(alias="totalEntities")
    total_verified: int = Field(alias="totalVerified")
    generated_at: str = Field(alias="generatedAt")
