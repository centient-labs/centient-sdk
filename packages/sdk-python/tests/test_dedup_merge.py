"""Tests for the P11 dedup / deferred-merge review surface.

Covers ``crystals.pending_merges`` / ``review_merge`` / ``merge_history`` and
``notes.dedup``. These routes return **bare** (non-enveloped) bodies, so the
tests pin that the resources do NOT unwrap a ``data`` envelope and that a
contract drift fails loudly.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import EngramError
from engram.types.dedup_merge import (
    DedupNoteParams,
    DedupNoteResult,
    ListPendingMergesParams,
    MergeRecord,
    PendingMerge,
    ReviewMergeParams,
    ReviewMergeResult,
)

PENDING = {
    "mergeId": "m-1",
    "sourceId": "note-1",
    "targetId": "kc-1",
    "sourceType": "session_note",
    "targetType": "knowledge_crystal",
    "confidence": 0.91,
    "mergeMethod": "semantic",
    "mergeOutcomeStrategy": "oldest_wins",
    "createdAt": "2026-01-01T00:00:00Z",
}

MERGE_RECORD = {
    "id": "mr-1",
    "sourceNoteId": "note-1",
    "sourceCrystalId": None,
    "targetCrystalId": "kc-1",
    "mergeMethod": "semantic",
    "mergeOutcomeStrategy": "oldest_wins",
    "similarityScore": 0.9,
    "mergeReason": "duplicate",
    "mergedContentSnapshot": {"title": "x"},
    "mergedBy": "agent-1",
    "mergedAt": "2026-01-01T00:00:00Z",
    "reversible": True,
    "reverseRecordId": None,
    "createdAt": "2026-01-01T00:00:00Z",
}


def _resp(json_data, status_code=200, method="GET", url="http://test:3100/x"):
    return httpx.Response(status_code, json=json_data, request=httpx.Request(method, url))


class TestSyncPendingMerges:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_pending_merges_bare_body(self, mock_request):
        mock_request.return_value = _resp({"success": True, "pending": [PENDING], "total": 1})
        result = self.client.crystals.pending_merges(ListPendingMergesParams(limit=50))
        assert result["total"] == 1
        assert isinstance(result["pending"][0], PendingMerge)
        assert result["pending"][0].merge_id == "m-1"
        call = mock_request.call_args
        assert call[0][1] == "/v1/crystals/merges/pending"
        assert call[1]["params"] == {"limit": "50"}

    @patch.object(httpx.Client, "request")
    def test_pending_merges_rejects_enveloped_body(self, mock_request):
        mock_request.return_value = _resp({"data": {"pending": [PENDING], "total": 1}})
        with pytest.raises(EngramError) as exc:
            self.client.crystals.pending_merges()
        assert exc.value.code == "INTERNAL_ERROR"

    @patch.object(httpx.Client, "request")
    def test_pending_merges_rejects_missing_total(self, mock_request):
        mock_request.return_value = _resp({"success": True, "pending": [PENDING]})
        with pytest.raises(EngramError):
            self.client.crystals.pending_merges()

    @patch.object(httpx.Client, "request")
    def test_review_merge_approve(self, mock_request):
        mock_request.return_value = _resp(
            {"success": True, "decision": "approve", "targetCrystalId": "kc-1"},
            method="POST",
        )
        result = self.client.crystals.review_merge(
            "m-1", ReviewMergeParams(decision="approve")
        )
        assert isinstance(result, ReviewMergeResult)
        assert result.decision == "approve"
        assert result.target_crystal_id == "kc-1"
        call = mock_request.call_args
        assert call[0][1] == "/v1/crystals/merges/m-1/review"
        assert call[1]["json"] == {"decision": "approve"}

    @patch.object(httpx.Client, "request")
    def test_review_merge_modify_sends_snake_case_content(self, mock_request):
        mock_request.return_value = _resp(
            {"success": True, "decision": "modify", "targetCrystalId": "kc-1"},
            method="POST",
        )
        self.client.crystals.review_merge(
            "m-1", ReviewMergeParams(decision="modify", merged_content="merged text")
        )
        assert mock_request.call_args[1]["json"] == {
            "decision": "modify",
            "merged_content": "merged text",
        }

    @patch.object(httpx.Client, "request")
    def test_review_merge_reject_empty_target_normalized_to_none(self, mock_request):
        # On reject the server returns targetCrystalId="" (or omits it); the SDK
        # normalizes a falsy-but-present value to None.
        mock_request.return_value = _resp(
            {"success": True, "decision": "reject", "targetCrystalId": ""},
            method="POST",
        )
        result = self.client.crystals.review_merge(
            "m-1", ReviewMergeParams(decision="reject")
        )
        assert result.target_crystal_id is None

    @patch.object(httpx.Client, "request")
    def test_merge_history_bare_body(self, mock_request):
        mock_request.return_value = _resp(
            {"success": True, "id": "kc-1", "merge_chain": [MERGE_RECORD], "total": 1}
        )
        result = self.client.crystals.merge_history("kc-1")
        assert result["id"] == "kc-1"
        assert result["total"] == 1
        assert isinstance(result["merge_chain"][0], MergeRecord)
        assert result["merge_chain"][0].target_crystal_id == "kc-1"
        assert mock_request.call_args[0][1] == "/v1/crystals/merges/history/kc-1"

    @patch.object(httpx.Client, "request")
    def test_merge_history_rejects_enveloped_body(self, mock_request):
        mock_request.return_value = _resp({"data": {"id": "kc-1", "merge_chain": [], "total": 0}})
        with pytest.raises(EngramError):
            self.client.crystals.merge_history("kc-1")


class TestSyncNotesDedup:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_dedup_merged(self, mock_request):
        mock_request.return_value = _resp(
            {"action": "merged", "merge_id": "m-1", "confidence": 0.9, "canonical_id": "kc-1"},
            method="POST",
        )
        result = self.client.notes.dedup("note-1")
        assert isinstance(result, DedupNoteResult)
        assert result.action == "merged"
        assert result.merge_id == "m-1"
        assert result.canonical_id == "kc-1"
        assert mock_request.call_args[0][1] == "/v1/notes/note-1/dedup"

    @patch.object(httpx.Client, "request")
    def test_dedup_no_match_all_none(self, mock_request):
        mock_request.return_value = _resp(
            {"action": "no_match", "merge_id": None, "confidence": None, "canonical_id": None},
            method="POST",
        )
        result = self.client.notes.dedup("note-1")
        assert result.action == "no_match"
        assert result.merge_id is None
        assert result.confidence is None

    @patch.object(httpx.Client, "request")
    def test_dedup_sends_snake_case_body(self, mock_request):
        mock_request.return_value = _resp(
            {"action": "deferred", "merge_id": "m-1", "confidence": 0.8, "canonical_id": None},
            method="POST",
        )
        self.client.notes.dedup(
            "note-1", DedupNoteParams(merge_method="semantic", threshold=0.85)
        )
        assert mock_request.call_args[1]["json"] == {
            "merge_method": "semantic",
            "threshold": 0.85,
        }

    @patch.object(httpx.Client, "request")
    def test_dedup_rejects_enveloped_body(self, mock_request):
        mock_request.return_value = _resp({"data": {"action": "merged"}}, method="POST")
        with pytest.raises(EngramError) as exc:
            self.client.notes.dedup("note-1")
        assert exc.value.code == "INTERNAL_ERROR"


class TestAsyncDedupMerge:
    @pytest.mark.asyncio
    async def test_async_pending_merges(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*a, **k):
                    return _resp({"success": True, "pending": [PENDING], "total": 1})

                mock_request.side_effect = _r
                result = await client.crystals.pending_merges()
                assert result["pending"][0].source_type == "session_note"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_notes_dedup(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*a, **k):
                    return _resp(
                        {"action": "merged", "merge_id": "m-1", "confidence": 0.9, "canonical_id": "kc-1"},
                        method="POST",
                    )

                mock_request.side_effect = _r
                result = await client.notes.dedup("note-1")
                assert result.action == "merged"
        finally:
            await client.close()
