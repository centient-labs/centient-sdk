"""Tests for the maintenance resource.

Mirrors the TS resource-test pattern: assert request path/method/body and
response parsing for the BARE (non-enveloped) maintenance response bodies. The
maintenance endpoints return bare objects as of engram-server 0.34 / ADR-022,
so the resource must NOT unwrap a ``data`` envelope — these tests pin that.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import EngramError
from engram.types.maintenance import (
    ChangelogCompactResult,
    MaintenanceParams,
    TombstoneCleanupResult,
    VacuumParams,
    VacuumResult,
)


# Bare (non-enveloped) response bodies — the server does NOT wrap these in
# { data: ... } as of engram-server 0.34 (ADR-022).
BARE_TOMBSTONE = {"deleted": 5, "warnings": ["partial"], "dryRun": False}
BARE_CHANGELOG = {"deleted": 12, "belowSeq": "abc123", "dryRun": True, "reason": "old"}
BARE_VACUUM = {"vacuumed": ["tombstones_a", "tombstones_b"], "full": False}


class TestSyncMaintenanceResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_tombstone_cleanup_parses_bare_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=BARE_TOMBSTONE,
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/tombstone-cleanup"),
        )

        result = self.client.maintenance.tombstone_cleanup(
            MaintenanceParams(days=30, dry_run=False)
        )

        assert isinstance(result, TombstoneCleanupResult)
        assert result.deleted == 5
        assert result.warnings == ["partial"]
        assert result.dry_run is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/maintenance/tombstone-cleanup"
        assert call_args[1]["json"] == {"days": 30, "dryRun": False}

    @patch.object(httpx.Client, "request")
    def test_changelog_compact_parses_bare_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=BARE_CHANGELOG,
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/changelog-compact"),
        )

        result = self.client.maintenance.changelog_compact(MaintenanceParams(days=90))

        assert isinstance(result, ChangelogCompactResult)
        assert result.deleted == 12
        assert result.below_seq == "abc123"
        assert result.dry_run is True
        assert result.reason == "old"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/maintenance/changelog-compact"

    @patch.object(httpx.Client, "request")
    def test_vacuum_parses_bare_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=BARE_VACUUM,
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
        )

        result = self.client.maintenance.vacuum()

        assert isinstance(result, VacuumResult)
        assert result.vacuumed == ["tombstones_a", "tombstones_b"]
        assert result.full is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/maintenance/vacuum"

    @patch.object(httpx.Client, "request")
    def test_vacuum_full_sets_query_param(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"vacuumed": ["t"], "full": True},
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum?full=true"),
        )

        result = self.client.maintenance.vacuum(VacuumParams(full=True))

        assert result.full is True
        call_args = mock_request.call_args
        # The path stays bare; ``full=true`` is passed via httpx's params so the
        # encoding is handled centrally (not hand-concatenated into the path).
        assert call_args[0][1] == "/v1/maintenance/vacuum"
        assert call_args[1]["params"] == {"full": "true"}

    @patch.object(httpx.Client, "request")
    def test_vacuum_default_sends_no_query_params(self, mock_request):
        # No VacuumParams (or full=False) must not send a ``full`` query param —
        # the helper drops falsey/None values rather than emitting ``full=false``.
        mock_request.return_value = httpx.Response(
            200,
            json=BARE_VACUUM,
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
        )

        self.client.maintenance.vacuum()

        # When there's nothing to send, no ``params`` reaches httpx at all.
        assert "params" not in mock_request.call_args[1]

        self.client.maintenance.vacuum(VacuumParams(full=False))

        assert "params" not in mock_request.call_args[1]

    @patch.object(httpx.Client, "request")
    def test_vacuum_rejects_enveloped_body(self, mock_request):
        # An older server (or a contract regression) that wraps the result in
        # the standard { data } envelope must fail loudly, not silently return
        # a model with missing fields.
        mock_request.return_value = httpx.Response(
            200,
            json={"data": BARE_VACUUM},
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
        )

        with pytest.raises(EngramError) as exc_info:
            self.client.maintenance.vacuum()
        assert exc_info.value.code == "INTERNAL_ERROR"
        # The drift error embeds a (truncated) excerpt of the actual body so the
        # mismatch is diagnosable without a packet capture.
        assert "data" in str(exc_info.value)

    @patch.object(httpx.Client, "request")
    def test_contract_drift_error_truncates_oversized_body(self, mock_request):
        # A huge unexpected body must not be dumped verbatim into the error.
        oversized = {"data": {"junk": "x" * 5000}}
        mock_request.return_value = httpx.Response(
            200,
            json=oversized,
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
        )

        with pytest.raises(EngramError) as exc_info:
            self.client.maintenance.vacuum()
        message = str(exc_info.value)
        assert "(truncated)" in message
        # The full 5000-char payload must not leak into the message.
        assert "x" * 5000 not in message

    @patch.object(httpx.Client, "request")
    def test_tombstone_cleanup_rejects_enveloped_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": BARE_TOMBSTONE},
            request=httpx.Request("POST", "http://test:3100/v1/maintenance/tombstone-cleanup"),
        )

        with pytest.raises(EngramError) as exc_info:
            self.client.maintenance.tombstone_cleanup()
        assert exc_info.value.code == "INTERNAL_ERROR"


class TestAsyncMaintenanceResource:
    @pytest.mark.asyncio
    async def test_async_vacuum_parses_bare_body(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=BARE_VACUUM,
                        request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
                    )

                mock_request.side_effect = _resp
                result = await client.maintenance.vacuum()
                assert isinstance(result, VacuumResult)
                assert result.vacuumed == ["tombstones_a", "tombstones_b"]
                call_args = mock_request.call_args
                assert call_args[0][0] == "POST"
                assert call_args[0][1] == "/v1/maintenance/vacuum"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_vacuum_rejects_enveloped_body(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json={"data": BARE_VACUUM},
                        request=httpx.Request("POST", "http://test:3100/v1/maintenance/vacuum"),
                    )

                mock_request.side_effect = _resp
                with pytest.raises(EngramError) as exc_info:
                    await client.maintenance.vacuum()
                assert exc_info.value.code == "INTERNAL_ERROR"
        finally:
            await client.close()
