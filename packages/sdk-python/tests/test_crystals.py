"""Tests for crystals resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.resources.crystals import (
    SyncCrystalItemsResource,
    SyncCrystalVersionsResource,
    SyncCrystalHierarchyResource,
)
from engram.types.knowledge_crystal import (
    KnowledgeCrystal,
    KnowledgeCrystalEdge,
    KnowledgeCrystalSearchResult,
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
    ListKnowledgeCrystalsParams,
    SearchKnowledgeCrystalsParams,
    AddChildCrystalParams,
)
from engram.types.knowledge_crystal import (
    CrystalItem,
    CrystalMembership,
    CrystalVersion,
    AddCrystalItemParams,
    CreateCrystalVersionParams,
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
from engram.types.knowledge_crystal import (
    TrashedCrystal,
    TrashListResponse,
    ListTrashParams,
    MergeParams,
    MergeResult,
    CrystalCluster,
    IdentifyClustersParams,
)
from tests.conftest import make_api_response, SAMPLE_CRYSTAL, SAMPLE_EDGE, SAMPLE_KNOWLEDGE_CRYSTAL


SAMPLE_MEMBERSHIP = {
    "id": "mem-1",
    "crystalId": "crystal-201",
    "itemId": "ki-789",
    "position": 0,
    "addedBy": "manual",
    "addedAt": "2026-01-01T00:00:00Z",
    "deletedAt": None,
}

SAMPLE_CRYSTAL_ITEM = {
    "itemId": "ki-789",
    "itemType": "pattern",
    "title": "Test Pattern",
    "addedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_VERSION = {
    "id": "ver-1",
    "crystalId": "crystal-201",
    "version": 1,
    "changelog": "Initial version",
    "membershipSnapshot": [],
    "crystalSnapshot": {},
    "createdAt": "2026-01-01T00:00:00Z",
}


class TestSyncCrystalsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL),
            request=httpx.Request("POST", "http://test:3100/v1/crystals"),
        )

        params = CreateKnowledgeCrystalParams(title="Test Crystal", node_type="collection")
        crystal = self.client.crystals.create(params)

        assert isinstance(crystal, KnowledgeCrystal)
        assert crystal.title == "Test Crystal"
        assert crystal.node_type == "collection"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/crystal-201"),
        )

        crystal = self.client.crystals.get("crystal-201")

        assert crystal.id == "crystal-201"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/crystals/crystal-201" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_crystals(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CRYSTAL], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals"),
        )

        result = self.client.crystals.list()

        assert len(result.items) == 1
        assert result.total == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"

    @patch.object(httpx.Client, "request")
    def test_update_crystal(self, mock_request):
        updated = {**SAMPLE_CRYSTAL, "title": "Updated Crystal"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated),
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/crystal-201"),
        )

        params = UpdateKnowledgeCrystalParams(title="Updated Crystal")
        crystal = self.client.crystals.update("crystal-201", params)

        assert isinstance(crystal, KnowledgeCrystal)
        assert crystal.title == "Updated Crystal"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/crystals/crystal-201" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/crystals/crystal-201"),
        )

        self.client.crystals.delete("crystal-201")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/crystals/crystal-201" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_search_crystals(self, mock_request):
        from engram.types.knowledge_crystal import KnowledgeCrystalSearchResult
        search_result = {"item": SAMPLE_CRYSTAL, "score": 0.92}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test")
        results = self.client.crystals.search(params)

        assert len(results) == 1
        assert isinstance(results[0], KnowledgeCrystalSearchResult)
        assert results[0].score == 0.92
        assert isinstance(results[0].item, KnowledgeCrystal)
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/search" in call_args[0][1]

    # ------------------------------------------------------------------
    # Unified params — list with node_type, verified, tags
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_list_with_unified_params_single_type(self, mock_request):
        """ListKnowledgeCrystalsParams with node_type, verified, tags produces correct query string."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_KNOWLEDGE_CRYSTAL], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals"),
        )

        params = ListKnowledgeCrystalsParams(
            node_type="pattern", verified=True, tags=["test"]
        )
        result = self.client.crystals.list(params)

        assert len(result.items) == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        qs = call_args[1].get("params", {})
        assert qs.get("nodeType") == "pattern"
        assert qs.get("verified") == "true"
        assert qs.get("tags") == "test"

    @patch.object(httpx.Client, "request")
    def test_list_with_unified_params_list_of_types(self, mock_request):
        """ListKnowledgeCrystalsParams with a list of node_type values joins them."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_KNOWLEDGE_CRYSTAL], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals"),
        )

        params = ListKnowledgeCrystalsParams(
            node_type=["pattern", "learning"]
        )
        result = self.client.crystals.list(params)

        assert len(result.items) == 1
        call_args = mock_request.call_args
        qs = call_args[1].get("params", {})
        assert qs.get("nodeType") == "pattern,learning"

    @patch.object(httpx.Client, "request")
    def test_search_with_unified_params(self, mock_request):
        """SearchKnowledgeCrystalsParams body has nodeType, not crystalType."""
        search_result = {"item": SAMPLE_KNOWLEDGE_CRYSTAL, "score": 0.88}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test", node_type="pattern")
        results = self.client.crystals.search(params)

        assert len(results) == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        body = call_args[1].get("json", {})
        assert body.get("nodeType") == "pattern"
        assert "crystalType" not in body

    # ------------------------------------------------------------------
    # HIGH: Unified params for create and update
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_create_with_unified_params(self, mock_request):
        """CreateKnowledgeCrystalParams serializes with nodeType and title."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_KNOWLEDGE_CRYSTAL),
            request=httpx.Request("POST", "http://test:3100/v1/crystals"),
        )

        params = CreateKnowledgeCrystalParams(node_type="pattern", title="Test")
        crystal = self.client.crystals.create(params)

        assert isinstance(crystal, KnowledgeCrystal)
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        body = call_args[1].get("json", {})
        assert body.get("nodeType") == "pattern"
        assert body.get("title") == "Test"
        # Unified params should NOT produce deprecated keys
        assert "name" not in body
        assert "crystalType" not in body

    @patch.object(httpx.Client, "request")
    def test_update_with_unified_params(self, mock_request):
        """UpdateKnowledgeCrystalParams serializes with title in body."""
        updated = {**SAMPLE_KNOWLEDGE_CRYSTAL, "title": "Updated"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated),
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/kc-789"),
        )

        params = UpdateKnowledgeCrystalParams(title="Updated")
        crystal = self.client.crystals.update("kc-789", params)

        assert isinstance(crystal, KnowledgeCrystal)
        assert crystal.title == "Updated"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        body = call_args[1].get("json", {})
        assert body.get("title") == "Updated"
        assert "name" not in body

    # ------------------------------------------------------------------
    # MEDIUM: Search results with highlights field
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_search_results_with_highlights(self, mock_request):
        """Search results that include a highlights field are properly parsed."""
        search_result = {
            "item": SAMPLE_CRYSTAL,
            "score": 0.92,
            "highlights": {"title": ["Test"]},
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test")
        results = self.client.crystals.search(params)

        assert len(results) == 1
        assert isinstance(results[0], KnowledgeCrystalSearchResult)
        assert results[0].score == 0.92
        assert results[0].highlights == {"title": ["Test"]}


class TestSyncCrystalSubResources:
    """Test sub-resource factory methods return correct types and sub-resource operations."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    def test_items_sub_resource_type(self):
        items = self.client.crystals.items("crystal-201")
        assert isinstance(items, SyncCrystalItemsResource)

    def test_versions_sub_resource_type(self):
        versions = self.client.crystals.versions("crystal-201")
        assert isinstance(versions, SyncCrystalVersionsResource)

    def test_hierarchy_sub_resource_type(self):
        hierarchy = self.client.crystals.hierarchy("crystal-201")
        assert isinstance(hierarchy, SyncCrystalHierarchyResource)

    @patch.object(httpx.Client, "request")
    def test_items_add(self, mock_request):
        mock_request.return_value = httpx.Response(
            201,
            json=make_api_response({"added": True}),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/items"),
        )

        items = self.client.crystals.items("crystal-201")
        params = AddCrystalItemParams(item_id="ki-789")
        result = items.add(params)

        assert result == {"added": True}
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/items" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_items_list(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CRYSTAL_ITEM], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/crystal-201/items"),
        )

        items = self.client.crystals.items("crystal-201")
        result = items.list()

        assert len(result.items) == 1
        assert result.total == 1
        assert isinstance(result.items[0], CrystalItem)
        assert result.items[0].item_id == "ki-789"
        assert result.items[0].item_type == "pattern"
        assert result.items[0].title == "Test Pattern"

    @patch.object(httpx.Client, "request")
    def test_items_remove(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/crystals/crystal-201/items/ki-789"),
        )

        items = self.client.crystals.items("crystal-201")
        items.remove("ki-789")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"

    @patch.object(httpx.Client, "request")
    def test_versions_list(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_VERSION], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/crystal-201/versions"),
        )

        versions = self.client.crystals.versions("crystal-201")
        result = versions.list()

        assert len(result.items) == 1
        assert isinstance(result.items[0], CrystalVersion)

    @patch.object(httpx.Client, "request")
    def test_versions_create(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_VERSION),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/versions"),
        )

        versions = self.client.crystals.versions("crystal-201")
        params = CreateCrystalVersionParams(changelog="New version")
        version = versions.create(params)

        assert isinstance(version, CrystalVersion)
        assert version.changelog == "Initial version"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"

    # ------------------------------------------------------------------
    # MEDIUM: Hierarchy add_child returns KnowledgeCrystalEdge
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_hierarchy_add_child(self, mock_request):
        """add_child returns a KnowledgeCrystalEdge with relationship='contains'."""
        edge_data = {
            **SAMPLE_EDGE,
            "id": "edge-contains-1",
            "relationship": "contains",
            "sourceId": "crystal-201",
            "targetId": "crystal-301",
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(edge_data),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/children"),
        )

        hierarchy = self.client.crystals.hierarchy("crystal-201")
        params = AddChildCrystalParams(child_id="crystal-301")
        result = hierarchy.add_child(params)

        assert isinstance(result, KnowledgeCrystalEdge)
        assert result.relationship == "contains"
        assert result.source_id == "crystal-201"
        assert result.target_id == "crystal-301"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/children" in call_args[0][1]


# ============================================================================
# Crystal Advanced Operations (Phase 3)
# ============================================================================

SAMPLE_ACL_ENTRY = {
    "id": "acl-1",
    "crystalId": "crystal-201",
    "granteeType": "user",
    "granteeId": "user-42",
    "permission": "read",
    "grantedBy": "user-1",
    "grantedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_SHARE_LINK = {
    "id": "link-1",
    "crystalId": "crystal-201",
    "token": "abc123token",
    "permission": "read",
    "createdBy": "user-1",
    "maxUses": 10,
    "useCount": 0,
    "expiresAt": "2026-12-31T23:59:59Z",
    "createdAt": "2026-01-01T00:00:00Z",
}


class TestSyncCrystalAdvancedOps:
    """Tests for crystal advanced operations added in Phase 3."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_bulk_add(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"added": 3}),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/items/bulk"),
        )

        params = BulkAddParams(item_ids=["ki-1", "ki-2", "ki-3"])
        result = self.client.crystals.bulk_add("crystal-201", params)

        assert result["added"] == 3
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/items/bulk" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_reorder(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"success": True}),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/items/reorder"),
        )

        params = ReorderParams(item_ids=["ki-3", "ki-1", "ki-2"])
        result = self.client.crystals.reorder("crystal-201", params)

        assert result["success"] is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/items/reorder" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_acl(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_ACL_ENTRY]),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/crystal-201/acl"),
        )

        result = self.client.crystals.get_acl("crystal-201")

        assert len(result) == 1
        assert isinstance(result[0], AclEntry)
        assert result[0].grantee_id == "user-42"
        assert result[0].permission == "read"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/crystals/crystal-201/acl" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_grant_permission(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_ACL_ENTRY),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/acl"),
        )

        params = GrantPermissionParams(
            grantee_type="user",
            grantee_id="user-42",
            permission="read",
        )
        result = self.client.crystals.grant_permission("crystal-201", params)

        assert isinstance(result, AclEntry)
        assert result.grantee_id == "user-42"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/acl" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_revoke_permission(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/crystals/crystal-201/acl"),
        )

        params = RevokePermissionParams(
            grantee_type="user",
            grantee_id="user-42",
            permission="read",
        )
        self.client.crystals.revoke_permission("crystal-201", params)

        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/crystals/crystal-201/acl" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_create_share_link(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SHARE_LINK),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/share"),
        )

        params = CreateShareLinkParams(permission="read", max_uses=10)
        result = self.client.crystals.create_share_link("crystal-201", params)

        assert isinstance(result, ShareLink)
        assert result.token == "abc123token"
        assert result.max_uses == 10
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/share" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_shared(self, mock_request):
        shared_data = {"crystal": SAMPLE_CRYSTAL, "permission": "read"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(shared_data),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/share/abc123token"),
        )

        result = self.client.crystals.get_shared("abc123token")

        assert isinstance(result, SharedCrystalResult)
        assert result.crystal.id == "crystal-201"
        assert result.permission == "read"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/crystals/share/abc123token" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_share_link(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/crystals/crystal-201/share/link-1"),
        )

        self.client.crystals.delete_share_link("crystal-201", "link-1")

        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/crystals/crystal-201/share/link-1" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_fork(self, mock_request):
        forked_crystal = {**SAMPLE_CRYSTAL, "id": "crystal-202", "parentId": "crystal-201"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(forked_crystal),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/fork"),
        )

        params = ForkCrystalParams(new_owner_ids=["user-2"])
        result = self.client.crystals.fork("crystal-201", params)

        assert isinstance(result, KnowledgeCrystal)
        assert result.id == "crystal-202"
        assert result.parent_id == "crystal-201"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/fork" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_generate_embedding(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"success": True}),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/crystal-201/embedding"),
        )

        result = self.client.crystals.generate_embedding("crystal-201")

        assert result["success"] is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/crystal-201/embedding" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_bulk_add_error_response(self, mock_request):
        """4xx error on bulk_add raises appropriate error."""
        from engram.errors import NotFoundError

        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "crystal not found"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/bad-id/items/bulk"),
        )

        params = BulkAddParams(item_ids=["ki-1"])
        with pytest.raises(NotFoundError, match="crystal not found"):
            self.client.crystals.bulk_add("bad-id", params)

    @patch.object(httpx.Client, "request")
    def test_fork_error_response(self, mock_request):
        """4xx error on fork raises appropriate error."""
        from engram.errors import NotFoundError

        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "crystal not found"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/bad-id/fork"),
        )

        params = ForkCrystalParams(new_owner_ids=["user-2"])
        with pytest.raises(NotFoundError, match="crystal not found"):
            self.client.crystals.fork("bad-id", params)


# ============================================================================
# Trash Operations
# ============================================================================

SAMPLE_TRASHED_CRYSTAL = {
    "id": "crystal-301",
    "title": "Archived Crystal",
    "archivedAt": "2026-03-01T00:00:00Z",
    "daysUntilPurge": 25,
}

SAMPLE_TRASH_LIST_RESPONSE = {
    "items": [SAMPLE_TRASHED_CRYSTAL],
    "total": 1,
    "hasMore": False,
}


class TestSyncCrystalTrashOps:
    """Tests for crystal trash operations."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_list_trash(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_TRASH_LIST_RESPONSE),
            request=httpx.Request("GET", "http://test:3100/v1/knowledge/trash"),
        )

        result = self.client.crystals.list_trash()

        assert isinstance(result, TrashListResponse)
        assert len(result.items) == 1
        assert result.total == 1
        assert result.has_more is False
        assert isinstance(result.items[0], TrashedCrystal)
        assert result.items[0].id == "crystal-301"
        assert result.items[0].title == "Archived Crystal"
        assert result.items[0].days_until_purge == 25
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/knowledge/trash" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_trash_with_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_TRASH_LIST_RESPONSE),
            request=httpx.Request("GET", "http://test:3100/v1/knowledge/trash"),
        )

        params = ListTrashParams(limit=10, offset=5)
        result = self.client.crystals.list_trash(params)

        assert isinstance(result, TrashListResponse)
        call_args = mock_request.call_args
        qs = call_args[1].get("params", {})
        assert qs.get("limit") == "10"
        assert qs.get("offset") == "5"

    @patch.object(httpx.Client, "request")
    def test_restore_from_trash(self, mock_request):
        restore_data = {
            "id": "crystal-301",
            "lifecycleStatus": "active",
            "restoredAt": "2026-03-14T00:00:00Z",
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(restore_data),
            request=httpx.Request("POST", "http://test:3100/v1/knowledge/trash/crystal-301/restore"),
        )

        result = self.client.crystals.restore_from_trash("crystal-301")

        assert result["id"] == "crystal-301"
        assert result["lifecycleStatus"] == "active"
        assert result["restoredAt"] == "2026-03-14T00:00:00Z"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/knowledge/trash/crystal-301/restore" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_from_trash(self, mock_request):
        delete_data = {"id": "crystal-301", "deleted": True}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(delete_data),
            request=httpx.Request("DELETE", "http://test:3100/v1/knowledge/trash/crystal-301"),
        )

        result = self.client.crystals.delete_from_trash("crystal-301")

        assert result["id"] == "crystal-301"
        assert result["deleted"] is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/knowledge/trash/crystal-301" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_empty_trash(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"deletedCount": 5}),
            request=httpx.Request("DELETE", "http://test:3100/v1/knowledge/trash"),
        )

        result = self.client.crystals.empty_trash()

        assert result["deletedCount"] == 5
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/knowledge/trash" in call_args[0][1]


# ============================================================================
# Merge Operations
# ============================================================================

SAMPLE_MERGE_RESULT = {
    "success": True,
    "mergedCrystalId": "crystal-merged-1",
    "mergedTitle": "Combined Crystal",
    "supersededIds": ["crystal-201", "crystal-202"],
    "edgesRedirected": 4,
    "dryRun": False,
}


class TestSyncCrystalMergeOps:
    """Tests for crystal merge operations."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_merge(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_MERGE_RESULT),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/merge"),
        )

        params = MergeParams(
            crystal_ids=["crystal-201", "crystal-202"],
            merged_title="Combined Crystal",
        )
        result = self.client.crystals.merge(params)

        assert isinstance(result, MergeResult)
        assert result.success is True
        assert result.merged_crystal_id == "crystal-merged-1"
        assert result.merged_title == "Combined Crystal"
        assert result.superseded_ids == ["crystal-201", "crystal-202"]
        assert result.edges_redirected == 4
        assert result.dry_run is False
        assert result.error is None
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/merge" in call_args[0][1]
        body = call_args[1].get("json", {})
        assert body.get("crystalIds") == ["crystal-201", "crystal-202"]
        assert body.get("mergedTitle") == "Combined Crystal"

    @patch.object(httpx.Client, "request")
    def test_merge_dry_run(self, mock_request):
        dry_run_result = {
            "success": True,
            "mergedCrystalId": None,
            "mergedTitle": "Preview Merge",
            "supersededIds": ["crystal-201", "crystal-202"],
            "edgesRedirected": 3,
            "dryRun": True,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(dry_run_result),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/merge"),
        )

        params = MergeParams(
            crystal_ids=["crystal-201", "crystal-202"],
            dry_run=True,
        )
        result = self.client.crystals.merge(params)

        assert isinstance(result, MergeResult)
        assert result.dry_run is True
        assert result.merged_crystal_id is None
        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert body.get("dryRun") is True

    @patch.object(httpx.Client, "request")
    def test_merge_error_result(self, mock_request):
        error_result = {
            "success": False,
            "dryRun": False,
            "error": "Cannot merge crystals from different projects",
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(error_result),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/merge"),
        )

        params = MergeParams(crystal_ids=["crystal-201", "crystal-202"])
        result = self.client.crystals.merge(params)

        assert isinstance(result, MergeResult)
        assert result.success is False
        assert result.error == "Cannot merge crystals from different projects"


# ============================================================================
# Cluster Operations
# ============================================================================

SAMPLE_CLUSTER = {
    "representativeId": "crystal-201",
    "memberIds": ["crystal-201", "crystal-202", "crystal-203"],
    "clusterScore": 0.87,
    "internalEdgeCount": 3,
    "size": 3,
}


class TestSyncCrystalClusterOps:
    """Tests for crystal cluster operations."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_identify_clusters(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CLUSTER]),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/clusters"),
        )

        result = self.client.crystals.identify_clusters()

        assert len(result) == 1
        assert isinstance(result[0], CrystalCluster)
        assert result[0].representative_id == "crystal-201"
        assert result[0].member_ids == ["crystal-201", "crystal-202", "crystal-203"]
        assert result[0].cluster_score == 0.87
        assert result[0].internal_edge_count == 3
        assert result[0].size == 3
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/crystals/clusters" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_identify_clusters_with_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CLUSTER]),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/clusters"),
        )

        params = IdentifyClustersParams(
            min_similarity=0.8,
            limit=5,
            session_id="sess-123",
        )
        result = self.client.crystals.identify_clusters(params)

        assert len(result) == 1
        call_args = mock_request.call_args
        qs = call_args[1].get("params", {})
        assert qs.get("minSimilarity") == "0.8"
        assert qs.get("limit") == "5"
        assert qs.get("sessionId") == "sess-123"

    @patch.object(httpx.Client, "request")
    def test_identify_clusters_empty(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([]),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/clusters"),
        )

        result = self.client.crystals.identify_clusters()

        assert result == []


# ============================================================================
# Search Result Ranking Fields
# ============================================================================


class TestSearchResultRankingFields:
    """Tests for ranking fields on search results."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_search_results_with_ranking_fields(self, mock_request):
        search_result = {
            "item": SAMPLE_CRYSTAL,
            "score": 0.92,
            "vectorRank": 1,
            "bm25Rank": 3,
            "graphRank": 2,
            "rrfScore": 0.88,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test")
        results = self.client.crystals.search(params)

        assert len(results) == 1
        assert isinstance(results[0], KnowledgeCrystalSearchResult)
        assert results[0].vector_rank == 1
        assert results[0].bm25_rank == 3
        assert results[0].graph_rank == 2
        assert results[0].rrf_score == 0.88

    @patch.object(httpx.Client, "request")
    def test_search_results_without_ranking_fields(self, mock_request):
        """Ranking fields default to None when not present in response."""
        search_result = {"item": SAMPLE_CRYSTAL, "score": 0.92}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test")
        results = self.client.crystals.search(params)

        assert len(results) == 1
        assert results[0].vector_rank is None
        assert results[0].bm25_rank is None
        assert results[0].graph_rank is None
        assert results[0].rrf_score is None


# ============================================================================
# Graph Expansion Search Parameter
# ============================================================================


class TestGraphExpansionSearchParam:
    """Tests for graph_expansion search parameter."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_search_with_graph_expansion(self, mock_request):
        search_result = {"item": SAMPLE_CRYSTAL, "score": 0.92}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="test", graph_expansion=True
        )
        self.client.crystals.search(params)

        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert body.get("graphExpansion") is True

    @patch.object(httpx.Client, "request")
    def test_search_without_graph_expansion(self, mock_request):
        """graph_expansion is omitted from body when None."""
        search_result = {"item": SAMPLE_CRYSTAL, "score": 0.92}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="test")
        self.client.crystals.search(params)

        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert "graphExpansion" not in body
