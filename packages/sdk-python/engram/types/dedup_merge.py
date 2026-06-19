"""Dedup / deferred-merge review types (P11 lifecycle) for the Engram SDK.

Mirrors the TypeScript SDK's dedup-merge types
(``packages/sdk/src/resources/crystals.ts`` and
``packages/sdk/src/resources/sessions.ts``).

Several of these routes return **bare** (non-enveloped) bodies — see the
resource methods (``crystals.pending_merges`` / ``review_merge`` /
``merge_history`` and ``notes.dedup``) for the unwrapping rules.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "DedupMergeMethod",
    "DedupMergeOutcomeStrategy",
    "MergeReviewDecision",
    "NoteDedupAction",
    "PendingMerge",
    "ListPendingMergesParams",
    "MergeRecord",
    "ReviewMergeParams",
    "ReviewMergeResult",
    "DedupNoteParams",
    "DedupNoteResult",
]


# How a duplicate was detected/merged.
DedupMergeMethod = Literal["semantic", "exact", "manual"]

# Which side survives a merge.
DedupMergeOutcomeStrategy = Literal["oldest_wins", "user_selected"]

# Decision passed to ``crystals.review_merge``.
MergeReviewDecision = Literal["approve", "reject", "modify"]

# Outcome of a note dedup check.
NoteDedupAction = Literal["merged", "deferred", "no_match"]


class PendingMerge(BaseModel):
    """A deferred merge candidate awaiting review (camelCase wire shape)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    merge_id: str
    source_id: str
    target_id: str
    source_type: Literal["session_note", "knowledge_crystal"]
    target_type: Literal["knowledge_crystal"]
    confidence: float
    merge_method: DedupMergeMethod
    merge_outcome_strategy: DedupMergeOutcomeStrategy
    created_at: str


class ListPendingMergesParams(BaseModel):
    """Filters for ``crystals.pending_merges``."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    session_id: Optional[str] = None
    limit: Optional[int] = None


class MergeRecord(BaseModel):
    """A single record in a merge provenance chain (camelCase wire shape)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    source_note_id: Optional[str] = None
    source_crystal_id: Optional[str] = None
    target_crystal_id: str
    merge_method: DedupMergeMethod
    merge_outcome_strategy: DedupMergeOutcomeStrategy
    similarity_score: Optional[float] = None
    merge_reason: str
    merged_content_snapshot: Dict[str, Any]
    merged_by: str
    merged_at: str
    reversible: bool
    reverse_record_id: Optional[str] = None
    created_at: str


class ReviewMergeParams(BaseModel):
    """Params for ``crystals.review_merge``.

    ``merged_content`` is required when ``decision`` is ``"modify"`` (the server
    rejects a ``modify`` without it with a 400 ``VALIDATION_ERROR``).
    """

    model_config = ConfigDict(populate_by_name=True)

    decision: MergeReviewDecision
    merged_content: Optional[str] = None


class ReviewMergeResult(BaseModel):
    """Result of ``crystals.review_merge``."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    decision: MergeReviewDecision
    # The surviving crystal id (present on approve/modify, absent on reject).
    target_crystal_id: Optional[str] = None


class DedupNoteParams(BaseModel):
    """Request body for ``notes.dedup``.

    Both fields are accepted on the wire for forward-compatibility but are not
    currently read by the server.
    """

    model_config = ConfigDict(populate_by_name=True)

    merge_method: Optional[Literal["semantic", "exact"]] = None
    threshold: Optional[float] = None


class DedupNoteResult(BaseModel):
    """Result of ``notes.dedup`` (bare, non-enveloped, snake_case wire body)."""

    model_config = ConfigDict(populate_by_name=True)

    action: NoteDedupAction
    merge_id: Optional[str] = None
    confidence: Optional[float] = None
    canonical_id: Optional[str] = None
