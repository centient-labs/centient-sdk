"""Garbage-collection (GC) operation types for the Engram SDK.

Mirrors the TypeScript SDK's GC types
(``packages/sdk/src/resources/gc.ts``).

GC endpoints return the standard ``{ data, meta }`` envelope. ``getCandidates``
and ``getAuditLog`` carry their list payload nested under ``data`` together with
a sibling ``threshold``/``total`` scalar, and ``hasMore`` is sourced from
``meta.pagination.hasMore``; the resource folds that into the result models
below.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "GcCandidate",
    "GcAuditEntry",
    "GcRunResult",
    "GcCandidatesResult",
    "GcAuditResult",
    "ListGcCandidatesParams",
    "ListGcAuditParams",
    "GcRunOptions",
]


class GcCandidate(BaseModel):
    """A garbage-collection candidate ranked by relevance score."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    title: str
    node_type: str
    relevance_score: float
    access_count: int
    last_accessed_at: Optional[str] = None
    created_at: str
    verified: bool
    lifecycle_status: str


class GcAuditEntry(BaseModel):
    """An entry in the GC audit log describing a previous run."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    run_at: str
    decay_curve: str
    threshold: float
    scanned_crystals: int
    archived_crystals: int
    scanned_notes: int
    archived_notes: int
    dry_run: bool
    details: Dict[str, Any]


class GcRunResult(BaseModel):
    """Result of a garbage-collection run."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    scanned_crystals: int
    archived_crystals: int
    scanned_notes: int
    archived_notes: int
    dry_run: bool


class GcCandidatesResult(BaseModel):
    """Aggregate result of listing GC candidates.

    ``has_more`` is folded in by the resource from ``meta.pagination.hasMore``.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    candidates: List[GcCandidate]
    threshold: float
    total: int
    has_more: bool = False


class GcAuditResult(BaseModel):
    """Aggregate result of reading the GC audit log.

    ``has_more`` is folded in by the resource from ``meta.pagination.hasMore``.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    entries: List[GcAuditEntry]
    total: int
    has_more: bool = False


class ListGcCandidatesParams(BaseModel):
    """Query parameters for listing GC candidates."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    threshold: Optional[float] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class ListGcAuditParams(BaseModel):
    """Query parameters for reading the GC audit log."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    limit: Optional[int] = None
    offset: Optional[int] = None


class GcRunOptions(BaseModel):
    """Options for triggering a GC run."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    dry_run: Optional[bool] = None
