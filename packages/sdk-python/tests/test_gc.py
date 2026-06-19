"""Tests for the GC (garbage collection) resource.

Mirrors the TS resource-test pattern: assert request path/method/body/query and
response parsing. The GC endpoints use the standard ``{ data, meta }`` envelope;
``get_candidates``/``get_audit_log`` fold ``meta.pagination.hasMore`` into the
returned result model, and ``run`` unwraps ``data``.

The ``gc`` resource is not (yet) wired onto the client, so these tests
instantiate the resource directly against a real client (whose transport is
mocked), exactly mirroring how the resource is used in production.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.resources.gc import GcResource, SyncGcResource
from engram.types.gc import (
    GcAuditResult,
    GcCandidatesResult,
    GcRunOptions,
    GcRunResult,
    ListGcAuditParams,
    ListGcCandidatesParams,
)


SAMPLE_CANDIDATE = {
    "id": "kc-1",
    "title": "Stale Crystal",
    "nodeType": "pattern",
    "relevanceScore": 0.12,
    "accessCount": 3,
    "lastAccessedAt": None,
    "createdAt": "2026-01-01T00:00:00Z",
    "verified": False,
    "lifecycleStatus": "active",
}

SAMPLE_AUDIT_ENTRY = {
    "id": "gc-run-1",
    "runAt": "2026-01-02T00:00:00Z",
    "decayCurve": "exponential",
    "threshold": 0.2,
    "scannedCrystals": 100,
    "archivedCrystals": 5,
    "scannedNotes": 200,
    "archivedNotes": 10,
    "dryRun": True,
    "details": {"note": "preview only"},
}

SAMPLE_RUN_RESULT = {
    "scannedCrystals": 100,
    "archivedCrystals": 5,
    "scannedNotes": 200,
    "archivedNotes": 10,
    "dryRun": False,
}

CANDIDATES_ENVELOPE = {
    "data": {"candidates": [SAMPLE_CANDIDATE], "threshold": 0.2, "total": 1},
    "meta": {"pagination": {"total": 1, "limit": 20, "offset": 0, "hasMore": True}},
}

AUDIT_ENVELOPE = {
    "data": {"entries": [SAMPLE_AUDIT_ENTRY], "total": 1},
    "meta": {"pagination": {"total": 1, "limit": 20, "offset": 0, "hasMore": False}},
}

RUN_ENVELOPE = {"data": SAMPLE_RUN_RESULT}


class TestSyncGcResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.gc = SyncGcResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_get_candidates_parses_and_folds_has_more(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=CANDIDATES_ENVELOPE,
            request=httpx.Request("GET", "http://test:3100/v1/gc/candidates"),
        )

        result = self.gc.get_candidates(
            ListGcCandidatesParams(threshold=0.2, limit=50, offset=0)
        )

        assert isinstance(result, GcCandidatesResult)
        assert result.threshold == 0.2
        assert result.total == 1
        assert result.has_more is True
        assert len(result.candidates) == 1
        assert result.candidates[0].id == "kc-1"
        assert result.candidates[0].node_type == "pattern"
        assert result.candidates[0].relevance_score == 0.12
        assert result.candidates[0].last_accessed_at is None

        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/gc/candidates"
        assert call_args[1]["params"] == {
            "threshold": "0.2",
            "limit": "50",
            "offset": "0",
        }

    @patch.object(httpx.Client, "request")
    def test_get_candidates_default_sends_no_query_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=CANDIDATES_ENVELOPE,
            request=httpx.Request("GET", "http://test:3100/v1/gc/candidates"),
        )

        self.gc.get_candidates()

        # No params => the client omits the ``params`` kwarg entirely.
        assert "params" not in mock_request.call_args[1]

    @patch.object(httpx.Client, "request")
    def test_get_candidates_defaults_has_more_false_without_meta(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"candidates": [], "threshold": 0.5, "total": 0}},
            request=httpx.Request("GET", "http://test:3100/v1/gc/candidates"),
        )

        result = self.gc.get_candidates()

        assert result.has_more is False
        assert result.candidates == []

    @patch.object(httpx.Client, "request")
    def test_get_audit_log_parses_and_folds_has_more(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=AUDIT_ENVELOPE,
            request=httpx.Request("GET", "http://test:3100/v1/gc/audit"),
        )

        result = self.gc.get_audit_log(ListGcAuditParams(limit=10, offset=5))

        assert isinstance(result, GcAuditResult)
        assert result.total == 1
        assert result.has_more is False
        assert len(result.entries) == 1
        entry = result.entries[0]
        assert entry.id == "gc-run-1"
        assert entry.decay_curve == "exponential"
        assert entry.scanned_crystals == 100
        assert entry.dry_run is True
        assert entry.details == {"note": "preview only"}

        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/gc/audit"
        assert call_args[1]["params"] == {"limit": "10", "offset": "5"}

    @patch.object(httpx.Client, "request")
    def test_get_audit_log_default_sends_no_query_params(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=AUDIT_ENVELOPE,
            request=httpx.Request("GET", "http://test:3100/v1/gc/audit"),
        )

        self.gc.get_audit_log()

        # No params => the client omits the ``params`` kwarg entirely.
        assert "params" not in mock_request.call_args[1]

    @patch.object(httpx.Client, "request")
    def test_run_unwraps_data_and_sends_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=RUN_ENVELOPE,
            request=httpx.Request("POST", "http://test:3100/v1/gc/run"),
        )

        result = self.gc.run(GcRunOptions(dry_run=True))

        assert isinstance(result, GcRunResult)
        assert result.scanned_crystals == 100
        assert result.archived_notes == 10
        assert result.dry_run is False

        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/gc/run"
        assert call_args[1]["json"] == {"dryRun": True}

    @patch.object(httpx.Client, "request")
    def test_run_without_options_sends_no_body(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=RUN_ENVELOPE,
            request=httpx.Request("POST", "http://test:3100/v1/gc/run"),
        )

        result = self.gc.run()

        assert isinstance(result, GcRunResult)
        # No options => the client omits the ``json`` kwarg entirely.
        assert "json" not in mock_request.call_args[1]


class TestAsyncGcResource:
    @pytest.mark.asyncio
    async def test_async_get_candidates(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        gc = GcResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=CANDIDATES_ENVELOPE,
                        request=httpx.Request(
                            "GET", "http://test:3100/v1/gc/candidates"
                        ),
                    )

                mock_request.side_effect = _resp
                result = await gc.get_candidates(
                    ListGcCandidatesParams(threshold=0.2)
                )
                assert isinstance(result, GcCandidatesResult)
                assert result.has_more is True
                assert result.candidates[0].id == "kc-1"
                call_args = mock_request.call_args
                assert call_args[0][0] == "GET"
                assert call_args[0][1] == "/v1/gc/candidates"
                assert call_args[1]["params"] == {"threshold": "0.2"}
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get_audit_log(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        gc = GcResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=AUDIT_ENVELOPE,
                        request=httpx.Request("GET", "http://test:3100/v1/gc/audit"),
                    )

                mock_request.side_effect = _resp
                result = await gc.get_audit_log()
                assert isinstance(result, GcAuditResult)
                assert result.entries[0].id == "gc-run-1"
                assert result.has_more is False
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_run(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        gc = GcResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json=RUN_ENVELOPE,
                        request=httpx.Request("POST", "http://test:3100/v1/gc/run"),
                    )

                mock_request.side_effect = _resp
                result = await gc.run(GcRunOptions(dry_run=True))
                assert isinstance(result, GcRunResult)
                assert result.scanned_crystals == 100
                call_args = mock_request.call_args
                assert call_args[0][0] == "POST"
                assert call_args[0][1] == "/v1/gc/run"
                assert call_args[1]["json"] == {"dryRun": True}
        finally:
            await client.close()
