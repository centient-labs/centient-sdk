"""Reranking types for the Engram SDK.

Types for the post-retrieval reranking API.
Reranking improves precision by re-scoring retrieved candidates using
a cross-encoder model (mxbai-rerank-xsmall-v1 via ONNX) or heuristic scoring.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

if TYPE_CHECKING:
    from engram.types.knowledge_crystal import KnowledgeCrystal

__all__ = [
    "RerankingStrategy",
    "RerankingContextBudget",
    "RerankingBoosts",
    "RerankingConfig",
    "RerankCandidate",
    "RerankRequest",
    "RerankingMetadata",
    "RerankingBudgetUsage",
    "DiagnosticRerankInfo",
    "RankedSearchResult",
    "RerankResponse",
    "RankedCrystalSearchResult",
    "CrystalSearchWithRerankingResult",
]

RerankingStrategy = Literal["cross_encoder", "heuristic"]


class RerankingContextBudget(BaseModel):
    """Context budget constraints for reranking."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    max_tokens: Optional[int] = None
    """Maximum number of tokens to include in reranked output."""

    overflow_strategy: Optional[Literal["truncate", "drop", "none"]] = None
    """Strategy when budget is exceeded."""


class RerankingBoosts(BaseModel):
    """Score boosts applied to reranked results."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    tags: Optional[Dict[str, float]] = None
    """Boost score for results with specific tags."""

    recency_days: Optional[int] = None
    """Boost score for results newer than N days."""

    recency_boost: Optional[float] = None
    """Recency boost multiplier (0.0–1.0)."""


class RerankingConfig(BaseModel):
    """Reranking configuration passed per-request.

    All fields are optional; omitting ``enabled`` defers to global config.

    Example::

        config = RerankingConfig(enabled=True, candidate_multiplier=3)
        results = await client.crystals.search(
            SearchKnowledgeCrystalsParams(query="auth patterns", reranking=config)
        )
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    enabled: Optional[bool] = None
    """Enable or disable reranking for this request. Overrides global config when set."""

    strategy: Optional[RerankingStrategy] = None
    """Strategy to use (default: cross_encoder with heuristic fallback)."""

    candidate_multiplier: Optional[float] = Field(default=None, ge=1, le=10)
    """Candidate pool multiplier. Fetches ``limit * candidate_multiplier`` candidates
    before reranking. Range: 1–10. Default: 3."""

    timeout_ms: Optional[int] = Field(default=None, ge=50, le=5000)
    """Timeout in milliseconds for the reranking call. Range: 50–5000. Default: 2000."""

    include_diagnostics: Optional[bool] = None
    """Include per-result diagnostic info in the response."""

    context_budget: Optional[RerankingContextBudget] = None
    """Context budget constraints."""

    boosts: Optional[RerankingBoosts] = None
    """Score boosts for specific content attributes."""


class RerankCandidate(BaseModel):
    """A pre-fetched candidate for reranking."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    """Crystal node ID."""

    content: str
    """Text content to score against the query."""

    retrieval_score: float
    """Original retrieval score (e.g. vector similarity)."""

    created_at: Optional[str] = None
    """ISO 8601 creation timestamp (used for recency boosts)."""

    tags: Optional[List[str]] = None
    """Tags (used for tag boosts)."""


class RerankRequest(BaseModel):
    """Request body for ``POST /v1/crystals/rerank``.

    Accepts pre-fetched candidates (e.g. from a prior search or external source).

    Example::

        request = RerankRequest(
            query="authentication patterns",
            candidates=[
                RerankCandidate(id="abc", content="...", retrieval_score=0.85),
                RerankCandidate(id="def", content="...", retrieval_score=0.78),
            ],
            limit=5,
        )
        result = await client.crystals.rerank(request)
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    query: str
    """The search query to score candidates against."""

    candidates: List[RerankCandidate]
    """Pre-fetched candidates to rerank."""

    limit: Optional[int] = None
    """Maximum results to return after reranking."""

    reranking: Optional[RerankingConfig] = None
    """Reranking configuration (``enabled`` field ignored here — always reranks)."""


class RerankingMetadata(BaseModel):
    """Reranking metadata returned with a reranked response."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: Literal["reranked", "heuristic_fallback", "skipped"]
    """Final reranking status."""

    fallback_reason: Optional[str] = None
    """Reason for heuristic fallback, if applicable."""

    model: Optional[str] = None
    """Model name used for reranking."""

    latency_ms: Optional[float] = None
    """Reranking latency in milliseconds."""

    candidate_pool_size: Optional[int] = None
    """Number of candidates evaluated before selecting top-N."""


class RerankingBudgetUsage(BaseModel):
    """Context budget usage reported in the response."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    tokens_used: int
    """Tokens used."""

    token_limit: int
    """Token limit."""

    truncated: bool
    """Whether any results were dropped due to budget overflow."""


class DiagnosticRerankInfo(BaseModel):
    """Per-result diagnostic information (present when ``include_diagnostics=True``)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    raw_score: Optional[float] = None
    """Raw cross-encoder score before normalization."""

    retrieval_score: float
    """Retrieval score from the original vector search."""

    final_score: float
    """Final combined score."""

    boosts: Optional[Dict[str, float]] = None
    """Applied boost breakdown (e.g. tag_boost, recency_boost)."""


class RankedSearchResult(BaseModel):
    """A single reranked result (id + scores only, no hydrated item)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    """Crystal node ID."""

    score: float
    """Final reranked score."""

    retrieval_score: float
    """Original retrieval score before reranking."""

    diagnostics: Optional[DiagnosticRerankInfo] = None
    """Per-result diagnostics (present when ``include_diagnostics=True``)."""


class RerankResponse(BaseModel):
    """Response from ``POST /v1/crystals/rerank``."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    results: List[RankedSearchResult]
    """Reranked results in descending score order."""

    reranking: RerankingMetadata
    """Reranking operation metadata."""

    budget_usage: Optional[RerankingBudgetUsage] = None
    """Context budget usage (present when ``context_budget`` was specified)."""

    diagnostics: Optional[Dict[str, Any]] = None
    """Aggregate diagnostics (present when ``include_diagnostics=True``)."""


# ============================================================================
# Crystal-enriched reranking result types
# ============================================================================


class RankedCrystalSearchResult(BaseModel):
    """A single result from a reranked crystal search (item hydrated from server)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    item: KnowledgeCrystal
    """The matched knowledge crystal node."""

    score: float
    """Final reranked score."""

    retrieval_score: float
    """Original retrieval score before reranking."""

    diagnostics: Optional[DiagnosticRerankInfo] = None
    """Per-result diagnostics (present when ``include_diagnostics=True``)."""


class CrystalSearchWithRerankingResult(BaseModel):
    """Response from a crystal search with reranking enabled.

    Returned by ``crystals.search()`` when ``reranking.enabled=True``.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    results: List[RankedCrystalSearchResult]
    """Reranked results in descending score order."""

    reranking: RerankingMetadata
    """Reranking operation metadata."""

    diagnostics: Optional[Dict[str, Any]] = None
    """Aggregate diagnostics (present when ``include_diagnostics=True``)."""


def _rebuild_forward_refs() -> None:
    """Resolve deferred KnowledgeCrystal forward reference for Pydantic."""
    from engram.types.knowledge_crystal import KnowledgeCrystal  # noqa: F811

    RankedCrystalSearchResult.model_rebuild(
        _types_namespace={"KnowledgeCrystal": KnowledgeCrystal},
    )
    CrystalSearchWithRerankingResult.model_rebuild()


_rebuild_forward_refs()
