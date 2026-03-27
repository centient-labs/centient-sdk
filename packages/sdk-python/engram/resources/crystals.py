"""Crystal resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, List, Optional, Union, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.reranking import (
    RerankRequest,
    RerankResponse,
    CrystalSearchWithRerankingResult,
)
from engram.types.knowledge_crystal import (
    KnowledgeCrystal,
    KnowledgeCrystalSearchResult,
    KnowledgeCrystalEdge,
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
    ListKnowledgeCrystalsParams,
    SearchKnowledgeCrystalsParams,
    # Crystal sub-resource types
    CrystalItem,
    CrystalMembership,
    CrystalVersion,
    AddCrystalItemParams,
    ListCrystalItemsParams,
    CreateCrystalVersionParams,
    ListCrystalVersionsParams,
    # Hierarchy types
    CrystalHierarchy,
    ScopedSearchResult,
    AddChildCrystalParams,
    ListHierarchyParams,
    ScopedSearchParams,
    # Trash types
    TrashedCrystal,
    TrashListResponse,
    ListTrashParams,
    # Merge types
    MergeParams,
    MergeResult,
    # Cluster types
    CrystalCluster,
    IdentifyClustersParams,
)
from engram.types.crystals import (
    AclEntry,
    BulkAddParams,
    CreateShareLinkParams,
    ForkCrystalParams,
    GrantPermissionParams,
    ReorderParams,
    RevokePermissionParams,
    ShareLink,
    SharedCrystalResult,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


# ============================================================================
# Crystal Items (scoped to crystal_id)
# ============================================================================


class CrystalItemsResource(BaseResource):
    """Async resource for crystal items, scoped to a specific crystal."""

    def __init__(self, client: AsyncEngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    async def add(self, params: AddCrystalItemParams) -> dict[str, bool]:
        """Add an item to this crystal.

        Returns ``{"added": True}`` on success (201 if newly created, 200 if
        the item was already present).
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items",
            body,
        )
        return response["data"]

    async def list(
        self, params: Optional[ListCrystalItemsParams] = None
    ) -> PaginatedResult[CrystalItem]:
        """List items in this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items",
            params=qs if qs else None,
        )
        return self._parse_list(response, CrystalItem)

    async def remove(self, item_id: str) -> None:
        """Remove an item from this crystal."""
        await self._request(
            "DELETE",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items/{quote(item_id, safe='')}",
        )


class SyncCrystalItemsResource(SyncBaseResource):
    """Sync resource for crystal items, scoped to a specific crystal."""

    def __init__(self, client: EngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    def add(self, params: AddCrystalItemParams) -> dict[str, bool]:
        """Add an item to this crystal.

        Returns ``{"added": True}`` on success (201 if newly created, 200 if
        the item was already present).
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items",
            body,
        )
        return response["data"]

    def list(
        self, params: Optional[ListCrystalItemsParams] = None
    ) -> PaginatedResult[CrystalItem]:
        """List items in this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items",
            params=qs if qs else None,
        )
        return self._parse_list(response, CrystalItem)

    def remove(self, item_id: str) -> None:
        """Remove an item from this crystal."""
        self._request(
            "DELETE",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/items/{quote(item_id, safe='')}",
        )


# ============================================================================
# Crystal Versions (scoped to crystal_id)
# ============================================================================


class CrystalVersionsResource(BaseResource):
    """Async resource for crystal versions, scoped to a specific crystal."""

    def __init__(self, client: AsyncEngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    async def list(
        self, params: Optional[ListCrystalVersionsParams] = None
    ) -> PaginatedResult[CrystalVersion]:
        """List versions of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions",
            params=qs if qs else None,
        )
        return self._parse_list(response, CrystalVersion)

    async def get(self, version: int) -> CrystalVersion:
        """Get a specific version of this crystal."""
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions/{version}",
        )
        return CrystalVersion.model_validate(response["data"])

    async def create(
        self, params: CreateCrystalVersionParams
    ) -> CrystalVersion:
        """Create a new version of this crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions",
            body,
        )
        return CrystalVersion.model_validate(response["data"])


class SyncCrystalVersionsResource(SyncBaseResource):
    """Sync resource for crystal versions, scoped to a specific crystal."""

    def __init__(self, client: EngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    def list(
        self, params: Optional[ListCrystalVersionsParams] = None
    ) -> PaginatedResult[CrystalVersion]:
        """List versions of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions",
            params=qs if qs else None,
        )
        return self._parse_list(response, CrystalVersion)

    def get(self, version: int) -> CrystalVersion:
        """Get a specific version of this crystal."""
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions/{version}",
        )
        return CrystalVersion.model_validate(response["data"])

    def create(
        self, params: CreateCrystalVersionParams
    ) -> CrystalVersion:
        """Create a new version of this crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/versions",
            body,
        )
        return CrystalVersion.model_validate(response["data"])


# ============================================================================
# Crystal Hierarchy (scoped to crystal_id)
# ============================================================================


class CrystalHierarchyResource(BaseResource):
    """Async resource for crystal hierarchy, scoped to a specific crystal."""

    def __init__(self, client: AsyncEngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    async def add_child(
        self, params: AddChildCrystalParams
    ) -> KnowledgeCrystalEdge:
        """Add a child crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children",
            body,
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    async def remove_child(self, child_id: str) -> None:
        """Remove a child crystal."""
        await self._request(
            "DELETE",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children/{quote(child_id, safe='')}",
        )

    async def get_children(
        self, params: Optional[ListHierarchyParams] = None
    ) -> dict[str, Any]:
        """Get children of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.recursive is not None:
                qs["recursive"] = str(params.recursive).lower()
            if params.max_depth is not None:
                qs["maxDepth"] = str(params.max_depth)
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children",
            params=qs if qs else None,
        )
        data = response.get("data", [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return {
            "children": data,
            "total": pagination.get("total", len(data)),
            "has_more": pagination.get("hasMore", False),
        }

    async def get_parents(
        self, params: Optional[ListHierarchyParams] = None
    ) -> dict[str, Any]:
        """Get parents of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.recursive is not None:
                qs["recursive"] = str(params.recursive).lower()
            if params.max_depth is not None:
                qs["maxDepth"] = str(params.max_depth)
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/parents",
            params=qs if qs else None,
        )
        data = response.get("data", [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return {
            "parents": data,
            "total": pagination.get("total", len(data)),
            "has_more": pagination.get("hasMore", False),
        }

    async def get_hierarchy(
        self, max_depth: Optional[int] = None
    ) -> CrystalHierarchy:
        """Get full hierarchy tree."""
        qs: dict[str, str] = {}
        if max_depth is not None:
            qs["maxDepth"] = str(max_depth)
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/hierarchy",
            params=qs if qs else None,
        )
        return CrystalHierarchy.model_validate(response["data"])

    async def get_crystal_scope(self) -> list[str]:
        """Get the scope of crystal IDs in this hierarchy."""
        response = await self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/scope",
        )
        return response["data"]

    async def search_in_scope(
        self, params: ScopedSearchParams
    ) -> list[ScopedSearchResult]:
        """Search within the scope of this crystal hierarchy."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/scope/search",
            body,
        )
        return [
            ScopedSearchResult.model_validate(r) for r in response["data"]
        ]


class SyncCrystalHierarchyResource(SyncBaseResource):
    """Sync resource for crystal hierarchy, scoped to a specific crystal."""

    def __init__(self, client: EngramClient, crystal_id: str) -> None:
        super().__init__(client)
        self._crystal_id = crystal_id

    def add_child(self, params: AddChildCrystalParams) -> KnowledgeCrystalEdge:
        """Add a child crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children",
            body,
        )
        return KnowledgeCrystalEdge.model_validate(response["data"])

    def remove_child(self, child_id: str) -> None:
        """Remove a child crystal."""
        self._request(
            "DELETE",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children/{quote(child_id, safe='')}",
        )

    def get_children(
        self, params: Optional[ListHierarchyParams] = None
    ) -> dict[str, Any]:
        """Get children of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.recursive is not None:
                qs["recursive"] = str(params.recursive).lower()
            if params.max_depth is not None:
                qs["maxDepth"] = str(params.max_depth)
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/children",
            params=qs if qs else None,
        )
        data = response.get("data", [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return {
            "children": data,
            "total": pagination.get("total", len(data)),
            "has_more": pagination.get("hasMore", False),
        }

    def get_parents(
        self, params: Optional[ListHierarchyParams] = None
    ) -> dict[str, Any]:
        """Get parents of this crystal."""
        qs: dict[str, str] = {}
        if params:
            if params.recursive is not None:
                qs["recursive"] = str(params.recursive).lower()
            if params.max_depth is not None:
                qs["maxDepth"] = str(params.max_depth)
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/parents",
            params=qs if qs else None,
        )
        data = response.get("data", [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return {
            "parents": data,
            "total": pagination.get("total", len(data)),
            "has_more": pagination.get("hasMore", False),
        }

    def get_hierarchy(
        self, max_depth: Optional[int] = None
    ) -> CrystalHierarchy:
        """Get full hierarchy tree."""
        qs: dict[str, str] = {}
        if max_depth is not None:
            qs["maxDepth"] = str(max_depth)
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/hierarchy",
            params=qs if qs else None,
        )
        return CrystalHierarchy.model_validate(response["data"])

    def get_crystal_scope(self) -> list[str]:
        """Get the scope of crystal IDs in this hierarchy."""
        response = self._request(
            "GET",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/scope",
        )
        return response["data"]

    def search_in_scope(
        self, params: ScopedSearchParams
    ) -> list[ScopedSearchResult]:
        """Search within the scope of this crystal hierarchy."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(self._crystal_id, safe='')}/scope/search",
            body,
        )
        return [
            ScopedSearchResult.model_validate(r) for r in response["data"]
        ]


# ============================================================================
# Crystals (top-level resource)
# ============================================================================


def _build_list_crystals_qs(params: ListKnowledgeCrystalsParams) -> dict[str, str]:
    """Build query string for list crystals."""
    qs: dict[str, str] = {}
    if params.node_type is not None:
        if isinstance(params.node_type, list):
            qs["nodeType"] = ",".join(params.node_type)
        else:
            qs["nodeType"] = params.node_type
    if params.verified is not None:
        qs["verified"] = str(params.verified).lower()
    if params.visibility:
        qs["visibility"] = params.visibility
    if params.tags:
        qs["tags"] = ",".join(params.tags)
    if params.source_project:
        qs["sourceProject"] = params.source_project
    if params.owner_ids:
        qs["ownerIds"] = params.owner_ids
    if params.limit is not None:
        qs["limit"] = str(params.limit)
    if params.offset is not None:
        qs["offset"] = str(params.offset)
    return qs


class CrystalsResource(BaseResource):
    """Async resource for crystals."""

    async def create(
        self, params: CreateKnowledgeCrystalParams
    ) -> KnowledgeCrystal:
        """Create a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/crystals", body)
        return KnowledgeCrystal.model_validate(response["data"])

    async def get(self, id: str) -> KnowledgeCrystal:
        """Get a crystal by ID."""
        response = await self._request(
            "GET", f"/v1/crystals/{quote(id, safe='')}"
        )
        return KnowledgeCrystal.model_validate(response["data"])

    async def list(
        self,
        params: Optional[ListKnowledgeCrystalsParams] = None,
    ) -> PaginatedResult[KnowledgeCrystal]:
        """List crystals."""
        qs: dict[str, str] = {}
        if params:
            qs = _build_list_crystals_qs(params)
        response = await self._request("GET", "/v1/crystals", params=qs if qs else None)
        return self._parse_list(response, KnowledgeCrystal)

    async def update(
        self,
        id: str,
        params: UpdateKnowledgeCrystalParams,
    ) -> KnowledgeCrystal:
        """Update a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH", f"/v1/crystals/{quote(id, safe='')}", body
        )
        return KnowledgeCrystal.model_validate(response["data"])

    async def delete(self, id: str) -> None:
        """Delete a crystal."""
        await self._request(
            "DELETE", f"/v1/crystals/{quote(id, safe='')}"
        )

    async def search(
        self,
        params: SearchKnowledgeCrystalsParams,
    ) -> Union[list[KnowledgeCrystalSearchResult], CrystalSearchWithRerankingResult]:
        """Search crystals.

        When ``params.reranking.enabled`` is ``True``, the server fetches a
        larger candidate pool and re-scores using a cross-encoder model (or
        heuristic fallback). The response shape changes to
        :class:`CrystalSearchWithRerankingResult`.

        Example::

            # Standard search
            results = await client.crystals.search(
                SearchKnowledgeCrystalsParams(query="auth patterns")
            )

            # Search with reranking
            from engram.types.reranking import RerankingConfig
            result = await client.crystals.search(
                SearchKnowledgeCrystalsParams(
                    query="auth patterns",
                    limit=5,
                    reranking=RerankingConfig(enabled=True, candidate_multiplier=3),
                )
            )
            assert isinstance(result, CrystalSearchWithRerankingResult)
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/crystals/search", body)
        data = response["data"]
        # When reranking is enabled the server returns { results, reranking, ... }
        if isinstance(data, dict) and "reranking" in data:
            return CrystalSearchWithRerankingResult.model_validate(data)
        return [
            KnowledgeCrystalSearchResult.model_validate(r)
            for r in data
        ]

    async def rerank(self, request: RerankRequest) -> RerankResponse:
        """Rerank pre-fetched candidates using a cross-encoder model or heuristic scoring.

        Use this when you have already retrieved candidates from a prior search or
        external source and want to improve precision by reranking.

        Example::

            from engram.types.reranking import RerankCandidate, RerankRequest
            result = await client.crystals.rerank(
                RerankRequest(
                    query="authentication patterns",
                    candidates=[
                        RerankCandidate(id="abc", content="...", retrieval_score=0.85),
                        RerankCandidate(id="def", content="...", retrieval_score=0.78),
                    ],
                    limit=5,
                )
            )
            print(f"Reranked with {result.reranking.model} in {result.reranking.latency_ms}ms")
        """
        body = request.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/crystals/rerank", body)
        return RerankResponse.model_validate(response["data"])

    async def bulk_add(
        self, id: str, params: BulkAddParams
    ) -> dict[str, int]:
        """Bulk add items to a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/items/bulk",
            body,
        )
        return response["data"]

    async def reorder(
        self, id: str, params: ReorderParams
    ) -> dict[str, bool]:
        """Reorder items in a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/items/reorder",
            body,
        )
        return response["data"]

    async def get_acl(self, id: str) -> list[AclEntry]:
        """Get the access control list for a crystal."""
        response = await self._request(
            "GET", f"/v1/crystals/{quote(id, safe='')}/acl"
        )
        return [AclEntry.model_validate(e) for e in response["data"]]

    async def grant_permission(
        self, id: str, params: GrantPermissionParams
    ) -> AclEntry:
        """Grant permission on a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/acl",
            body,
        )
        return AclEntry.model_validate(response["data"])

    async def revoke_permission(
        self, id: str, params: RevokePermissionParams
    ) -> None:
        """Revoke permission on a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        await self._request(
            "DELETE",
            f"/v1/crystals/{quote(id, safe='')}/acl",
            body,
        )

    async def create_share_link(
        self, id: str, params: CreateShareLinkParams
    ) -> ShareLink:
        """Create a share link for a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/share",
            body,
        )
        return ShareLink.model_validate(response["data"])

    async def get_shared(self, token: str) -> SharedCrystalResult:
        """Get a crystal via a share link token.

        This method is not scoped to a crystal ID -- it resolves the
        crystal from the share token.
        """
        response = await self._request(
            "GET",
            f"/v1/crystals/share/{quote(token, safe='')}",
        )
        return SharedCrystalResult.model_validate(response["data"])

    async def delete_share_link(self, id: str, link_id: str) -> None:
        """Delete a share link for a crystal."""
        await self._request(
            "DELETE",
            f"/v1/crystals/{quote(id, safe='')}/share/{quote(link_id, safe='')}",
        )

    async def fork(
        self, id: str, params: ForkCrystalParams
    ) -> KnowledgeCrystal:
        """Fork a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/fork",
            body,
        )
        return KnowledgeCrystal.model_validate(response["data"])

    async def generate_embedding(self, id: str) -> dict[str, bool]:
        """Generate or regenerate embedding for a crystal."""
        response = await self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/embedding",
        )
        return response["data"]

    # ------------------------------------------------------------------
    # Trash operations
    # ------------------------------------------------------------------

    async def list_trash(
        self, params: Optional[ListTrashParams] = None
    ) -> TrashListResponse:
        """List crystals in the trash."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            "/v1/knowledge/trash",
            params=qs if qs else None,
        )
        return TrashListResponse.model_validate(response["data"])

    async def restore_from_trash(self, crystal_id: str) -> dict[str, Any]:
        """Restore a crystal from the trash.

        Returns a dict with ``id``, ``lifecycleStatus``, and ``restoredAt``.
        """
        response = await self._request(
            "POST",
            f"/v1/knowledge/trash/{quote(crystal_id, safe='')}/restore",
        )
        return response["data"]

    async def delete_from_trash(self, crystal_id: str) -> dict[str, Any]:
        """Permanently delete a crystal from the trash.

        Returns a dict with ``id`` and ``deleted``.
        """
        response = await self._request(
            "DELETE",
            f"/v1/knowledge/trash/{quote(crystal_id, safe='')}",
        )
        return response["data"]

    async def empty_trash(self) -> dict[str, int]:
        """Permanently delete all crystals in the trash.

        Returns a dict with ``deletedCount``.
        """
        response = await self._request("DELETE", "/v1/knowledge/trash")
        return response["data"]

    # ------------------------------------------------------------------
    # Merge operations
    # ------------------------------------------------------------------

    async def merge(self, params: MergeParams) -> MergeResult:
        """Merge multiple crystals into one.

        When ``params.dry_run`` is ``True``, the merge is simulated without
        making changes.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/crystals/merge", body)
        return MergeResult.model_validate(response["data"])

    # ------------------------------------------------------------------
    # Cluster operations
    # ------------------------------------------------------------------

    async def identify_clusters(
        self, params: Optional[IdentifyClustersParams] = None
    ) -> list[CrystalCluster]:
        """Identify clusters of similar crystals."""
        qs: dict[str, str] = {}
        if params:
            if params.min_similarity is not None:
                qs["minSimilarity"] = str(params.min_similarity)
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.session_id is not None:
                qs["sessionId"] = params.session_id
        response = await self._request(
            "GET",
            "/v1/crystals/clusters",
            params=qs if qs else None,
        )
        return [
            CrystalCluster.model_validate(c) for c in response["data"]
        ]

    def items(self, crystal_id: str) -> CrystalItemsResource:
        """Get an items sub-resource scoped to the given crystal."""
        return CrystalItemsResource(self._client, crystal_id)

    def versions(self, crystal_id: str) -> CrystalVersionsResource:
        """Get a versions sub-resource scoped to the given crystal."""
        return CrystalVersionsResource(self._client, crystal_id)

    def hierarchy(self, crystal_id: str) -> CrystalHierarchyResource:
        """Get a hierarchy sub-resource scoped to the given crystal."""
        return CrystalHierarchyResource(self._client, crystal_id)


class SyncCrystalsResource(SyncBaseResource):
    """Sync resource for crystals."""

    def create(
        self, params: CreateKnowledgeCrystalParams
    ) -> KnowledgeCrystal:
        """Create a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/crystals", body)
        return KnowledgeCrystal.model_validate(response["data"])

    def get(self, id: str) -> KnowledgeCrystal:
        """Get a crystal by ID."""
        response = self._request(
            "GET", f"/v1/crystals/{quote(id, safe='')}"
        )
        return KnowledgeCrystal.model_validate(response["data"])

    def list(
        self,
        params: Optional[ListKnowledgeCrystalsParams] = None,
    ) -> PaginatedResult[KnowledgeCrystal]:
        """List crystals."""
        qs: dict[str, str] = {}
        if params:
            qs = _build_list_crystals_qs(params)
        response = self._request("GET", "/v1/crystals", params=qs if qs else None)
        return self._parse_list(response, KnowledgeCrystal)

    def update(
        self,
        id: str,
        params: UpdateKnowledgeCrystalParams,
    ) -> KnowledgeCrystal:
        """Update a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH", f"/v1/crystals/{quote(id, safe='')}", body
        )
        return KnowledgeCrystal.model_validate(response["data"])

    def delete(self, id: str) -> None:
        """Delete a crystal."""
        self._request("DELETE", f"/v1/crystals/{quote(id, safe='')}")

    def search(
        self,
        params: SearchKnowledgeCrystalsParams,
    ) -> Union[list[KnowledgeCrystalSearchResult], CrystalSearchWithRerankingResult]:
        """Search crystals.

        When ``params.reranking.enabled`` is ``True``, the server fetches a
        larger candidate pool and re-scores using a cross-encoder model (or
        heuristic fallback). The response shape changes to
        :class:`CrystalSearchWithRerankingResult`.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/crystals/search", body)
        data = response["data"]
        if isinstance(data, dict) and "reranking" in data:
            return CrystalSearchWithRerankingResult.model_validate(data)
        return [
            KnowledgeCrystalSearchResult.model_validate(r)
            for r in data
        ]

    def rerank(self, request: RerankRequest) -> RerankResponse:
        """Rerank pre-fetched candidates using a cross-encoder model or heuristic scoring.

        Use this when you have already retrieved candidates from a prior search or
        external source and want to improve precision by reranking.

        Example::

            from engram.types.reranking import RerankCandidate, RerankRequest
            result = client.crystals.rerank(
                RerankRequest(
                    query="authentication patterns",
                    candidates=[
                        RerankCandidate(id="abc", content="...", retrieval_score=0.85),
                    ],
                    limit=5,
                )
            )
        """
        body = request.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/crystals/rerank", body)
        return RerankResponse.model_validate(response["data"])

    def bulk_add(
        self, id: str, params: BulkAddParams
    ) -> dict[str, int]:
        """Bulk add items to a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/items/bulk",
            body,
        )
        return response["data"]

    def reorder(
        self, id: str, params: ReorderParams
    ) -> dict[str, bool]:
        """Reorder items in a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/items/reorder",
            body,
        )
        return response["data"]

    def get_acl(self, id: str) -> list[AclEntry]:
        """Get the access control list for a crystal."""
        response = self._request(
            "GET", f"/v1/crystals/{quote(id, safe='')}/acl"
        )
        return [AclEntry.model_validate(e) for e in response["data"]]

    def grant_permission(
        self, id: str, params: GrantPermissionParams
    ) -> AclEntry:
        """Grant permission on a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/acl",
            body,
        )
        return AclEntry.model_validate(response["data"])

    def revoke_permission(
        self, id: str, params: RevokePermissionParams
    ) -> None:
        """Revoke permission on a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        self._request(
            "DELETE",
            f"/v1/crystals/{quote(id, safe='')}/acl",
            body,
        )

    def create_share_link(
        self, id: str, params: CreateShareLinkParams
    ) -> ShareLink:
        """Create a share link for a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/share",
            body,
        )
        return ShareLink.model_validate(response["data"])

    def get_shared(self, token: str) -> SharedCrystalResult:
        """Get a crystal via a share link token.

        This method is not scoped to a crystal ID -- it resolves the
        crystal from the share token.
        """
        response = self._request(
            "GET",
            f"/v1/crystals/share/{quote(token, safe='')}",
        )
        return SharedCrystalResult.model_validate(response["data"])

    def delete_share_link(self, id: str, link_id: str) -> None:
        """Delete a share link for a crystal."""
        self._request(
            "DELETE",
            f"/v1/crystals/{quote(id, safe='')}/share/{quote(link_id, safe='')}",
        )

    def fork(self, id: str, params: ForkCrystalParams) -> KnowledgeCrystal:
        """Fork a crystal."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/fork",
            body,
        )
        return KnowledgeCrystal.model_validate(response["data"])

    def generate_embedding(self, id: str) -> dict[str, bool]:
        """Generate or regenerate embedding for a crystal."""
        response = self._request(
            "POST",
            f"/v1/crystals/{quote(id, safe='')}/embedding",
        )
        return response["data"]

    # ------------------------------------------------------------------
    # Trash operations
    # ------------------------------------------------------------------

    def list_trash(
        self, params: Optional[ListTrashParams] = None
    ) -> TrashListResponse:
        """List crystals in the trash."""
        qs: dict[str, str] = {}
        if params:
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            "/v1/knowledge/trash",
            params=qs if qs else None,
        )
        return TrashListResponse.model_validate(response["data"])

    def restore_from_trash(self, crystal_id: str) -> dict[str, Any]:
        """Restore a crystal from the trash.

        Returns a dict with ``id``, ``lifecycleStatus``, and ``restoredAt``.
        """
        response = self._request(
            "POST",
            f"/v1/knowledge/trash/{quote(crystal_id, safe='')}/restore",
        )
        return response["data"]

    def delete_from_trash(self, crystal_id: str) -> dict[str, Any]:
        """Permanently delete a crystal from the trash.

        Returns a dict with ``id`` and ``deleted``.
        """
        response = self._request(
            "DELETE",
            f"/v1/knowledge/trash/{quote(crystal_id, safe='')}",
        )
        return response["data"]

    def empty_trash(self) -> dict[str, int]:
        """Permanently delete all crystals in the trash.

        Returns a dict with ``deletedCount``.
        """
        response = self._request("DELETE", "/v1/knowledge/trash")
        return response["data"]

    # ------------------------------------------------------------------
    # Merge operations
    # ------------------------------------------------------------------

    def merge(self, params: MergeParams) -> MergeResult:
        """Merge multiple crystals into one.

        When ``params.dry_run`` is ``True``, the merge is simulated without
        making changes.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/crystals/merge", body)
        return MergeResult.model_validate(response["data"])

    # ------------------------------------------------------------------
    # Cluster operations
    # ------------------------------------------------------------------

    def identify_clusters(
        self, params: Optional[IdentifyClustersParams] = None
    ) -> list[CrystalCluster]:
        """Identify clusters of similar crystals."""
        qs: dict[str, str] = {}
        if params:
            if params.min_similarity is not None:
                qs["minSimilarity"] = str(params.min_similarity)
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.session_id is not None:
                qs["sessionId"] = params.session_id
        response = self._request(
            "GET",
            "/v1/crystals/clusters",
            params=qs if qs else None,
        )
        return [
            CrystalCluster.model_validate(c) for c in response["data"]
        ]

    def items(self, crystal_id: str) -> SyncCrystalItemsResource:
        """Get an items sub-resource scoped to the given crystal."""
        return SyncCrystalItemsResource(self._client, crystal_id)

    def versions(self, crystal_id: str) -> SyncCrystalVersionsResource:
        """Get a versions sub-resource scoped to the given crystal."""
        return SyncCrystalVersionsResource(self._client, crystal_id)

    def hierarchy(self, crystal_id: str) -> SyncCrystalHierarchyResource:
        """Get a hierarchy sub-resource scoped to the given crystal."""
        return SyncCrystalHierarchyResource(self._client, crystal_id)
