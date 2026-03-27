"""Unified Knowledge Crystal types for the Engram SDK.

Merges the former ``KnowledgeItem`` and ``Crystal`` types into a single
unified node type backed by the ``knowledge_crystals`` table.

Related ADRs:
    ADR-055: Unified Knowledge Crystal Model
    ADR-057: Knowledge Crystal Application Layer Restructuring (Phase C)
    ADR-059: Knowledge Crystal Edge Unification
"""
from __future__ import annotations

from typing import Any, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    # Enums / Union types
    "NodeType",
    "NodeVisibility",
    "EmbeddingStatus",
    "MembershipAddedBy",
    "KnowledgeCrystalEdgeRelationship",
    "SourceType",
    "ContentNodeType",
    # Core entities
    "ContentRef",
    "KnowledgeCrystal",
    # Search result
    "KnowledgeCrystalSearchResult",
    # CRUD params
    "CreateKnowledgeCrystalParams",
    "UpdateKnowledgeCrystalParams",
    "ListKnowledgeCrystalsParams",
    "SearchKnowledgeCrystalsParams",
    # Edge types
    "KnowledgeCrystalEdge",
    "CreateKnowledgeCrystalEdgeParams",
    "UpdateKnowledgeCrystalEdgeParams",
    "ListKnowledgeCrystalEdgesParams",
    # Crystal sub-resource types (retained from crystals.py)
    "CrystalMembership",
    "CrystalItem",
    "CrystalVersion",
    "AddCrystalItemParams",
    "ListCrystalItemsParams",
    "CreateCrystalVersionParams",
    "ListCrystalVersionsParams",
    # Hierarchy types (retained from crystals.py)
    "ContainedCrystal",
    "ParentCrystal",
    "CrystalHierarchy",
    "ScopedSearchResult",
    "AddChildCrystalParams",
    "ListHierarchyParams",
    "ScopedSearchParams",
    # Promotion types (retained from knowledge.py)
    "PromoteParams",
    "PromoteResult",
    "PromotionSummary",
    "CreateVersionParams",
    "GetRelatedParams",
    # Trash types
    "TrashedCrystal",
    "TrashListResponse",
    "ListTrashParams",
    # Merge types
    "MergeParams",
    "MergeResult",
    # Cluster types
    "CrystalCluster",
    "IdentifyClustersParams",
]

# ============================================================================
# Enums / Union Types
# ============================================================================

# Unified node type — 12 values replacing KnowledgeItemType (6) + CrystalType (4)
# plus Terrafirma types (ADR-049).
#
# Content types (formerly KnowledgeItemType):
#   "pattern"     - Reusable code or design pattern
#   "learning"    - Insight or lesson learned during development
#   "decision"    - Architectural or implementation decision
#   "note"        - General-purpose note or observation
#   "finding"     - Discovery or investigation result
#   "constraint"  - Technical or business constraint
#
# Container types (formerly CrystalType):
#   "collection"       - Manually curated collection of knowledge items
#   "session_artifact" - Automatically created when a session is finalized
#   "project"          - Project-level grouping
#   "domain"           - Domain or topic-level grouping
#
# Terrafirma types (ADR-049):
#   "file_ref"    - Reference to a file in the filesystem
#   "directory"   - Reference to a directory in the filesystem
NodeType = Literal[
    "pattern",
    "learning",
    "decision",
    "note",
    "finding",
    "constraint",
    "collection",
    "session_artifact",
    "project",
    "domain",
    "file_ref",
    "directory",
]

# Visibility level for a knowledge crystal node.
# Replaces the former CrystalVisibility.
#   "private" - Only visible to the owner
#   "shared"  - Visible to specific collaborators
#   "public"  - Visible to everyone
NodeVisibility = Literal["private", "shared", "public"]

# Status of a node's embedding vector.
#   "pending"    - Embedding has not yet been generated
#   "processing" - Embedding generation is currently in progress
#   "synced"     - Embedding is up to date with the node's content
#   "failed"     - Embedding generation failed
#   "stale"      - Content has changed since the last embedding was generated
EmbeddingStatus = Literal["pending", "processing", "synced", "failed", "stale"]

# How an item was added to a container crystal.
#   "promotion"    - Promoted from session scratch content
#   "manual"       - Manually added by a user
#   "import"       - Imported from an external source
#   "finalization" - Automatically added during session finalization
MembershipAddedBy = Literal["promotion", "manual", "import", "finalization"]

# Unified relationship type for all knowledge crystal edges.
# Merges the former EdgeRelationship (knowledge items) and
# CrystalEdgeRelationship (crystal hierarchy).
#   "contains"     - Hierarchy: parent contains child (formerly crystal only)
#   "derived_from" - Versioning, extraction, refinement
#   "related_to"   - Semantic connection
#   "contradicts"  - Tension or conflict
#   "implements"   - Implements a pattern or decision
#   "depends_on"   - Requires another node
KnowledgeCrystalEdgeRelationship = Literal[
    "contains",
    "derived_from",
    "related_to",
    "contradicts",
    "implements",
    "depends_on",
]

# Named type alias for the source_type field on KnowledgeCrystal and
# CreateKnowledgeCrystalParams.  Extracted to avoid duplicating the literal
# values in multiple class definitions.
SourceType = Literal["session", "manual", "import", "promotion", "finalization", "extraction"]

# Named type alias for the content-bearing node types (the 6 types that were
# formerly KnowledgeItemType).  Used by PromoteParams.type.
ContentNodeType = Literal[
    "pattern", "learning", "decision", "note", "finding", "constraint"
]


# ============================================================================
# Supporting Types
# ============================================================================


class ContentRef(BaseModel):
    """Reference to content storage location."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    type: Literal["inline", "blob", "git", "url"]
    uri: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    checksum: Optional[str] = None


# ============================================================================
# Core Entity
# ============================================================================


class KnowledgeCrystal(BaseModel):
    """Unified knowledge crystal node — the single node type in the knowledge graph.

    Merges the former KnowledgeItem and Crystal types (ADR-055).
    The ``node_type`` field determines which fields are semantically relevant.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    slug: Optional[str] = None
    node_type: NodeType = Field(alias="nodeType")
    title: str
    summary: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    content_ref: Optional[ContentRef] = Field(None, alias="contentRef")
    content_inline: Optional[str] = Field(None, alias="contentInline")
    embedding_status: EmbeddingStatus = Field(alias="embeddingStatus")
    embedding_updated_at: Optional[str] = Field(None, alias="embeddingUpdatedAt")
    confidence: Optional[float] = None
    verified: bool
    visibility: NodeVisibility
    license: Optional[str] = None
    owner_ids: list[str] = Field(default_factory=list, alias="ownerIds")
    version: int
    fork_count: int = Field(alias="forkCount")
    star_count: int = Field(alias="starCount")
    item_count: int = Field(alias="itemCount")
    version_count: int = Field(alias="versionCount")
    parent_id: Optional[str] = Field(None, alias="parentId")
    parent_version: Optional[int] = Field(None, alias="parentVersion")
    source_type: Optional[SourceType] = Field(None, alias="sourceType")
    source_session_id: Optional[str] = Field(None, alias="sourceSessionId")
    source_project: Optional[str] = Field(None, alias="sourceProject")
    type_metadata: dict[str, Any] = Field(default_factory=dict, alias="typeMetadata")
    path: Optional[str] = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# ============================================================================
# Search Result
# ============================================================================


class KnowledgeCrystalSearchResult(BaseModel):
    """Knowledge crystal search result with score and highlights."""

    model_config = ConfigDict(populate_by_name=True)

    item: KnowledgeCrystal
    score: float
    highlights: Optional[dict[str, list[str]]] = None
    vector_rank: Optional[int] = Field(None, alias="vectorRank")
    bm25_rank: Optional[int] = Field(None, alias="bm25Rank")
    graph_rank: Optional[int] = Field(None, alias="graphRank")
    rrf_score: Optional[float] = Field(None, alias="rrfScore")


# ============================================================================
# CRUD Parameters
# ============================================================================


class CreateKnowledgeCrystalParams(BaseModel):
    """Parameters for creating a knowledge crystal node."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    node_type: NodeType
    title: str
    summary: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    slug: Optional[str] = None
    content_inline: Optional[str] = None
    confidence: Optional[float] = None
    verified: Optional[bool] = None
    visibility: Optional[NodeVisibility] = None
    license: Optional[str] = None
    owner_ids: Optional[list[str]] = None
    type_metadata: Optional[dict[str, Any]] = None
    source_type: Optional[SourceType] = None
    source_session_id: Optional[str] = None
    source_project: Optional[str] = None
    path: Optional[str] = None


class UpdateKnowledgeCrystalParams(BaseModel):
    """Parameters for updating a knowledge crystal node."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    title: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    tags: Optional[list[str]] = None
    content_inline: Optional[str] = None
    confidence: Optional[float] = None
    verified: Optional[bool] = None
    visibility: Optional[NodeVisibility] = None
    license: Optional[str] = None
    node_type: Optional[NodeType] = None
    type_metadata: Optional[dict[str, Any]] = None
    source_session_id: Optional[str] = None
    source_project: Optional[str] = None
    version: Optional[int] = None
    path: Optional[str] = None


class ListKnowledgeCrystalsParams(BaseModel):
    """Parameters for listing knowledge crystal nodes."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    node_type: Optional[Union[NodeType, list[NodeType]]] = None
    visibility: Optional[NodeVisibility] = None
    tags: Optional[list[str]] = None
    verified: Optional[bool] = None
    source_project: Optional[str] = None
    # Intentionally str (not list[str]) — this is a query-string parameter
    # that accepts a comma-separated list of owner IDs for URL encoding,
    # unlike the entity's owner_ids which is list[str].
    owner_ids: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class SearchKnowledgeCrystalsParams(BaseModel):
    """Parameters for searching knowledge crystal nodes.

    When ``reranking.enabled`` is ``True``, the server fetches a larger
    candidate pool (``limit * candidate_multiplier``) and re-scores results
    using a cross-encoder model or heuristic fallback.
    The response will be a :class:`CrystalSearchWithRerankingResult` instead
    of a plain list of :class:`KnowledgeCrystalSearchResult`.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    query: str
    node_type: Optional[Union[NodeType, list[NodeType]]] = None
    visibility: Optional[NodeVisibility] = None
    tags: Optional[list[str]] = None
    verified: Optional[bool] = None
    mode: Optional[Literal["semantic", "keyword", "hybrid"]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
    threshold: Optional[float] = None
    graph_expansion: Optional[bool] = None
    reranking: Optional[Any] = None
    """Reranking configuration (``RerankingConfig``). Uses ``Any`` to avoid circular import."""


# ============================================================================
# Edge Types
# ============================================================================


class KnowledgeCrystalEdge(BaseModel):
    """Unified edge connecting two knowledge crystal nodes.

    Replaces both KnowledgeEdge and CrystalEdge.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    source_id: str = Field(alias="sourceId")
    target_id: str = Field(alias="targetId")
    relationship: KnowledgeCrystalEdgeRelationship
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    created_by: Optional[str] = Field(None, alias="createdBy")


class CreateKnowledgeCrystalEdgeParams(BaseModel):
    """Parameters for creating an edge between two knowledge crystal nodes."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    source_id: str
    target_id: str
    relationship: KnowledgeCrystalEdgeRelationship
    metadata: Optional[dict[str, Any]] = None


class UpdateKnowledgeCrystalEdgeParams(BaseModel):
    """Parameters for updating a knowledge crystal edge."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    metadata: Optional[dict[str, Any]] = None


class ListKnowledgeCrystalEdgesParams(BaseModel):
    """Parameters for listing knowledge crystal edges."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    source_id: Optional[str] = None
    target_id: Optional[str] = None
    relationship: Optional[KnowledgeCrystalEdgeRelationship] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Crystal Sub-Resource Types (retained — used by CrystalItemsResource)
# ============================================================================


class CrystalMembership(BaseModel):
    """Raw membership row linking an item to a container crystal."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    crystal_id: str = Field(alias="crystalId")
    item_id: str = Field(alias="itemId")
    position: Optional[int] = None
    added_by: MembershipAddedBy = Field(alias="addedBy")
    added_at: str = Field(alias="addedAt")
    deleted_at: Optional[str] = Field(None, alias="deletedAt")


class CrystalItem(BaseModel):
    """Item within a container crystal as returned by the list items endpoint."""

    model_config = ConfigDict(populate_by_name=True)

    item_id: str = Field(alias="itemId")
    # Corresponds to the node_type of the referenced knowledge crystal
    item_type: str = Field(alias="itemType")
    title: str
    added_at: str = Field(alias="addedAt")


class CrystalVersion(BaseModel):
    """A snapshot of a crystal node at a specific version."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    crystal_id: str = Field(alias="crystalId")
    version: int
    changelog: str
    membership_snapshot: list[CrystalMembership] = Field(alias="membershipSnapshot")
    crystal_snapshot: dict[str, Any] = Field(alias="crystalSnapshot")
    created_at: str = Field(alias="createdAt")


class AddCrystalItemParams(BaseModel):
    """Parameters for adding an item to a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    item_id: str
    position: Optional[int] = None
    added_by: Optional[MembershipAddedBy] = None


class ListCrystalItemsParams(BaseModel):
    """Parameters for listing items in a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    limit: Optional[int] = None
    offset: Optional[int] = None


class CreateCrystalVersionParams(BaseModel):
    """Parameters for creating a new crystal version."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    changelog: Optional[str] = None


class ListCrystalVersionsParams(BaseModel):
    """Parameters for listing crystal versions."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Hierarchy Types (retained — ADR-031)
# ============================================================================


class ContainedCrystal(BaseModel):
    """A crystal contained within another crystal (downward traversal)."""

    model_config = ConfigDict(populate_by_name=True)

    crystal_id: str = Field(alias="crystalId")
    depth: int
    path: list[str]


class ParentCrystal(BaseModel):
    """A parent crystal (upward traversal)."""

    model_config = ConfigDict(populate_by_name=True)

    crystal_id: str = Field(alias="crystalId")
    depth: int
    path: list[str]


class CrystalHierarchy(BaseModel):
    """Recursive tree structure for crystal hierarchy."""

    model_config = ConfigDict(populate_by_name=True)

    crystal_id: str = Field(alias="crystalId")
    children: list[CrystalHierarchy]
    depth: int


# Rebuild to resolve the recursive forward reference
CrystalHierarchy.model_rebuild()


class ScopedSearchResult(BaseModel):
    """Scoped search result item within a crystal hierarchy."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: str
    title: str
    content_inline: Optional[str] = Field(None, alias="contentInline")
    summary: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    similarity: float
    created_at: str = Field(alias="createdAt")


class AddChildCrystalParams(BaseModel):
    """Parameters for adding a child crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    child_id: str


class ListHierarchyParams(BaseModel):
    """Parameters for listing children or parents."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    recursive: Optional[bool] = None
    max_depth: Optional[int] = None


class ScopedSearchParams(BaseModel):
    """Parameters for scoped search within a crystal hierarchy."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    query: str
    limit: Optional[int] = None
    offset: Optional[int] = None
    include_contained: Optional[bool] = None
    threshold: Optional[float] = None
    mode: Optional[Literal["semantic", "keyword", "hybrid"]] = None


# ============================================================================
# Promotion Types (retained from knowledge.py)
# ============================================================================


class PromoteParams(BaseModel):
    """Parameters for promoting scratch content to a knowledge crystal node."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    session_id: str
    scratch_id: str
    type: ContentNodeType
    title: str
    summary: Optional[str] = None
    tags: Optional[list[str]] = None
    confidence: Optional[float] = None
    type_metadata: Optional[dict[str, Any]] = None


class PromoteResult(BaseModel):
    """Result of promoting scratch content to a knowledge crystal node."""

    model_config = ConfigDict(populate_by_name=True)

    item: KnowledgeCrystal
    embedding_queued: bool = Field(alias="embeddingQueued")
    scratch_deleted: bool = Field(alias="scratchDeleted")


class PromotionSummary(BaseModel):
    """Summary of a promotion operation result."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    promoted_count: int
    skipped_count: int
    error_count: int


class CreateVersionParams(BaseModel):
    """Parameters for creating a new version of a knowledge item."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    title: Optional[str] = None
    summary: Optional[str] = None
    content_inline: Optional[str] = None
    pattern_version: Optional[str] = None


class GetRelatedParams(BaseModel):
    """Parameters for getting related knowledge items."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    depth: Optional[int] = None
    # Note: "contains" is accepted by the type system (via the unified
    # KnowledgeCrystalEdgeRelationship) but may not be supported by the
    # knowledge-item-centric /v1/knowledge/:id/related endpoint.
    relationship: Optional[KnowledgeCrystalEdgeRelationship] = None


# ============================================================================
# Trash Types
# ============================================================================


class TrashedCrystal(BaseModel):
    """A crystal that has been soft-deleted (archived) and is in the trash."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    archived_at: str = Field(alias="archivedAt")
    days_until_purge: int = Field(alias="daysUntilPurge")


class TrashListResponse(BaseModel):
    """Response from listing trashed crystals."""

    model_config = ConfigDict(populate_by_name=True)

    items: List[TrashedCrystal]
    total: int
    has_more: bool = Field(alias="hasMore")


class ListTrashParams(BaseModel):
    """Parameters for listing trashed crystals."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Merge Types
# ============================================================================


class MergeParams(BaseModel):
    """Parameters for merging multiple crystals."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    crystal_ids: List[str]
    dry_run: Optional[bool] = None
    merged_title: Optional[str] = None


class MergeResult(BaseModel):
    """Result of a crystal merge operation."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool
    merged_crystal_id: Optional[str] = Field(None, alias="mergedCrystalId")
    merged_title: Optional[str] = Field(None, alias="mergedTitle")
    superseded_ids: Optional[List[str]] = Field(None, alias="supersededIds")
    edges_redirected: Optional[int] = Field(None, alias="edgesRedirected")
    dry_run: bool = Field(alias="dryRun")
    error: Optional[str] = None


# ============================================================================
# Cluster Types
# ============================================================================


class CrystalCluster(BaseModel):
    """A cluster of similar crystals identified by the clustering algorithm."""

    model_config = ConfigDict(populate_by_name=True)

    representative_id: str = Field(alias="representativeId")
    member_ids: List[str] = Field(alias="memberIds")
    cluster_score: float = Field(alias="clusterScore")
    internal_edge_count: int = Field(alias="internalEdgeCount")
    size: int


class IdentifyClustersParams(BaseModel):
    """Parameters for identifying crystal clusters."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    min_similarity: Optional[float] = None
    limit: Optional[int] = None
    session_id: Optional[str] = None
