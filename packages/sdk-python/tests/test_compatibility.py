"""Tests for server-version compatibility checking.

Mirrors ``EngramClient.checkCompatibility`` in packages/sdk/src/client.ts: the
method calls ``/health``, reads ``version``, and reports compatibility against
``MIN_SERVER_VERSION`` (0.31.0). Like the TS SDK it returns a result object
rather than raising — a below-floor server reports ``compatible=False`` so the
caller decides how to react (P11: surface the uncertainty, do not hide it).
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import MIN_SERVER_VERSION, AsyncEngramClient, EngramClient, _is_version_gte


class TestIsVersionGte:
    def test_equal_versions(self):
        assert _is_version_gte("0.31.0", "0.31.0") is True

    def test_above_floor(self):
        assert _is_version_gte("0.34.0", "0.31.0") is True
        assert _is_version_gte("1.0.0", "0.31.0") is True

    def test_below_floor(self):
        assert _is_version_gte("0.30.9", "0.31.0") is False
        assert _is_version_gte("0.30.0", "0.31.0") is False

    def test_unparseable_fails_closed(self):
        assert _is_version_gte("unknown", "0.31.0") is False
        assert _is_version_gte("", "0.31.0") is False

    def test_prerelease_and_build_metadata_fail_closed(self):
        # Pre-release / build-metadata suffixes (common in dev builds) are not
        # plain ``major.minor.patch`` integers, so the parser cannot order them.
        # We fail closed (treat as incompatible) rather than guess — matching the
        # TS SDK, which only parses the numeric triple.
        assert _is_version_gte("0.31.0-alpha", "0.31.0") is False
        assert _is_version_gte("0.34.0-rc.1", "0.31.0") is False
        assert _is_version_gte("0.31.0+build123", "0.31.0") is False
        assert _is_version_gte("0.31.x", "0.31.0") is False

    def test_unparseable_segment_logs_warning(self, caplog):
        import logging

        with caplog.at_level(logging.WARNING, logger="engram"):
            assert _is_version_gte("0.31.0-alpha", "0.31.0") is False
        # The format issue must surface in logs, not be silently swallowed.
        assert any(
            "unparseable version segment" in rec.message for rec in caplog.records
        )


class TestSyncCheckServerCompatibility:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_compatible_server(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"version": "0.34.0", "status": "ok"},
            request=httpx.Request("GET", "http://test:3100/health"),
        )

        result = self.client.check_server_compatibility()

        assert result["compatible"] is True
        assert result["server_version"] == "0.34.0"
        assert result["min_required"] == MIN_SERVER_VERSION
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/health"

    @patch.object(httpx.Client, "request")
    def test_below_floor_server_is_incompatible(self, mock_request):
        # The acceptance bar: a /health below 0.31.0 must report incompatible.
        mock_request.return_value = httpx.Response(
            200,
            json={"version": "0.30.0", "status": "ok"},
            request=httpx.Request("GET", "http://test:3100/health"),
        )

        result = self.client.check_server_compatibility()

        assert result["compatible"] is False
        assert result["server_version"] == "0.30.0"

    @patch.object(httpx.Client, "request")
    def test_missing_version_is_incompatible(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"status": "ok"},
            request=httpx.Request("GET", "http://test:3100/health"),
        )

        result = self.client.check_server_compatibility()

        assert result["compatible"] is False
        assert result["server_version"] == "unknown"


class TestAsyncCheckServerCompatibility:
    @pytest.mark.asyncio
    async def test_async_below_floor_incompatible(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json={"version": "0.30.0"},
                        request=httpx.Request("GET", "http://test:3100/health"),
                    )

                mock_request.side_effect = _resp
                result = await client.check_server_compatibility()
                assert result["compatible"] is False
                assert result["server_version"] == "0.30.0"
                call_args = mock_request.call_args
                assert call_args[0][1] == "/health"
        finally:
            await client.close()
