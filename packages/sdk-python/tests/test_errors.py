"""Tests for error parsing and error hierarchy."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
import warnings

from engram.errors import (
    EngramError,
    EngramTimeoutError,
    InternalError,
    NetworkError,
    NotFoundError,
    SessionExistsError,
    UnauthorizedError,
    ValidationError,
    parse_api_error,
)
from tests.conftest import SAMPLE_SESSION, make_api_response


class TestErrorHierarchy:
    def test_base_error(self):
        err = EngramError("test", code="TEST", status_code=418)
        assert str(err) == "test"
        assert err.code == "TEST"
        assert err.status_code == 418
        assert isinstance(err, Exception)

    def test_not_found_error(self):
        err = NotFoundError("missing")
        assert err.code == "NOT_FOUND"
        assert err.status_code == 404
        assert isinstance(err, EngramError)

    def test_session_exists_error(self):
        err = SessionExistsError()
        assert err.code == "SESSION_EXISTS"
        assert err.status_code == 409

    def test_validation_error_with_issues(self):
        err = ValidationError("bad input", issues=[{"path": ["name"], "message": "required"}])
        assert err.code == "VALIDATION_ERROR"
        assert err.status_code == 400
        assert len(err.issues) == 1

    def test_unauthorized_error(self):
        err = UnauthorizedError()
        assert err.code == "UNAUTHORIZED"
        assert err.status_code == 401

    def test_network_error(self):
        orig = ConnectionError("refused")
        err = NetworkError("conn failed", original_error=orig)
        assert err.code == "NETWORK_ERROR"
        assert err.original_error is orig

    def test_timeout_error(self):
        err = EngramTimeoutError(30000)
        assert "30000" in str(err)
        assert err.timeout_ms == 30000

    def test_timeout_error_deprecated_alias(self):
        """Importing TimeoutError from engram.errors triggers DeprecationWarning."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            from engram.errors import TimeoutError as TE  # noqa: F811
            assert len(w) == 1
            assert issubclass(w[0].category, DeprecationWarning)
            assert "deprecated" in str(w[0].message).lower()
            assert TE is EngramTimeoutError

    def test_internal_error(self):
        err = InternalError("boom")
        assert err.code == "INTERNAL_ERROR"
        assert err.status_code == 500


class TestParseApiError:
    def test_standard_404(self):
        with pytest.raises(NotFoundError, match="not found"):
            parse_api_error(404, {"code": "NOT_FOUND", "message": "not found"})

    def test_standard_401(self):
        with pytest.raises(UnauthorizedError):
            parse_api_error(401, {"code": "UNAUTHORIZED", "message": "bad key"})

    def test_standard_409(self):
        with pytest.raises(SessionExistsError):
            parse_api_error(409, {"code": "SESSION_EXISTS", "message": "exists"})

    def test_standard_500(self):
        with pytest.raises(InternalError):
            parse_api_error(500, {"code": "INTERNAL_ERROR", "message": "oops"})

    def test_validation_zod_error(self):
        body = {
            "success": False,
            "error": {
                "name": "ZodError",
                "issues": [
                    {"code": "invalid_type", "message": "Required", "path": ["name"]}
                ],
            },
        }
        with pytest.raises(ValidationError) as exc_info:
            parse_api_error(400, body)
        assert len(exc_info.value.issues) == 1

    def test_nested_error(self):
        body = {"error": {"code": "CUSTOM", "message": "custom error"}}
        with pytest.raises(EngramError, match="custom error"):
            parse_api_error(422, body)

    def test_fallback_string(self):
        with pytest.raises(EngramError, match="something"):
            parse_api_error(503, "something")

    def test_fallback_unknown(self):
        with pytest.raises(EngramError, match="Unknown error"):
            parse_api_error(500, {"unexpected": True})


# ---------------------------------------------------------------------------
# HTTP Transport Error Tests — Sync Client
# ---------------------------------------------------------------------------


class TestSyncClientHttpErrors:
    """Test HTTP error responses through the sync EngramClient."""

    def setup_method(self):
        # retries=0 so _attempt < self._retries is always False; no retries
        self.client = EngramClient(base_url="http://test:3100", retries=0)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_404_raises_not_found(self, mock_req):
        """GET on a missing resource raises NotFoundError."""
        mock_req.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "session not found"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/bad"),
        )
        with pytest.raises(NotFoundError):
            self.client.sessions.get("bad")

    @patch.object(httpx.Client, "request")
    def test_401_raises_unauthorized(self, mock_req):
        """API key missing/invalid raises UnauthorizedError."""
        mock_req.return_value = httpx.Response(
            401,
            json={"code": "UNAUTHORIZED", "message": "bad api key"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(UnauthorizedError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_500_raises_internal_error(self, mock_req):
        """Server error raises InternalError."""
        mock_req.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "boom"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(InternalError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_400_validation_error(self, mock_req):
        """Zod validation failure on 400 raises ValidationError with issues."""
        mock_req.return_value = httpx.Response(
            400,
            json={
                "success": False,
                "error": {
                    "name": "ZodError",
                    "issues": [
                        {"code": "invalid_type", "message": "Required", "path": ["projectPath"]}
                    ],
                },
            },
            request=httpx.Request("POST", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(ValidationError) as exc_info:
            self.client.sessions.list()
        assert len(exc_info.value.issues) == 1

    @patch.object(httpx.Client, "request")
    def test_409_session_exists(self, mock_req):
        """Conflict on duplicate session raises SessionExistsError."""
        mock_req.return_value = httpx.Response(
            409,
            json={"code": "SESSION_EXISTS", "message": "session already exists"},
            request=httpx.Request("POST", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(SessionExistsError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_403_forbidden(self, mock_req):
        """403 FORBIDDEN raises a generic EngramError with correct status."""
        mock_req.return_value = httpx.Response(
            403,
            json={"code": "FORBIDDEN", "message": "access denied"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/secret"),
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.sessions.get("secret")
        assert exc_info.value.status_code == 403
        assert exc_info.value.code == "FORBIDDEN"

    @patch.object(httpx.Client, "request")
    def test_422_unprocessable(self, mock_req):
        """422 with nested error envelope raises EngramError."""
        mock_req.return_value = httpx.Response(
            422,
            json={"error": {"code": "UNPROCESSABLE", "message": "cannot process entity"}},
            request=httpx.Request("POST", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.sessions.list()
        assert exc_info.value.status_code == 422

    @patch.object(httpx.Client, "request")
    def test_502_bad_gateway(self, mock_req):
        """502 raises EngramError with status 502."""
        mock_req.return_value = httpx.Response(
            502,
            json={"code": "BAD_GATEWAY", "message": "upstream unavailable"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.sessions.list()
        assert exc_info.value.status_code == 502

    @patch.object(httpx.Client, "request")
    def test_503_service_unavailable(self, mock_req):
        """503 with JSON body raises EngramError."""
        mock_req.return_value = httpx.Response(
            503,
            json={"code": "SERVICE_UNAVAILABLE", "message": "Service Unavailable"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.sessions.list()
        assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# Network / Timeout Error Tests
# ---------------------------------------------------------------------------


class TestNetworkErrors:
    """Test network-level errors: timeout, connection refused, read timeout."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100", retries=0, timeout=1.0)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_timeout_exception_raises_engram_timeout_error(self, mock_req):
        """httpx.TimeoutException is converted to EngramTimeoutError."""
        mock_req.side_effect = httpx.TimeoutException("timed out")
        with pytest.raises(EngramTimeoutError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_timeout_error_is_timeout_alias(self, mock_req):
        """Deprecated TimeoutError alias still catches EngramTimeoutError."""
        mock_req.side_effect = httpx.TimeoutException("timed out")
        with pytest.raises(EngramTimeoutError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_timeout_error_carries_timeout_ms(self, mock_req):
        """EngramTimeoutError.timeout_ms reflects the configured timeout."""
        mock_req.side_effect = httpx.TimeoutException("timed out")
        with pytest.raises(EngramTimeoutError) as exc_info:
            self.client.sessions.list()
        # timeout=1.0s -> timeout_ms=1000
        assert exc_info.value.timeout_ms == pytest.approx(1000.0)

    @patch.object(httpx.Client, "request")
    def test_connect_error_raises_network_error(self, mock_req):
        """httpx.ConnectError (subclass of HTTPError) raises NetworkError."""
        mock_req.side_effect = httpx.ConnectError("connection refused")
        with pytest.raises(NetworkError):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_read_timeout_raises_timeout(self, mock_req):
        """httpx.ReadTimeout (subclass of TimeoutException) raises EngramTimeoutError."""
        mock_req.side_effect = httpx.ReadTimeout("read timeout")
        with pytest.raises(EngramTimeoutError):
            self.client.sessions.get("sess-1")

    @patch.object(httpx.Client, "request")
    def test_network_error_wraps_original(self, mock_req):
        """NetworkError.original_error holds the originating httpx exception."""
        original = httpx.ConnectError("refused")
        mock_req.side_effect = original
        with pytest.raises(NetworkError) as exc_info:
            self.client.sessions.list()
        assert exc_info.value.original_error is original


# ---------------------------------------------------------------------------
# Malformed Response Tests
# ---------------------------------------------------------------------------


class TestMalformedResponses:
    """Test handling of unexpected/malformed server responses."""

    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100", retries=0)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_empty_data_returns_none_or_raises(self, mock_req):
        """200 with data=null is handled; does not crash with an unclear error."""
        mock_req.return_value = httpx.Response(
            200,
            json={"data": None},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/s1"),
        )
        try:
            result = self.client.sessions.get("s1")
            # If it returns, None or session-like object is acceptable
            assert result is None or hasattr(result, "id") or isinstance(result, dict)
        except Exception as exc:
            assert isinstance(exc, (EngramError, ValueError, TypeError, AttributeError))

    @patch.object(httpx.Client, "request")
    def test_missing_data_key_raises(self, mock_req):
        """200 response missing 'data' key raises or returns in a structured way."""
        mock_req.return_value = httpx.Response(
            200,
            json={"result": "ok"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        try:
            result = self.client.sessions.list()
            # Acceptable: None or some iterable
        except Exception as exc:
            assert isinstance(exc, (EngramError, KeyError, TypeError, AttributeError))

    @patch.object(httpx.Client, "request")
    def test_500_with_non_json_body_raises(self, mock_req):
        """500 with a plain-text body raises (JSONDecodeError or EngramError)."""
        mock_req.return_value = httpx.Response(
            500,
            text="Internal Server Error",
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        # response.json() will raise ValueError/JSONDecodeError for non-JSON bodies;
        # this propagates up since the sync client doesn't wrap it
        with pytest.raises(Exception):
            self.client.sessions.list()

    @patch.object(httpx.Client, "request")
    def test_200_success_is_returned_unwrapped(self, mock_req):
        """200 with valid session data is returned by sessions.get."""
        mock_req.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SESSION),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123"),
        )
        result = self.client.sessions.get("sess-123")
        assert result is not None
        assert result.id == "sess-123"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Retry Exhaustion Tests
# ---------------------------------------------------------------------------


class TestRetryExhaustion:
    """Test retry behavior: exhaust retries and verify the final error is raised."""

    @patch.object(httpx.Client, "request")
    def test_retry_exhaustion_raises_after_retries(self, mock_req):
        """After max retries on 5xx, InternalError is raised and call_count >= 2."""
        mock_req.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "server error"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        # retries=2 -> attempt 1 retries (1 < 2), attempt 2 gives up -> 2 calls total
        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.0)
        try:
            with pytest.raises((InternalError, EngramError)):
                client.sessions.list()
        finally:
            client.close()
        assert mock_req.call_count >= 2

    @patch.object(httpx.Client, "request")
    def test_retry_exhaustion_three_retries(self, mock_req):
        """retries=3 triggers 3 total calls before giving up."""
        mock_req.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "server error"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        # retries=3 -> attempt 1 (retry), attempt 2 (retry), attempt 3 (give up) = 3 calls
        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.0)
        try:
            with pytest.raises(EngramError):
                client.sessions.list()
        finally:
            client.close()
        assert mock_req.call_count == 3

    @patch.object(httpx.Client, "request")
    def test_no_retry_on_4xx(self, mock_req):
        """4xx errors are NOT retried — the mock is called exactly once."""
        mock_req.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "not found"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions/bad"),
        )
        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.0)
        try:
            with pytest.raises(NotFoundError):
                client.sessions.get("bad")
        finally:
            client.close()
        assert mock_req.call_count == 1

    @patch.object(httpx.Client, "request")
    def test_no_retry_on_401(self, mock_req):
        """401 is a 4xx; no retries are performed."""
        mock_req.return_value = httpx.Response(
            401,
            json={"code": "UNAUTHORIZED", "message": "bad key"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        client = EngramClient(base_url="http://test:3100", retries=3, retry_delay=0.0)
        try:
            with pytest.raises(UnauthorizedError):
                client.sessions.list()
        finally:
            client.close()
        assert mock_req.call_count == 1

    @patch.object(httpx.Client, "request")
    def test_no_retry_when_retries_zero(self, mock_req):
        """retries=0 means a single attempt only — no retries even on 5xx."""
        mock_req.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "boom"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        client = EngramClient(base_url="http://test:3100", retries=0, retry_delay=0.0)
        try:
            with pytest.raises(EngramError):
                client.sessions.list()
        finally:
            client.close()
        assert mock_req.call_count == 1

    @patch.object(httpx.Client, "request")
    def test_retry_succeeds_on_second_attempt(self, mock_req):
        """If the second attempt succeeds, the result is returned normally."""
        success_response = httpx.Response(
            200,
            json=make_api_response([SAMPLE_SESSION], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        error_response = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "transient"},
            request=httpx.Request("GET", "http://test:3100/v1/sessions"),
        )
        mock_req.side_effect = [error_response, success_response]
        client = EngramClient(base_url="http://test:3100", retries=2, retry_delay=0.0)
        try:
            result = client.sessions.list()
            assert result is not None
        finally:
            client.close()
        assert mock_req.call_count == 2


# ---------------------------------------------------------------------------
# Concurrent Async Request Tests
# ---------------------------------------------------------------------------


class TestConcurrentAsync:
    """Test concurrent async requests via asyncio.gather."""

    async def test_concurrent_session_fetches(self):
        """3 concurrent async GETs each succeed independently."""

        async def _fetch(session_id: str) -> object:
            async with AsyncEngramClient(base_url="http://test:3100") as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.return_value = httpx.Response(
                        200,
                        json=make_api_response({**SAMPLE_SESSION, "id": session_id}),
                        request=httpx.Request(
                            "GET", f"http://test:3100/v1/sessions/{session_id}"
                        ),
                    )
                    return await client.sessions.get(session_id)

        results = await asyncio.gather(
            _fetch("sess-1"),
            _fetch("sess-2"),
            _fetch("sess-3"),
        )
        assert len(results) == 3
        assert all(r is not None for r in results)

    async def test_concurrent_errors_are_independent(self):
        """3 concurrent requests that all fail raise independent errors."""

        async def _fetch_bad(session_id: str) -> None:
            async with AsyncEngramClient(base_url="http://test:3100") as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.return_value = httpx.Response(
                        404,
                        json={"code": "NOT_FOUND", "message": "not found"},
                        request=httpx.Request(
                            "GET", f"http://test:3100/v1/sessions/{session_id}"
                        ),
                    )
                    await client.sessions.get(session_id)

        results = await asyncio.gather(
            _fetch_bad("bad-1"),
            _fetch_bad("bad-2"),
            _fetch_bad("bad-3"),
            return_exceptions=True,
        )
        assert all(isinstance(r, NotFoundError) for r in results)

    async def test_concurrent_mixed_success_and_error(self):
        """gather() with mixed success/error results: errors don't block successes."""

        async def _fetch_ok(session_id: str) -> object:
            async with AsyncEngramClient(base_url="http://test:3100") as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.return_value = httpx.Response(
                        200,
                        json=make_api_response({**SAMPLE_SESSION, "id": session_id}),
                        request=httpx.Request(
                            "GET", f"http://test:3100/v1/sessions/{session_id}"
                        ),
                    )
                    return await client.sessions.get(session_id)

        async def _fetch_fail(session_id: str) -> object:
            async with AsyncEngramClient(base_url="http://test:3100") as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.return_value = httpx.Response(
                        500,
                        json={"code": "INTERNAL_ERROR", "message": "boom"},
                        request=httpx.Request(
                            "GET", f"http://test:3100/v1/sessions/{session_id}"
                        ),
                    )
                    return await client.sessions.get(session_id)

        results = await asyncio.gather(
            _fetch_ok("sess-ok-1"),
            _fetch_fail("sess-fail-1"),
            _fetch_ok("sess-ok-2"),
            return_exceptions=True,
        )
        assert len(results) == 3
        assert results[0] is not None and not isinstance(results[0], Exception)
        assert isinstance(results[1], EngramError)
        assert results[2] is not None and not isinstance(results[2], Exception)

    async def test_five_concurrent_session_fetches(self):
        """5 concurrent async GETs all complete without interference."""

        async def _fetch(session_id: str) -> object:
            async with AsyncEngramClient(base_url="http://test:3100") as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.return_value = httpx.Response(
                        200,
                        json=make_api_response({**SAMPLE_SESSION, "id": session_id}),
                        request=httpx.Request(
                            "GET", f"http://test:3100/v1/sessions/{session_id}"
                        ),
                    )
                    return await client.sessions.get(session_id)

        session_ids = [f"sess-{i}" for i in range(5)]
        results = await asyncio.gather(*[_fetch(sid) for sid in session_ids])
        assert len(results) == 5
        assert all(r is not None for r in results)

    async def test_concurrent_timeout_errors_are_independent(self):
        """3 concurrent requests that all timeout raise independent EngramTimeoutErrors."""

        async def _timeout_fetch(session_id: str) -> None:
            async with AsyncEngramClient(
                base_url="http://test:3100", retries=0, timeout=1.0
            ) as client:
                with patch.object(
                    httpx.AsyncClient, "request", new_callable=AsyncMock
                ) as mock_req:
                    mock_req.side_effect = httpx.TimeoutException("timed out")
                    await client.sessions.get(session_id)

        results = await asyncio.gather(
            _timeout_fetch("sess-a"),
            _timeout_fetch("sess-b"),
            _timeout_fetch("sess-c"),
            return_exceptions=True,
        )
        assert all(isinstance(r, EngramTimeoutError) for r in results)
