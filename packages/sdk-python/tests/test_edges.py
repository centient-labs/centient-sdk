"""Tests for edges resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.types.knowledge_crystal import (
    KnowledgeCrystalEdge,
    CreateKnowledgeCrystalEdgeParams,
    UpdateKnowledgeCrystalEdgeParams,
)
from tests.conftest import make_api_response, SAMPLE_EDGE, SAMPLE_EDGE_WITH_AUTHOR


class TestSyncEdgesResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_edge(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_EDGE),
            request=httpx.Request("POST", "http://test:3100/v1/edges"),
        )

        params = CreateKnowledgeCrystalEdgeParams(
            source_id="kc-789",
            target_id="kc-790",
            relationship="related_to",
        )
        edge = self.client.edges.create(params)

        assert isinstance(edge, KnowledgeCrystalEdge)
        assert edge.source_id == "kc-789"
        assert edge.created_by is None
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/edges" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_edge(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_EDGE),
            request=httpx.Request("GET", "http://test:3100/v1/edges/edge-101"),
        )

        edge = self.client.edges.get("edge-101")

        assert isinstance(edge, KnowledgeCrystalEdge)
        assert edge.id == "edge-101"
        assert edge.relationship == "related_to"
        assert edge.created_by is None
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/edges/edge-101" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_edges(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_EDGE], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/edges"),
        )

        result = self.client.edges.list()

        assert len(result.items) == 1
        assert result.total == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"

    @patch.object(httpx.Client, "request")
    def test_update_edge(self, mock_request):
        updated_edge = {**SAMPLE_EDGE, "metadata": {"weight": 0.8}}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated_edge),
            request=httpx.Request("PATCH", "http://test:3100/v1/edges/edge-101"),
        )

        params = UpdateKnowledgeCrystalEdgeParams(metadata={"weight": 0.8})
        edge = self.client.edges.update("edge-101", params)

        assert isinstance(edge, KnowledgeCrystalEdge)
        assert edge.metadata == {"weight": 0.8}
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert "/v1/edges/edge-101" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_edge(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/edges/edge-101"),
        )

        self.client.edges.delete("edge-101")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/edges/edge-101" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_all_relationship_types(self, mock_request):
        """All 6 relationship types are valid for KnowledgeCrystalEdge."""
        relationships = [
            "contains", "derived_from", "related_to",
            "contradicts", "implements", "depends_on",
        ]
        for rel in relationships:
            edge_data = {
                **SAMPLE_EDGE,
                "id": f"edge-{rel}",
                "relationship": rel,
            }
            mock_request.return_value = httpx.Response(
                200,
                json=make_api_response(edge_data),
                request=httpx.Request("GET", f"http://test:3100/v1/edges/edge-{rel}"),
            )
            edge = self.client.edges.get(f"edge-{rel}")
            assert edge.relationship == rel

    # ------------------------------------------------------------------
    # Create edge with unified CreateKnowledgeCrystalEdgeParams
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_create_edge_with_contains(self, mock_request):
        """CreateKnowledgeCrystalEdgeParams supports 'contains' relationship."""
        contains_edge = {
            **SAMPLE_EDGE,
            "id": "edge-contains-1",
            "sourceId": "kc-1",
            "targetId": "kc-2",
            "relationship": "contains",
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(contains_edge),
            request=httpx.Request("POST", "http://test:3100/v1/edges"),
        )

        params = CreateKnowledgeCrystalEdgeParams(
            source_id="kc-1",
            target_id="kc-2",
            relationship="contains",
        )
        edge = self.client.edges.create(params)

        assert isinstance(edge, KnowledgeCrystalEdge)
        assert edge.source_id == "kc-1"
        assert edge.target_id == "kc-2"
        assert edge.relationship == "contains"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/edges" in call_args[0][1]
        body = call_args[1].get("json", {})
        assert body.get("sourceId") == "kc-1"
        assert body.get("targetId") == "kc-2"
        assert body.get("relationship") == "contains"

    # ------------------------------------------------------------------
    # Edge with non-null created_by
    # ------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_edge_with_created_by(self, mock_request):
        """Edge with a non-null createdBy field is deserialized correctly."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_EDGE_WITH_AUTHOR),
            request=httpx.Request("GET", "http://test:3100/v1/edges/edge-101"),
        )

        edge = self.client.edges.get("edge-101")

        assert isinstance(edge, KnowledgeCrystalEdge)
        assert edge.created_by == "agent-1"
