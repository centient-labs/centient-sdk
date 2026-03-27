"""Blob types for the Engram SDK."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "BlobMetadata",
    "BlobUploadResponse",
    "BlobReference",
    "GcResult",
]

# ============================================================================
# Response Models
# ============================================================================


class BlobMetadata(BaseModel):
    """Blob metadata returned by GET /v1/blobs/:id/metadata."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    checksum: str
    mime_type: str
    size_bytes: int
    storage_path: str
    reference_count: int
    created_at: str
    last_accessed_at: str


class BlobUploadResponse(BaseModel):
    """Response from POST /v1/blobs (upload)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    checksum: str
    mime_type: str
    size_bytes: int
    created_at: str


class BlobReference(BaseModel):
    """Response from POST /v1/blobs/:id/reference."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    added: bool


class GcResult(BaseModel):
    """Response from POST /v1/blobs/gc."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    deleted: int
