"""Tests for the facts resource.

Mirrors the TS resource-test pattern: assert request path/method/body/query and
response unwrapping. Single-object facts come back in the standard ``{ data }``
envelope; history is a paginated list with ``meta.pagination``.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.resources.facts import FactsResource, SyncFactsResource
from engram.types.common import PaginatedResult
from engram.types.facts import (
    CreateFactParams,
    Fact,
    FactHistoryParams,
    UpdateFactParams,
)

SAMPLE_FACT = {
    "id": "fact-123",
    "key": "user.preferences.theme",
    "value": {"mode": "dark"},
    "validFrom": "2026-01-01T00:00:00Z",
    "validTo": None,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_FACT_V2 = {
    **SAMPLE_FACT,
    "value": {"mode": "light"},
    "validFrom": "2026-02-01T00:00:00Z",
}


def _envelope(data, total=None, has_more=False):
    resp = {"data": data}
    if total is not None:
        resp["meta"] = {
            "pagination": {
                "total": total,
                "limit": 20,
                "offset": 0,
                "hasMore": has_more,
            }
        }
    return resp


class TestSyncFactsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        # The client does not (yet) expose a ``.facts`` accessor; construct the
        # resource directly so these tests pin the wire contract regardless.
        self.facts = SyncFactsResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("POST", "http://test:3100/v1/facts"),
        )

        result = self.facts.create(
            CreateFactParams(key="user.preferences.theme", value={"mode": "dark"})
        )

        assert isinstance(result, Fact)
        assert result.id == "fact-123"
        assert result.key == "user.preferences.theme"
        assert result.value == {"mode": "dark"}
        assert result.valid_to is None
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/facts"
        assert call_args[1]["json"] == {
            "key": "user.preferences.theme",
            "value": {"mode": "dark"},
        }

    @patch.object(httpx.Client, "request")
    def test_create_with_valid_at(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("POST", "http://test:3100/v1/facts"),
        )

        self.facts.create(
            CreateFactParams(
                key="k", value={"a": 1}, valid_at="2026-01-01T00:00:00Z"
            )
        )

        assert mock_request.call_args[1]["json"] == {
            "key": "k",
            "value": {"a": 1},
            "validAt": "2026-01-01T00:00:00Z",
        }

    @patch.object(httpx.Client, "request")
    def test_get(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("GET", "http://test:3100/v1/facts/fact-123"),
        )

        result = self.facts.get("fact-123")

        assert isinstance(result, Fact)
        assert result.id == "fact-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/facts/fact-123"
        # No asOf -> no query params sent.
        assert "params" not in call_args[1] or call_args[1]["params"] is None

    @patch.object(httpx.Client, "request")
    def test_get_with_as_of(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("GET", "http://test:3100/v1/facts/fact-123"),
        )

        self.facts.get("fact-123", as_of="2025-01-15T00:00:00Z")

        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/facts/fact-123"
        assert call_args[1]["params"] == {"asOf": "2025-01-15T00:00:00Z"}

    @patch.object(httpx.Client, "request")
    def test_get_url_encodes_id(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("GET", "http://test:3100/v1/facts/a%2Fb"),
        )

        self.facts.get("a/b")

        assert mock_request.call_args[0][1] == "/v1/facts/a%2Fb"

    @patch.object(httpx.Client, "request")
    def test_get_by_key(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT),
            request=httpx.Request("GET", "http://test:3100/v1/facts"),
        )

        result = self.facts.get_by_key("user.preferences.theme")

        assert isinstance(result, Fact)
        assert result.key == "user.preferences.theme"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/facts"
        assert call_args[1]["params"] == {"key": "user.preferences.theme"}

    @patch.object(httpx.Client, "request")
    def test_update(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope(SAMPLE_FACT_V2),
            request=httpx.Request("PATCH", "http://test:3100/v1/facts/fact-123"),
        )

        result = self.facts.update(
            "fact-123", UpdateFactParams(value={"mode": "light"})
        )

        assert isinstance(result, Fact)
        assert result.value == {"mode": "light"}
        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert call_args[0][1] == "/v1/facts/fact-123"
        assert call_args[1]["json"] == {"value": {"mode": "light"}}

    @patch.object(httpx.Client, "request")
    def test_get_history(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope([SAMPLE_FACT, SAMPLE_FACT_V2], total=2, has_more=False),
            request=httpx.Request(
                "GET", "http://test:3100/v1/facts/fact-123/history"
            ),
        )

        result = self.facts.get_history("fact-123")

        assert isinstance(result, PaginatedResult)
        assert len(result.items) == 2
        assert all(isinstance(f, Fact) for f in result.items)
        assert result.total == 2
        assert result.has_more is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/facts/fact-123/history"
        assert "params" not in call_args[1] or call_args[1]["params"] is None

    @patch.object(httpx.Client, "request")
    def test_get_history_with_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=_envelope([SAMPLE_FACT], total=5, has_more=True),
            request=httpx.Request(
                "GET", "http://test:3100/v1/facts/fact-123/history"
            ),
        )

        result = self.facts.get_history(
            "fact-123",
            FactHistoryParams(
                valid_from="2026-01-01T00:00:00Z",
                valid_to="2026-03-01T00:00:00Z",
                limit=10,
                offset=2,
            ),
        )

        assert result.total == 5
        assert result.has_more is True
        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/facts/fact-123/history"
        assert call_args[1]["params"] == {
            "validFrom": "2026-01-01T00:00:00Z",
            "validTo": "2026-03-01T00:00:00Z",
            "limit": "10",
            "offset": "2",
        }


class TestAsyncFactsResource:
    @pytest.mark.asyncio
    async def test_async_create(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        facts = FactsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=_envelope(SAMPLE_FACT),
                        request=httpx.Request("POST", "http://test:3100/v1/facts"),
                    )

                mock_request.side_effect = _resp
                result = await facts.create(
                    CreateFactParams(key="k", value={"mode": "dark"})
                )
                assert isinstance(result, Fact)
                assert result.id == "fact-123"
                call_args = mock_request.call_args
                assert call_args[0][0] == "POST"
                assert call_args[0][1] == "/v1/facts"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get_with_as_of(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        facts = FactsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=_envelope(SAMPLE_FACT),
                        request=httpx.Request(
                            "GET", "http://test:3100/v1/facts/fact-123"
                        ),
                    )

                mock_request.side_effect = _resp
                result = await facts.get(
                    "fact-123", as_of="2025-01-15T00:00:00Z"
                )
                assert isinstance(result, Fact)
                call_args = mock_request.call_args
                assert call_args[0][1] == "/v1/facts/fact-123"
                assert call_args[1]["params"] == {"asOf": "2025-01-15T00:00:00Z"}
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get_history(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        facts = FactsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=_envelope(
                            [SAMPLE_FACT, SAMPLE_FACT_V2], total=2, has_more=False
                        ),
                        request=httpx.Request(
                            "GET", "http://test:3100/v1/facts/fact-123/history"
                        ),
                    )

                mock_request.side_effect = _resp
                result = await facts.get_history("fact-123")
                assert isinstance(result, PaginatedResult)
                assert len(result.items) == 2
                assert result.total == 2
                call_args = mock_request.call_args
                assert call_args[0][1] == "/v1/facts/fact-123/history"
        finally:
            await client.close()
