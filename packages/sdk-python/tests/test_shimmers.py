"""Tests for the shimmers resource.

Mirrors the TS resource-test pattern: assert request method/path/body/query
params and response unwrapping for the standard ``{ data }`` envelope, plus the
two typed shimmer errors (``ShimmerCasConflictError`` 409, ``ShimmerDisabledError``
503) routed centrally by ``parse_api_error`` from the server error codes.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import ShimmerCasConflictError, ShimmerDisabledError
from engram.resources.shimmers import ShimmersResource, SyncShimmersResource
from engram.types.shimmers import (
    AcquireLockParams,
    ReleaseLockParams,
    RenewLockParams,
    Shimmer,
    ShimmerDeleteResult,
    ShimmerRead,
)


SHIMMER_LOCK = {
    "recordType": "lock",
    "recordKey": "deploy",
    "value": {"phase": "build"},
    "ownerToken": "owner-1",
    "revision": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
    "fadesAt": "2026-01-01T00:01:00Z",
}

SHIMMER_HEARTBEAT = {
    **SHIMMER_LOCK,
    "recordType": "heartbeat",
    "recordKey": "worker-1",
    "ownerToken": None,
}

SHIMMER_READ = {
    "recordType": "lock",
    "recordKey": "deploy",
    "value": {"phase": "build"},
    "ownerToken": None,
    "revision": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
    "fadesAt": "2026-01-01T00:01:00Z",
}


def _ok(data, method="POST", url="http://test:3100/v1/shimmers"):
    return httpx.Response(200, json={"data": data}, request=httpx.Request(method, url))


class TestSyncShimmersResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.shimmers = SyncShimmersResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_heartbeat(self, mock_request):
        mock_request.return_value = _ok(SHIMMER_HEARTBEAT)

        result = self.shimmers.heartbeat(
            "worker-1", {"phase": "build"}, ttl_seconds=30
        )

        assert isinstance(result, Shimmer)
        assert result.record_type == "heartbeat"
        assert result.owner_token is None
        call = mock_request.call_args
        assert call[0][0] == "POST"
        assert call[0][1] == "/v1/shimmers"
        assert call[1]["json"] == {
            "recordType": "heartbeat",
            "key": "worker-1",
            "ttlSeconds": 30,
            "value": {"phase": "build"},
        }

    @patch.object(httpx.Client, "request")
    def test_heartbeat_omits_none_value(self, mock_request):
        mock_request.return_value = _ok(SHIMMER_HEARTBEAT)
        self.shimmers.heartbeat("worker-1", None, ttl_seconds=30)
        assert mock_request.call_args[1]["json"] == {
            "recordType": "heartbeat",
            "key": "worker-1",
            "ttlSeconds": 30,
        }

    @patch.object(httpx.Client, "request")
    def test_acquire_lock(self, mock_request):
        mock_request.return_value = _ok(SHIMMER_LOCK)

        result = self.shimmers.acquire_lock(
            "deploy",
            AcquireLockParams(owner_token="owner-1", ttl_seconds=60, value={"phase": "build"}),
        )

        assert isinstance(result, Shimmer)
        assert result.owner_token == "owner-1"
        call = mock_request.call_args
        assert call[0][0] == "POST"
        assert call[0][1] == "/v1/shimmers"
        assert call[1]["json"] == {
            "recordType": "lock",
            "key": "deploy",
            "ownerToken": "owner-1",
            "ttlSeconds": 60,
            "value": {"phase": "build"},
        }

    @patch.object(httpx.Client, "request")
    def test_renew_lock(self, mock_request):
        mock_request.return_value = _ok(
            SHIMMER_LOCK, method="PUT", url="http://test:3100/v1/shimmers/deploy"
        )

        result = self.shimmers.renew_lock(
            "deploy",
            RenewLockParams(owner_token="owner-1", expected_revision=1, ttl_seconds=60),
        )

        assert isinstance(result, Shimmer)
        call = mock_request.call_args
        assert call[0][0] == "PUT"
        assert call[0][1] == "/v1/shimmers/deploy"
        assert call[1]["json"] == {
            "recordType": "lock",
            "ownerToken": "owner-1",
            "expectedRevision": 1,
            "ttlSeconds": 60,
        }

    @patch.object(httpx.Client, "request")
    def test_renew_lock_url_encodes_key(self, mock_request):
        mock_request.return_value = _ok(
            SHIMMER_LOCK, method="PUT", url="http://test:3100/v1/shimmers/a%2Fb"
        )
        self.shimmers.renew_lock(
            "a/b", RenewLockParams(owner_token="o", expected_revision=1, ttl_seconds=60)
        )
        assert mock_request.call_args[0][1] == "/v1/shimmers/a%2Fb"

    @patch.object(httpx.Client, "request")
    def test_release_lock(self, mock_request):
        mock_request.return_value = _ok(
            {"released": True, "consumed": None},
            method="DELETE",
            url="http://test:3100/v1/shimmers/deploy",
        )

        result = self.shimmers.release_lock(
            "deploy", ReleaseLockParams(owner_token="owner-1")
        )

        assert isinstance(result, ShimmerDeleteResult)
        assert result.released is True
        assert result.consumed is None
        call = mock_request.call_args
        assert call[0][0] == "DELETE"
        assert call[0][1] == "/v1/shimmers/deploy"
        assert call[1]["params"] == {"recordType": "lock", "ownerToken": "owner-1"}

    @patch.object(httpx.Client, "request")
    def test_emit_ipc(self, mock_request):
        mock_request.return_value = _ok({**SHIMMER_LOCK, "recordType": "ipc", "ownerToken": None})

        self.shimmers.emit_ipc("chan", {"msg": "hi"}, ttl_seconds=120)

        call = mock_request.call_args
        assert call[0][0] == "POST"
        assert call[0][1] == "/v1/shimmers"
        assert call[1]["json"] == {
            "recordType": "ipc",
            "key": "chan",
            "ttlSeconds": 120,
            "value": {"msg": "hi"},
        }

    @patch.object(httpx.Client, "request")
    def test_consume_ipc_returns_record(self, mock_request):
        consumed = {**SHIMMER_READ, "recordType": "ipc"}
        mock_request.return_value = _ok(
            {"released": True, "consumed": consumed},
            method="DELETE",
            url="http://test:3100/v1/shimmers/chan",
        )

        result = self.shimmers.consume_ipc("chan")

        assert isinstance(result, ShimmerRead)
        assert result.owner_token is None
        call = mock_request.call_args
        assert call[0][0] == "DELETE"
        assert call[0][1] == "/v1/shimmers/chan"
        assert call[1]["params"] == {"recordType": "ipc"}

    @patch.object(httpx.Client, "request")
    def test_consume_ipc_returns_none_when_empty(self, mock_request):
        mock_request.return_value = _ok(
            {"released": False, "consumed": None},
            method="DELETE",
            url="http://test:3100/v1/shimmers/chan",
        )
        result = self.shimmers.consume_ipc("chan")
        assert result is None

    @patch.object(httpx.Client, "request")
    def test_get(self, mock_request):
        mock_request.return_value = _ok(
            SHIMMER_READ, method="GET", url="http://test:3100/v1/shimmers/deploy"
        )

        result = self.shimmers.get("deploy", "lock")

        assert isinstance(result, ShimmerRead)
        assert result.owner_token is None
        call = mock_request.call_args
        assert call[0][0] == "GET"
        assert call[0][1] == "/v1/shimmers/deploy"
        assert call[1]["params"] == {"recordType": "lock"}

    @patch.object(httpx.Client, "request")
    def test_acquire_lock_raises_cas_conflict_nested(self, mock_request):
        # engram's Hono envelope: { error: { code, message } }
        mock_request.return_value = httpx.Response(
            409,
            json={"error": {"code": "SHIMMER_CAS_CONFLICT", "message": "held"}},
            request=httpx.Request("POST", "http://test:3100/v1/shimmers"),
        )
        with pytest.raises(ShimmerCasConflictError) as exc:
            self.shimmers.acquire_lock(
                "deploy", AcquireLockParams(owner_token="o", ttl_seconds=60)
            )
        assert exc.value.code == "SHIMMER_CAS_CONFLICT"
        assert exc.value.status_code == 409

    @patch.object(httpx.Client, "request")
    def test_emit_ipc_raises_cas_conflict_flat(self, mock_request):
        # Bare { code, message } body.
        mock_request.return_value = httpx.Response(
            409,
            json={"code": "SHIMMER_CAS_CONFLICT", "message": "live message"},
            request=httpx.Request("POST", "http://test:3100/v1/shimmers"),
        )
        with pytest.raises(ShimmerCasConflictError) as exc:
            self.shimmers.emit_ipc("chan", {"m": 1}, ttl_seconds=60)
        assert exc.value.details == {"code": "SHIMMER_CAS_CONFLICT", "message": "live message"}

    def test_heartbeat_raises_disabled(self):
        # 503 SHIMMER_DISABLED must surface as the typed error. Use retries=0 so
        # the 5xx retry loop doesn't run (the resource port doesn't change the
        # transport-level retry policy).
        client = EngramClient(base_url="http://test:3100", retries=0)
        try:
            with patch.object(httpx.Client, "request") as mock_request:
                mock_request.return_value = httpx.Response(
                    503,
                    json={"error": {"code": "SHIMMER_DISABLED", "message": "off"}},
                    request=httpx.Request("POST", "http://test:3100/v1/shimmers"),
                )
                with pytest.raises(ShimmerDisabledError) as exc:
                    SyncShimmersResource(client).heartbeat("w", {}, ttl_seconds=30)
                assert exc.value.code == "SHIMMER_DISABLED"
                assert exc.value.status_code == 503
        finally:
            client.close()


class TestAsyncShimmersResource:
    @pytest.mark.asyncio
    async def test_async_acquire_lock(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return _ok(SHIMMER_LOCK)

                mock_request.side_effect = _resp
                result = await ShimmersResource(client).acquire_lock(
                    "deploy", AcquireLockParams(owner_token="owner-1", ttl_seconds=60)
                )
                assert isinstance(result, Shimmer)
                assert result.owner_token == "owner-1"
                call = mock_request.call_args
                assert call[0][0] == "POST"
                assert call[0][1] == "/v1/shimmers"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return _ok(
                        SHIMMER_READ, method="GET",
                        url="http://test:3100/v1/shimmers/deploy",
                    )

                mock_request.side_effect = _resp
                result = await ShimmersResource(client).get("deploy", "lock")
                assert isinstance(result, ShimmerRead)
                assert result.owner_token is None
                assert mock_request.call_args[1]["params"] == {"recordType": "lock"}
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_acquire_lock_raises_cas_conflict(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        409,
                        json={"error": {"code": "SHIMMER_CAS_CONFLICT", "message": "held"}},
                        request=httpx.Request("POST", "http://test:3100/v1/shimmers"),
                    )

                mock_request.side_effect = _resp
                with pytest.raises(ShimmerCasConflictError):
                    await ShimmersResource(client).acquire_lock(
                        "deploy", AcquireLockParams(owner_token="o", ttl_seconds=60)
                    )
        finally:
            await client.close()
