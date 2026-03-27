"""Export/Import types for the Engram SDK."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    # Enums / Literal types
    "ExportScope",
    "ExportFormat",
    "ConflictResolution",
    # Request param models
    "ExportFilter",
    "ExportParams",
    "ImportOptions",
    # Response models
    "ExportEstimate",
    "ImportConflict",
    "ImportPreview",
    "ImportPreviewSchemaVersion",
    "ImportPreviewCounts",
    "ImportPreviewError",
    "ImportResult",
    "ImportResultError",
    "ImportResultCounts",
]

# ============================================================================
# Enums / Literal Types
# ============================================================================

ExportScope = Literal["knowledge", "crystals", "sessions"]

ExportFormat = Literal["ndjson", "archive"]

ConflictResolution = Literal["newer", "skip", "overwrite", "prompt"]

# ============================================================================
# Request Param Models (camelCase — server Zod schemas use camelCase)
# ============================================================================


class ExportFilter(BaseModel):
    """Filters for export requests."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    since: Optional[str] = None
    until: Optional[str] = None
    crystal_ids: Optional[list[str]] = None
    session_ids: Optional[list[str]] = None
    source_project: Optional[str] = None
    types: Optional[list[str]] = None
    crystal_types: Optional[list[str]] = None
    verified: Optional[bool] = None
    min_confidence: Optional[float] = None
    embedded: Optional[bool] = None
    include_related_depth: Optional[int] = None


class ExportParams(BaseModel):
    """Request params for starting an export or estimating export size."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    scopes: list[ExportScope]
    filters: Optional[ExportFilter] = None
    format: ExportFormat = "ndjson"
    compress: bool = True


class ImportOptions(BaseModel):
    """Options for import operations."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    on_conflict: ConflictResolution = "newer"
    wipe: Optional[bool] = None
    wipe_all: Optional[bool] = None
    preview: Optional[bool] = None
    force: Optional[bool] = None
    ignore_checksums: Optional[bool] = None
    target_project: Optional[str] = None


# ============================================================================
# Response Models
# ============================================================================


class ExportEstimate(BaseModel):
    """Estimate of export size and entity counts."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    knowledge_items: int
    knowledge_edges: int
    crystals: int
    crystal_memberships: int
    sessions: int
    session_notes: int
    total_entities: int
    estimated_size_bytes: int


class ImportConflict(BaseModel):
    """A conflict detected during import preview."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    entity_type: str
    title: str
    local_updated_at: str
    import_updated_at: str


class ImportPreviewSchemaVersion(BaseModel):
    """Schema version information from import preview."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    archive: str
    current: str
    migration_required: bool


class ImportPreviewCounts(BaseModel):
    """Counts for a single entity type in import preview."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    new: int
    updated: int
    skipped: int


class ImportPreviewError(BaseModel):
    """Error information from import preview."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    code: str
    message: str


class ImportPreview(BaseModel):
    """Result of previewing an import."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    success: bool
    schema_version: Optional[ImportPreviewSchemaVersion] = None
    counts: Optional[dict[str, ImportPreviewCounts]] = None
    conflicts: Optional[list[ImportConflict]] = None
    conflict_count: Optional[int] = None
    error: Optional[ImportPreviewError] = None


class ImportResultCounts(BaseModel):
    """Counts for a single entity type in import result."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    inserted: int
    updated: int
    skipped: int


class ImportResultError(BaseModel):
    """An error for a single entity during import."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    entity_type: str
    id: str
    error: str


class ImportResult(BaseModel):
    """Result of an import operation."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    success: bool
    counts: dict[str, ImportResultCounts]
    errors: list[ImportResultError]
    duration: float
