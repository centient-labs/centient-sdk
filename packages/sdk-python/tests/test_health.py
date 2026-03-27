"""Tests for health methods on the client."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import EngramClient


class TestSyncHealth:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_health_ready(self, mock_request):
        """health_ready() sends GET to /health/ready (not /v1/health/ready)."""
        mock_request.return_value = httpx.Response(
            200,
            json={"status": "ready"},
            request=httpx.Request("GET", "http://test:3100/health/ready"),
        )

        result = self.client.health_ready()

        assert result["status"] == "ready"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        # Must be /health/ready, NOT /v1/health/ready
        assert call_args[0][1] == "/health/ready"

    @patch.object(httpx.Client, "request")
    def test_health_detailed(self, mock_request):
        """health_detailed() sends GET to /health/detailed (not /v1/health/detailed)."""
        mock_request.return_value = httpx.Response(
            200,
            json={
                "status": "healthy",
                "uptime": 3600,
                "dependencies": {
                    "database": {"status": "up", "latencyMs": 2},
                    "embeddings": {"status": "up", "latencyMs": 15},
                },
            },
            request=httpx.Request("GET", "http://test:3100/health/detailed"),
        )

        result = self.client.health_detailed()

        assert result["status"] == "healthy"
        assert result["uptime"] == 3600
        assert result["dependencies"]["database"]["status"] == "up"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        # Must be /health/detailed, NOT /v1/health/detailed
        assert call_args[0][1] == "/health/detailed"

    @patch.object(httpx.Client, "request")
    def test_health_ready_returns_dict(self, mock_request):
        """health_ready() returns a plain dict (not a Pydantic model)."""
        mock_request.return_value = httpx.Response(
            200,
            json={"status": "ready", "extra": "field"},
            request=httpx.Request("GET", "http://test:3100/health/ready"),
        )

        result = self.client.health_ready()

        assert isinstance(result, dict)
        assert result["extra"] == "field"

    @patch.object(httpx.Client, "request")
    def test_health_detailed_error(self, mock_request):
        """health_detailed() raises on server error."""
        from engram.errors import InternalError

        mock_request.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "health check failed"},
            request=httpx.Request("GET", "http://test:3100/health/detailed"),
        )

        with pytest.raises(InternalError, match="health check failed"):
            self.client.health_detailed()

    @patch.object(httpx.Client, "request")
    def test_health_legacy_uses_v1_prefix(self, mock_request):
        """Existing health() method uses /v1/health (legacy behavior)."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"status": "ok"}},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )

        result = self.client.health()

        assert result["data"]["status"] == "ok"
        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/health"
