"""Tests for EngramClient and AsyncEngramClient."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from engram.client import (
    AsyncEngramClient,
    EngramClient,
    create_async_engram_client,
    create_engram_client,
)
from engram.errors import (
    EngramTimeoutError,
    InternalError,
    NetworkError,
)


class TestEngramClient:
    def test_default_construction(self):
        client = EngramClient()
        assert client._base_url == "http://localhost:3100"
        assert client._api_key is None
        assert client._timeout == 30.0
        assert client._retries == 3
        client.close()

    def test_custom_construction(self):
        client = EngramClient(
            base_url="http://custom:8080/",
            api_key="test-key",
            timeout=10.0,
            retries=1,
            retry_delay=0.5,
            allow_insecure=True,
        )
        assert client._base_url == "http://custom:8080"
        assert client._api_key == "test-key"
        assert client._timeout == 10.0
        assert client._retries == 1
        client.close()

    def test_trailing_slash_stripped(self):
        client = EngramClient(base_url="http://localhost:3100/")
        assert client._base_url == "http://localhost:3100"
        client.close()

    def test_resource_accessors(self):
        client = EngramClient()
        assert client.sessions is not None
        assert client.notes is not None
        assert client.edges is not None
        assert client.crystals is not None
        assert client.session_links is not None
        client.close()

    def test_context_manager(self):
        with EngramClient() as client:
            assert client.sessions is not None

    def test_api_key_none_no_header(self):
        """When api_key is None, X-API-Key header should NOT be set."""
        client = EngramClient(api_key=None)
        assert "X-API-Key" not in client._http.headers
        client.close()

    def test_api_key_set_header(self):
        """When api_key is provided, X-API-Key header should be set."""
        client = EngramClient(api_key="my-secret-key")
        assert client._http.headers["X-API-Key"] == "my-secret-key"
        client.close()


class TestInsecureTransport:
    """Tests for cleartext HTTP API key protection (allow_insecure)."""

    def test_api_key_over_http_non_localhost_raises(self):
        """Sending API key over HTTP to a non-localhost host raises ValueError by default."""
        with pytest.raises(ValueError, match="cleartext"):
            EngramClient(base_url="http://remote-host:3100", api_key="secret")

    def test_api_key_over_http_non_localhost_allow_insecure(self):
        """allow_insecure=True downgrades the error to a warning."""
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            client = EngramClient(
                base_url="http://remote-host:3100", api_key="secret", allow_insecure=True,
            )
            assert len(w) == 1
            assert "cleartext" in str(w[0].message).lower()
            client.close()

    def test_api_key_over_http_localhost_ok(self):
        """API key over HTTP to localhost should not raise or warn."""
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            client = EngramClient(base_url="http://localhost:3100", api_key="secret")
            assert len(w) == 0
            client.close()

    def test_api_key_over_https_ok(self):
        """API key over HTTPS to any host should not raise or warn."""
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            # This will fail to connect but constructor should not raise
            client = EngramClient(base_url="https://remote-host:3100", api_key="secret")
            assert len(w) == 0
            client.close()

    def test_no_api_key_over_http_ok(self):
        """No API key over HTTP to any host should not raise or warn."""
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            client = EngramClient(base_url="http://remote-host:3100")
            assert len(w) == 0
            client.close()

    def test_async_api_key_over_http_non_localhost_raises(self):
        """Async: Sending API key over HTTP to a non-localhost host raises ValueError."""
        with pytest.raises(ValueError, match="cleartext"):
            AsyncEngramClient(base_url="http://remote-host:3100", api_key="secret")


class TestAsyncEngramClient:
    def test_default_construction(self):
        client = AsyncEngramClient()
        assert client._base_url == "http://localhost:3100"
        assert client._api_key is None

    @pytest.mark.asyncio
    async def test_context_manager(self):
        async with AsyncEngramClient() as client:
            assert client.sessions is not None

    def test_resource_accessors(self):
        client = AsyncEngramClient()
        assert client.sessions is not None
        assert client.notes is not None
        assert client.edges is not None
        assert client.crystals is not None
        assert client.session_links is not None

    def test_api_key_none_no_header_async(self):
        """When api_key is None, X-API-Key header should NOT be set on async client."""
        client = AsyncEngramClient(api_key=None)
        assert "X-API-Key" not in client._http.headers

    def test_api_key_set_header_async(self):
        """When api_key is provided, X-API-Key header should be set on async client."""
        client = AsyncEngramClient(api_key="my-secret-key")
        assert client._http.headers["X-API-Key"] == "my-secret-key"


class TestFactoryFunctions:
    def test_create_client_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            client = create_engram_client()
            assert client._base_url == "http://localhost:3100"
            assert client._api_key is None
            client.close()

    def test_create_client_from_env(self):
        with patch.dict(os.environ, {"ENGRAM_URL": "http://env:9090", "ENGRAM_API_KEY": "env-key"}):
            client = create_engram_client(allow_insecure=True)
            assert client._base_url == "http://env:9090"
            assert client._api_key == "env-key"
            client.close()

    def test_create_client_overrides(self):
        client = create_engram_client(
            base_url="http://override:7070", api_key="override-key", allow_insecure=True,
        )
        assert client._base_url == "http://override:7070"
        assert client._api_key == "override-key"
        client.close()

    def test_create_async_client(self):
        client = create_async_engram_client()
        assert isinstance(client, AsyncEngramClient)


class TestSyncRetryLogic:
    """Tests for the sync client _request() retry behavior."""

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_500_triggers_retry_then_succeeds(self, mock_request, mock_sleep):
        """A 500 response triggers retry; second attempt succeeds."""
        error_response = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "oops"},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        success_response = httpx.Response(
            200,
            json={"data": {"status": "ok"}},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        mock_request.side_effect = [error_response, success_response]

        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.1)
        result = client.health()

        assert result["data"]["status"] == "ok"
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once_with(0.1)
        client.close()

    @patch.object(httpx.Client, "request")
    def test_4xx_does_not_retry(self, mock_request):
        """A 4xx response should NOT trigger retry -- raises immediately."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "not found"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/bad-id"),
        )

        client = EngramClient(base_url="http://test:3100", retries=3)
        from engram.errors import NotFoundError
        with pytest.raises(NotFoundError, match="not found"):
            client._request("GET", "/v1/sessions/bad-id")

        assert mock_request.call_count == 1
        client.close()

    @patch.object(httpx.Client, "request")
    def test_timeout_exception_wrapped(self, mock_request):
        """httpx.TimeoutException should be wrapped in EngramTimeoutError."""
        mock_request.side_effect = httpx.TimeoutException("timed out")

        client = EngramClient(base_url="http://test:3100", timeout=5.0)
        with pytest.raises(EngramTimeoutError) as exc_info:
            client._request("GET", "/v1/health")

        assert exc_info.value.timeout_ms == 5000.0
        assert mock_request.call_count == 1
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_http_error_retries_then_raises_network_error(self, mock_request, mock_sleep):
        """httpx.HTTPError after retry exhaustion raises NetworkError."""
        mock_request.side_effect = httpx.ConnectError("connection refused")

        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.1)
        with pytest.raises(NetworkError) as exc_info:
            client._request("GET", "/v1/health")

        assert isinstance(exc_info.value.original_error, httpx.ConnectError)
        # retries=2 means attempt 1 + attempt 2 (retry once, then give up)
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once_with(0.1)
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_retry_delay_increases_with_attempt(self, mock_request, mock_sleep):
        """Verify retry delay is multiplied by attempt number."""
        error_response = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "oops"},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        success_response = httpx.Response(
            200,
            json={"data": {"status": "ok"}},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        mock_request.side_effect = [error_response, error_response, success_response]

        client = EngramClient(base_url="http://test:3100", retries=4, retry_delay=0.5)
        result = client.health()

        assert result["data"]["status"] == "ok"
        assert mock_request.call_count == 3
        # First retry: sleep(0.5 * 1), second retry: sleep(0.5 * 2)
        assert mock_sleep.call_count == 2
        mock_sleep.assert_any_call(0.5)
        mock_sleep.assert_any_call(1.0)
        client.close()

    @patch.object(httpx.Client, "request")
    def test_204_returns_none(self, mock_request):
        """A 204 response should return None."""
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/sessions/sess-123"),
        )

        client = EngramClient(base_url="http://test:3100")
        result = client._request("DELETE", "/v1/sessions/sess-123")

        assert result is None
        client.close()


class TestAsyncRetryLogic:
    """Tests for the async client _request() retry behavior."""

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_500_triggers_retry_then_succeeds(self, mock_request, mock_sleep):
        """Async: 500 triggers retry; second attempt succeeds."""
        error_response = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "oops"},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        success_response = httpx.Response(
            200,
            json={"data": {"status": "ok"}},
            request=httpx.Request("GET", "http://test:3100/v1/health"),
        )
        mock_request.side_effect = [error_response, success_response]

        async with AsyncEngramClient(base_url="http://test:3100", retries=3, retry_delay=0.1) as client:
            result = await client.health()

        assert result["data"]["status"] == "ok"
        assert mock_request.call_count == 2

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_timeout_exception_wrapped(self, mock_request):
        """Async: httpx.TimeoutException should be wrapped in EngramTimeoutError."""
        mock_request.side_effect = httpx.TimeoutException("timed out")

        async with AsyncEngramClient(base_url="http://test:3100", timeout=5.0) as client:
            with pytest.raises(EngramTimeoutError) as exc_info:
                await client._request("GET", "/v1/health")

        assert exc_info.value.timeout_ms == 5000.0

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_network_error_after_exhaustion(self, mock_request, mock_sleep):
        """Async: httpx.HTTPError after retry exhaustion raises NetworkError."""
        mock_request.side_effect = httpx.ConnectError("connection refused")

        async with AsyncEngramClient(base_url="http://test:3100", retries=2, retry_delay=0.1) as client:
            with pytest.raises(NetworkError) as exc_info:
                await client._request("GET", "/v1/health")

        assert isinstance(exc_info.value.original_error, httpx.ConnectError)
        assert mock_request.call_count == 2

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_4xx_does_not_retry(self, mock_request):
        """Async: 4xx should NOT retry."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "not found"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/bad-id"),
        )

        from engram.errors import NotFoundError
        async with AsyncEngramClient(base_url="http://test:3100", retries=3) as client:
            with pytest.raises(NotFoundError):
                await client._request("GET", "/v1/sessions/bad-id")

        assert mock_request.call_count == 1

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_204_returns_none(self, mock_request):
        """Async: 204 response should return None."""
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/sessions/sess-123"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            result = await client._request("DELETE", "/v1/sessions/sess-123")

        assert result is None
