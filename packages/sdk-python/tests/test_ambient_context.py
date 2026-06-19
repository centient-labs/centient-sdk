"""Tests for the ambient-context resource.

Mirrors the TS resource-test pattern: assert request path/method/query params
and response parsing. The route returns the standard enveloped body shape
``{ data: { ambientCrystals: [...] } }`` and the resource unwraps to a plain
list of crystals.

The client does not (yet) expose an ``ambient_context`` attribute, so these
tests instantiate the resource directly with the client — matching the wire
contract is what's under test.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.resources.ambient_context import (
    AmbientContextResource,
    SyncAmbientContextResource,
)
from engram.types.ambient_context import AmbientCrystal, GetAmbientContextParams


SAMPLE_AMBIENT_CRYSTAL = {
    "id": "kc-1",
    "title": "Auth Pattern",
    "description": "JWT-based auth",
    "nodeType": "pattern",
    "tags": ["auth", "security"],
    "relevanceScore": 0.87,
}

SAMPLE_AMBIENT_CRYSTAL_NULL_DESC = {
    "id": "kc-2",
    "title": "Untitled",
    "description": None,
    "nodeType": "collection",
    "tags": [],
    "relevanceScore": 0.42,
}

ENVELOPE = {"data": {"ambientCrystals": [SAMPLE_AMBIENT_CRYSTAL, SAMPLE_AMBIENT_CRYSTAL_NULL_DESC]}}


class TestSyncAmbientContextResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncAmbientContextResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_get_parses_enveloped_list(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=ENVELOPE,
            request=httpx.Request("GET", "http://test:3100/v1/ambient-context"),
        )

        result = self.resource.get(GetAmbientContextParams(session_id="sess-123"))

        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(c, AmbientCrystal) for c in result)
        first = result[0]
        assert first.id == "kc-1"
        assert first.title == "Auth Pattern"
        assert first.description == "JWT-based auth"
        assert first.node_type == "pattern"
        assert first.tags == ["auth", "security"]
        assert first.relevance_score == 0.87
        assert result[1].description is None

        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/ambient-context"
        assert call_args[1]["params"] == {"sessionId": "sess-123"}

    @patch.object(httpx.Client, "request")
    def test_get_sends_role_and_limit_query_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"ambientCrystals": []}},
            request=httpx.Request("GET", "http://test:3100/v1/ambient-context"),
        )

        self.resource.get(
            GetAmbientContextParams(session_id="sess-9", role="architect", limit=5)
        )

        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/ambient-context"
        assert call_args[1]["params"] == {
            "sessionId": "sess-9",
            "role": "architect",
            "limit": "5",
        }

    @patch.object(httpx.Client, "request")
    def test_get_omits_unset_optionals(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"ambientCrystals": []}},
            request=httpx.Request("GET", "http://test:3100/v1/ambient-context"),
        )

        result = self.resource.get(GetAmbientContextParams(session_id="sess-x"))

        assert result == []
        # role/limit not provided -> only sessionId is sent.
        assert mock_request.call_args[1]["params"] == {"sessionId": "sess-x"}


class TestAsyncAmbientContextResource:
    @pytest.mark.asyncio
    async def test_async_get_parses_enveloped_list(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = AmbientContextResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=ENVELOPE,
                        request=httpx.Request("GET", "http://test:3100/v1/ambient-context"),
                    )

                mock_request.side_effect = _resp
                result = await resource.get(
                    GetAmbientContextParams(session_id="sess-123", role="reviewer")
                )

                assert len(result) == 2
                assert isinstance(result[0], AmbientCrystal)
                assert result[0].relevance_score == 0.87
                call_args = mock_request.call_args
                assert call_args[0][0] == "GET"
                assert call_args[0][1] == "/v1/ambient-context"
                assert call_args[1]["params"] == {
                    "sessionId": "sess-123",
                    "role": "reviewer",
                }
        finally:
            await client.close()
