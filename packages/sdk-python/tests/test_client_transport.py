"""Tests for the base client transport methods: _request_raw, _request_stream, _request_multipart."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from engram.client import EngramClient
from engram.errors import (
    EngramError,
    EngramTimeoutError,
    InternalError,
    NetworkError,
    NotFoundError,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_request() -> httpx.Request:
    return httpx.Request("POST", "http://test:3100/v1/blobs")


def _raw_response(
    status_code: int = 200,
    content: bytes = b"binary-data",
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """Build an httpx.Response with raw bytes."""
    return httpx.Response(
        status_code=status_code,
        content=content,
        headers=headers or {},
        request=_make_request(),
    )


def _json_error_response(
    status_code: int,
    code: str = "INTERNAL_ERROR",
    message: str = "oops",
) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json={"code": code, "message": message},
        request=_make_request(),
    )


# ===========================================================================
# _request_raw tests
# ===========================================================================


class TestSyncRequestRaw:
    """Tests for EngramClient._request_raw()."""

    @patch.object(httpx.Client, "request")
    def test_sends_binary_and_returns_response(self, mock_request):
        """Happy path: binary content sent, raw response returned."""
        mock_request.return_value = _raw_response(200, b"\x89PNG\r\n\x1a\n")
        client = EngramClient(base_url="http://test:3100")

        response = client._request_raw(
            "POST", "/v1/blobs", content=b"\x89PNG\r\n\x1a\n", content_type="image/png"
        )

        assert response.status_code == 200
        assert response.content == b"\x89PNG\r\n\x1a\n"
        # Verify the correct headers were sent
        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["headers"]["Content-Type"] == "image/png"
        client.close()

    @patch.object(httpx.Client, "request")
    def test_get_without_content(self, mock_request):
        """GET request with no content body."""
        mock_request.return_value = _raw_response(200, b"downloaded-bytes")
        client = EngramClient(base_url="http://test:3100")

        response = client._request_raw("GET", "/v1/blobs/123")

        assert response.content == b"downloaded-bytes"
        call_kwargs = mock_request.call_args
        assert "content" not in call_kwargs.kwargs
        client.close()

    @patch.object(httpx.Client, "request")
    def test_default_content_type(self, mock_request):
        """Default content type is application/octet-stream."""
        mock_request.return_value = _raw_response(200)
        client = EngramClient(base_url="http://test:3100")

        client._request_raw("POST", "/v1/blobs", content=b"data")

        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["headers"]["Content-Type"] == "application/octet-stream"
        client.close()

    @patch.object(httpx.Client, "request")
    def test_json_error_response_parsed(self, mock_request):
        """4xx/5xx with JSON body is parsed into EngramError."""
        mock_request.return_value = _json_error_response(404, "NOT_FOUND", "blob not found")
        client = EngramClient(base_url="http://test:3100")

        with pytest.raises(NotFoundError, match="blob not found"):
            client._request_raw("GET", "/v1/blobs/missing")
        client.close()

    @patch.object(httpx.Client, "request")
    def test_non_json_error_response(self, mock_request):
        """5xx with non-JSON body raises EngramError with HTTP_ERROR code."""
        mock_request.return_value = httpx.Response(
            502,
            content=b"Bad Gateway",
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        with pytest.raises(EngramError) as exc_info:
            client._request_raw("GET", "/v1/blobs/123")

        assert exc_info.value.status_code == 502
        assert exc_info.value.code == "HTTP_ERROR"
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_500_triggers_retry(self, mock_request, mock_sleep):
        """A 500 response triggers retry, second attempt succeeds."""
        error_resp = _json_error_response(500)
        success_resp = _raw_response(200, b"ok")
        mock_request.side_effect = [error_resp, success_resp]

        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.1)
        response = client._request_raw("POST", "/v1/blobs", content=b"data")

        assert response.content == b"ok"
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once_with(0.1)
        client.close()

    @patch.object(httpx.Client, "request")
    def test_4xx_does_not_retry(self, mock_request):
        """4xx errors are not retried."""
        mock_request.return_value = _json_error_response(400, "VALIDATION_ERROR", "bad input")
        client = EngramClient(base_url="http://test:3100", retries=3)

        with pytest.raises(EngramError):
            client._request_raw("POST", "/v1/blobs", content=b"data")

        assert mock_request.call_count == 1
        client.close()

    @patch.object(httpx.Client, "request")
    def test_timeout_raises_engram_timeout_error(self, mock_request):
        """httpx.TimeoutException is wrapped in EngramTimeoutError."""
        mock_request.side_effect = httpx.TimeoutException("timed out")
        client = EngramClient(base_url="http://test:3100", timeout=5.0)

        with pytest.raises(EngramTimeoutError) as exc_info:
            client._request_raw("POST", "/v1/blobs", content=b"data")

        assert exc_info.value.timeout_ms == 5000.0
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_network_error_retries_then_raises(self, mock_request, mock_sleep):
        """httpx.HTTPError retries then raises NetworkError on exhaustion."""
        mock_request.side_effect = httpx.ConnectError("connection refused")
        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.1)

        with pytest.raises(NetworkError) as exc_info:
            client._request_raw("POST", "/v1/blobs", content=b"data")

        assert isinstance(exc_info.value.original_error, httpx.ConnectError)
        assert mock_request.call_count == 2
        client.close()

    @patch.object(httpx.Client, "request")
    def test_query_params_forwarded(self, mock_request):
        """Query parameters are forwarded to the HTTP request."""
        mock_request.return_value = _raw_response(200)
        client = EngramClient(base_url="http://test:3100")

        client._request_raw("GET", "/v1/blobs/123", params={"format": "png"})

        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["params"] == {"format": "png"}
        client.close()


# ===========================================================================
# _request_stream tests
# ===========================================================================


class _FakeStreamResponse:
    """Minimal context manager that mimics httpx stream response for sync client."""

    def __init__(self, status_code: int = 200, chunks: list[bytes] | None = None,
                 json_body: dict | None = None):
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self._chunks = chunks or []
        self._json_body = json_body
        self._read_called = False

    def read(self):
        self._read_called = True

    def json(self):
        if self._json_body is not None:
            return self._json_body
        raise ValueError("No JSON")

    @property
    def text(self):
        return str(self._json_body) if self._json_body else ""

    def iter_bytes(self):
        return iter(self._chunks)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class TestSyncRequestStream:
    """Tests for EngramClient._request_stream()."""

    @patch.object(httpx.Client, "stream")
    def test_yields_byte_chunks(self, mock_stream):
        """Happy path: yields byte chunks from the response."""
        chunks = [b"chunk1", b"chunk2", b"chunk3"]
        mock_stream.return_value = _FakeStreamResponse(200, chunks=chunks)
        client = EngramClient(base_url="http://test:3100")

        result = list(client._request_stream("GET", "/v1/export"))

        assert result == chunks
        client.close()

    @patch.object(httpx.Client, "stream")
    def test_empty_response(self, mock_stream):
        """Streaming an empty response yields nothing."""
        mock_stream.return_value = _FakeStreamResponse(200, chunks=[])
        client = EngramClient(base_url="http://test:3100")

        result = list(client._request_stream("GET", "/v1/export"))

        assert result == []
        client.close()

    @patch.object(httpx.Client, "stream")
    def test_json_body_forwarded(self, mock_stream):
        """JSON body is forwarded to the stream request."""
        mock_stream.return_value = _FakeStreamResponse(200, chunks=[b"data"])
        client = EngramClient(base_url="http://test:3100")

        list(client._request_stream("POST", "/v1/export", body={"format": "json"}))

        call_kwargs = mock_stream.call_args
        assert call_kwargs.kwargs["json"] == {"format": "json"}
        client.close()

    @patch.object(httpx.Client, "stream")
    def test_error_response_parsed(self, mock_stream):
        """4xx/5xx with JSON error body raises EngramError."""
        mock_stream.return_value = _FakeStreamResponse(
            404,
            json_body={"code": "NOT_FOUND", "message": "export not found"},
        )
        client = EngramClient(base_url="http://test:3100")

        with pytest.raises(NotFoundError, match="export not found"):
            list(client._request_stream("GET", "/v1/export/missing"))
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "stream")
    def test_500_triggers_retry(self, mock_stream, mock_sleep):
        """A 500 response triggers retry, second attempt succeeds."""
        error_resp = _FakeStreamResponse(
            500,
            json_body={"code": "INTERNAL_ERROR", "message": "oops"},
        )
        success_resp = _FakeStreamResponse(200, chunks=[b"ok"])
        mock_stream.side_effect = [error_resp, success_resp]

        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.1)
        result = list(client._request_stream("GET", "/v1/export"))

        assert result == [b"ok"]
        assert mock_stream.call_count == 2
        mock_sleep.assert_called_once_with(0.1)
        client.close()

    @patch.object(httpx.Client, "stream")
    def test_timeout_raises_engram_timeout_error(self, mock_stream):
        """httpx.TimeoutException is wrapped in EngramTimeoutError."""
        mock_stream.side_effect = httpx.TimeoutException("timed out")
        client = EngramClient(base_url="http://test:3100", timeout=5.0)

        with pytest.raises(EngramTimeoutError) as exc_info:
            list(client._request_stream("GET", "/v1/export"))

        assert exc_info.value.timeout_ms == 5000.0
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "stream")
    def test_network_error_retries_then_raises(self, mock_stream, mock_sleep):
        """httpx.HTTPError retries then raises NetworkError on exhaustion."""
        mock_stream.side_effect = httpx.ConnectError("connection refused")
        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.1)

        with pytest.raises(NetworkError) as exc_info:
            list(client._request_stream("GET", "/v1/export"))

        assert isinstance(exc_info.value.original_error, httpx.ConnectError)
        assert mock_stream.call_count == 2
        client.close()


# ===========================================================================
# _request_multipart tests
# ===========================================================================


class TestSyncRequestMultipart:
    """Tests for EngramClient._request_multipart()."""

    @patch.object(httpx.Client, "request")
    def test_sends_files_and_returns_json(self, mock_request):
        """Happy path: multipart with files and data, returns parsed JSON."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"id": "import-1", "status": "complete"}},
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        files = {"file": ("backup.json", b'{"sessions":[]}', "application/json")}
        data = {"options": '{"merge": true}'}
        result = client._request_multipart("POST", "/v1/import", files=files, data=data)

        assert result["data"]["id"] == "import-1"
        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["files"] == files
        assert call_kwargs.kwargs["data"] == data
        # Content-Type should NOT be set manually (httpx handles boundary)
        assert "Content-Type" not in call_kwargs.kwargs["headers"]
        client.close()

    @patch.object(httpx.Client, "request")
    def test_files_only_no_data(self, mock_request):
        """Multipart with files only, no form data fields."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"id": "import-2"}},
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        files = {"file": ("data.bin", b"\x00\x01\x02", "application/octet-stream")}
        result = client._request_multipart("POST", "/v1/import", files=files)

        assert result["data"]["id"] == "import-2"
        call_kwargs = mock_request.call_args
        assert "data" not in call_kwargs.kwargs
        client.close()

    @patch.object(httpx.Client, "request")
    def test_204_returns_none(self, mock_request):
        """A 204 response returns None."""
        mock_request.return_value = httpx.Response(
            204, request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        files = {"file": ("data.bin", b"\x00", "application/octet-stream")}
        result = client._request_multipart("POST", "/v1/import", files=files)

        assert result is None
        client.close()

    @patch.object(httpx.Client, "request")
    def test_error_response_parsed(self, mock_request):
        """4xx with JSON error body raises appropriate error."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid file format"},
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        files = {"file": ("bad.txt", b"not json", "text/plain")}
        with pytest.raises(EngramError, match="invalid file format"):
            client._request_multipart("POST", "/v1/import", files=files)
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_500_triggers_retry(self, mock_request, mock_sleep):
        """A 500 response triggers retry, second attempt succeeds."""
        error_resp = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "oops"},
            request=_make_request(),
        )
        success_resp = httpx.Response(
            200,
            json={"data": {"id": "import-3"}},
            request=_make_request(),
        )
        mock_request.side_effect = [error_resp, success_resp]

        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.1)
        files = {"file": ("data.json", b"{}", "application/json")}
        result = client._request_multipart("POST", "/v1/import", files=files)

        assert result["data"]["id"] == "import-3"
        assert mock_request.call_count == 2
        mock_sleep.assert_called_once_with(0.1)
        client.close()

    @patch.object(httpx.Client, "request")
    def test_4xx_does_not_retry(self, mock_request):
        """4xx errors are not retried."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "endpoint not found"},
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100", retries=3)

        files = {"file": ("data.json", b"{}", "application/json")}
        with pytest.raises(NotFoundError):
            client._request_multipart("POST", "/v1/import", files=files)

        assert mock_request.call_count == 1
        client.close()

    @patch.object(httpx.Client, "request")
    def test_timeout_raises_engram_timeout_error(self, mock_request):
        """httpx.TimeoutException is wrapped in EngramTimeoutError."""
        mock_request.side_effect = httpx.TimeoutException("timed out")
        client = EngramClient(base_url="http://test:3100", timeout=5.0)

        files = {"file": ("data.json", b"{}", "application/json")}
        with pytest.raises(EngramTimeoutError) as exc_info:
            client._request_multipart("POST", "/v1/import", files=files)

        assert exc_info.value.timeout_ms == 5000.0
        client.close()

    @patch("time.sleep")
    @patch.object(httpx.Client, "request")
    def test_network_error_retries_then_raises(self, mock_request, mock_sleep):
        """httpx.HTTPError retries then raises NetworkError on exhaustion."""
        mock_request.side_effect = httpx.ConnectError("connection refused")
        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.1)

        files = {"file": ("data.json", b"{}", "application/json")}
        with pytest.raises(NetworkError) as exc_info:
            client._request_multipart("POST", "/v1/import", files=files)

        assert isinstance(exc_info.value.original_error, httpx.ConnectError)
        assert mock_request.call_count == 2
        client.close()

    @patch.object(httpx.Client, "request")
    def test_query_params_forwarded(self, mock_request):
        """Query parameters are forwarded to the HTTP request."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"id": "import-4"}},
            request=_make_request(),
        )
        client = EngramClient(base_url="http://test:3100")

        files = {"file": ("data.json", b"{}", "application/json")}
        client._request_multipart(
            "POST", "/v1/import", files=files, params={"dryRun": "true"}
        )

        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["params"] == {"dryRun": "true"}
        client.close()
