"""Embedding types for the Engram SDK."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    # Enums / Union types
    "EmbeddingModule",
    # Request parameters
    "EmbeddingRequest",
    # Response models
    "EmbeddingResponse",
    "BatchEmbeddingResponse",
    "EmbeddingInfoResponse",
]

# ============================================================================
# Enums / Union Types
# ============================================================================

# Embedding module targets:
#   "session"     - Session-scoped embeddings
#   "patterns"    - Pattern library embeddings
#   "memory-bank" - Memory bank embeddings
#   "search"      - General search embeddings
#   "retrieval"   - Retrieval-optimized embeddings
EmbeddingModule = Literal["session", "patterns", "memory-bank", "search", "retrieval"]


# ============================================================================
# Request Parameters
# ============================================================================


class EmbeddingRequest(BaseModel):
    """Parameters for generating a single embedding."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    text: str
    module: Optional[EmbeddingModule] = None


# ============================================================================
# Response Models
# ============================================================================


class EmbeddingResponse(BaseModel):
    """Response from a single embedding generation."""

    model_config = ConfigDict(populate_by_name=True)

    embedding: list[float]
    dimensions: int
    model: str
    cached: bool
    took: float


class BatchEmbeddingItem(BaseModel):
    """A single embedding result within a batch response."""

    model_config = ConfigDict(populate_by_name=True)

    embedding: list[float]
    dimensions: int
    cached: bool


class BatchEmbeddingResponse(BaseModel):
    """Response from a batch embedding generation."""

    model_config = ConfigDict(populate_by_name=True)

    embeddings: list[BatchEmbeddingItem]
    count: int
    model: str
    took: float


class EmbeddingCacheInfo(BaseModel):
    """Cache statistics for the embedding service."""

    model_config = ConfigDict(populate_by_name=True)

    size: int
    max_size: int = Field(alias="maxSize")


class EmbeddingInfoResponse(BaseModel):
    """Response from the embedding info endpoint."""

    model_config = ConfigDict(populate_by_name=True)

    available: bool
    model: str
    dimensions: int
    max_input_chars: int = Field(alias="maxInputChars")
    cache: EmbeddingCacheInfo
