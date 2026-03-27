"""Tests for knowledge crystal operations via client.crystals resource.

These tests cover the knowledge-centric operations (promote, get_edges,
get_versions, create_version, get_related, generate_embedding) that were
previously on the deprecated client.knowledge namespace. They now use
client.crystals which is the unified resource.
"""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.types.knowledge_crystal import (
    KnowledgeCrystal,
    KnowledgeCrystalEdge,
    KnowledgeCrystalSearchResult,
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
    SearchKnowledgeCrystalsParams,
    PromoteParams,
    PromoteResult,
    CreateVersionParams,
    GetRelatedParams,
)
from tests.conftest import make_api_response, SAMPLE_KNOWLEDGE_CRYSTAL, SAMPLE_EDGE, SAMPLE_CRYSTAL


class TestSyncCrystalsKnowledgeOps:
    """Tests for knowledge operations via the unified crystals resource."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_knowledge_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_KNOWLEDGE_CRYSTAL),
            request=httpx.Request("POST", "http://test:3100/v1/crystals"),
        )

        params = CreateKnowledgeCrystalParams(node_type="pattern", title="Auth Pattern")
        item = self.client.crystals.create(params)

        assert isinstance(item, KnowledgeCrystal)
        assert item.title == "Auth Pattern"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_KNOWLEDGE_CRYSTAL),
            request=httpx.Request("GET", "http://test:3100/v1/crystals/kc-789"),
        )

        item = self.client.crystals.get("kc-789")

        assert item.id == "kc-789"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/crystals/kc-789" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_crystals(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_KNOWLEDGE_CRYSTAL], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/crystals"),
        )

        result = self.client.crystals.list()

        assert len(result.items) == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"

    @patch.object(httpx.Client, "request")
    def test_search_crystals(self, mock_request):
        search_result = {"item": SAMPLE_KNOWLEDGE_CRYSTAL, "score": 0.95, "highlights": {}}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        results = self.client.crystals.search(SearchKnowledgeCrystalsParams(query="auth"))

        assert len(results) == 1
        assert isinstance(results[0], KnowledgeCrystalSearchResult)
        assert isinstance(results[0].item, KnowledgeCrystal)
        assert results[0].score == 0.95
        assert results[0].highlights == {}
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/search" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_update_crystal(self, mock_request):
        updated = {**SAMPLE_KNOWLEDGE_CRYSTAL, "title": "Updated Auth Pattern"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated),
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/kc-789"),
        )

        params = UpdateKnowledgeCrystalParams(title="Updated Auth Pattern")
        item = self.client.crystals.update("kc-789", params)

        assert isinstance(item, KnowledgeCrystal)
        assert item.title == "Updated Auth Pattern"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/crystals/kc-789" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_crystal(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/crystals/kc-789"),
        )

        self.client.crystals.delete("kc-789")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/crystals/kc-789" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_search_with_highlights(self, mock_request):
        """Search results with populated highlights field are correctly parsed."""
        search_result = {
            "item": SAMPLE_KNOWLEDGE_CRYSTAL,
            "score": 0.92,
            "highlights": {"title": ["Auth Pattern"]},
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([search_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        results = self.client.crystals.search(SearchKnowledgeCrystalsParams(query="auth"))

        assert len(results) == 1
        assert isinstance(results[0], KnowledgeCrystalSearchResult)
        assert results[0].score == 0.92
        assert results[0].highlights == {"title": ["Auth Pattern"]}
