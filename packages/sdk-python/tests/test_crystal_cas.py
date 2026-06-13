"""Tests for crystal optimistic-concurrency (CAS) — expected_version / 409.

Mirrors the TS SDK semantics (packages/sdk/src/errors.ts:197): a 409 carrying
error code ``OPERATION_VERSION_CONFLICT`` is routed to the typed
``CrystalVersionConflictError`` (carrying the server-reported current version),
distinct from the generic 409 ``SessionExistsError``. Also pins that
``expected_version`` and ``skip_embedding`` serialize to the wire fields the
server expects (``expectedVersion`` / ``skipEmbedding``).
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import EngramClient
from engram.errors import (
    CrystalVersionConflictError,
    EngramError,
    SessionExistsError,
    parse_api_error,
)
from engram.types.knowledge_crystal import (
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
)
from tests.conftest import SAMPLE_CRYSTAL, make_api_response


class TestParseCasConflict:
    def test_flat_409_conflict_raises_typed_error(self):
        body = {
            "code": "OPERATION_VERSION_CONFLICT",
            "message": "version mismatch",
            "currentVersion": 7,
        }
        with pytest.raises(CrystalVersionConflictError) as exc_info:
            parse_api_error(409, body)
        err = exc_info.value
        assert err.current_version == 7
        assert err.code == "OPERATION_VERSION_CONFLICT"
        assert err.status_code == 409

    def test_nested_409_conflict_raises_typed_error(self):
        body = {
            "error": {
                "code": "OPERATION_VERSION_CONFLICT",
                "message": "version mismatch",
                "details": {"currentVersion": 9},
            }
        }
        with pytest.raises(CrystalVersionConflictError) as exc_info:
            parse_api_error(409, body)
        assert exc_info.value.current_version == 9

    def test_conflict_without_current_version_still_typed(self):
        body = {"code": "OPERATION_VERSION_CONFLICT", "message": "mismatch"}
        with pytest.raises(CrystalVersionConflictError) as exc_info:
            parse_api_error(409, body)
        assert exc_info.value.current_version is None

    def test_generic_409_still_session_exists(self):
        # A non-CAS 409 must remain the generic SessionExistsError so the two
        # 409 cases stay distinguishable.
        body = {"code": "SESSION_EXISTS", "message": "already exists"}
        with pytest.raises(SessionExistsError):
            parse_api_error(409, body)

    def test_conflict_is_subclass_of_engram_error(self):
        err = CrystalVersionConflictError("x", current_version=2)
        assert isinstance(err, EngramError)


class TestCrystalUpdateCasWire:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_update_serializes_expected_version_and_skip_embedding(self, mock_request):
        updated = {**SAMPLE_CRYSTAL, "title": "New"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(updated),
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/crystal-201"),
        )

        self.client.crystals.update(
            "crystal-201",
            UpdateKnowledgeCrystalParams(
                title="New", expected_version=3, skip_embedding=True
            ),
        )

        call_args = mock_request.call_args
        assert call_args[0][0] == "PATCH"
        assert call_args[0][1] == "/v1/crystals/crystal-201"
        sent = call_args[1]["json"]
        assert sent["expectedVersion"] == 3
        assert sent["skipEmbedding"] is True
        assert sent["title"] == "New"

    @patch.object(httpx.Client, "request")
    def test_update_with_conflict_raises_typed_error(self, mock_request):
        mock_request.return_value = httpx.Response(
            409,
            json={
                "code": "OPERATION_VERSION_CONFLICT",
                "message": "version mismatch",
                "currentVersion": 5,
            },
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/crystal-201"),
        )

        with pytest.raises(CrystalVersionConflictError) as exc_info:
            self.client.crystals.update(
                "crystal-201",
                UpdateKnowledgeCrystalParams(title="New", expected_version=3),
            )
        assert exc_info.value.current_version == 5
        # A 4xx must NOT be retried — exactly one fetch attempt.
        mock_request.assert_called_once()

    @patch.object(httpx.Client, "request")
    def test_explicit_skip_embedding_false_is_sent(self, mock_request):
        # Mirrors TS: an explicit `false` is forwarded on the wire (an explicit
        # caller signal), while omitting the field (None) drops it.
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL),
            request=httpx.Request("PATCH", "http://test:3100/v1/crystals/crystal-201"),
        )

        self.client.crystals.update(
            "crystal-201",
            UpdateKnowledgeCrystalParams(title="New", skip_embedding=False),
        )
        sent = mock_request.call_args[1]["json"]
        assert sent["skipEmbedding"] is False

    @patch.object(httpx.Client, "request")
    def test_create_serializes_skip_embedding(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL),
            request=httpx.Request("POST", "http://test:3100/v1/crystals"),
        )

        self.client.crystals.create(
            CreateKnowledgeCrystalParams(
                node_type="note", title="t", skip_embedding=True
            )
        )
        sent = mock_request.call_args[1]["json"]
        assert sent["skipEmbedding"] is True
        assert sent["nodeType"] == "note"
