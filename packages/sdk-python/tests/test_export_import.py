"""Tests for export/import resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.errors import EngramError
from engram.types.export_import import (
    ExportEstimate,
    ExportParams,
    ImportOptions,
    ImportPreview,
    ImportResult,
)
from tests.conftest import make_api_response


# ---------------------------------------------------------------------------
# Helpers for streaming tests
# ---------------------------------------------------------------------------


class _FakeStreamResponse:
    """Minimal context manager that mimics httpx stream response for sync client."""

    def __init__(self, status_code: int = 200, chunks: list[bytes] | None = None,
                 json_body: dict | None = None):
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self._chunks = chunks or []
        self._json_body = json_body

    def read(self):
        pass

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


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------


SAMPLE_EXPORT_ESTIMATE = {
    "knowledgeItems": 100,
    "knowledgeEdges": 50,
    "crystals": 10,
    "crystalMemberships": 200,
    "sessions": 25,
    "sessionNotes": 300,
    "totalEntities": 685,
    "estimatedSizeBytes": 524288,
}

SAMPLE_IMPORT_RESULT = {
    "success": True,
    "counts": {
        "knowledge": {"inserted": 10, "updated": 5, "skipped": 2},
        "crystals": {"inserted": 3, "updated": 1, "skipped": 0},
    },
    "errors": [],
    "duration": 2.5,
}

SAMPLE_IMPORT_PREVIEW = {
    "success": True,
    "schemaVersion": {
        "archive": "1.0.0",
        "current": "1.0.0",
        "migrationRequired": False,
    },
    "counts": {
        "knowledge": {"new": 10, "updated": 5, "skipped": 2},
        "crystals": {"new": 3, "updated": 1, "skipped": 0},
    },
    "conflicts": [],
    "conflictCount": 0,
}


class TestSyncExportImportResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    # -----------------------------------------------------------------------
    # export_data (streaming)
    # -----------------------------------------------------------------------

    @patch.object(httpx.Client, "stream")
    def test_export_data_streams_chunks(self, mock_stream):
        """export_data returns iterator of byte chunks via _request_stream."""
        chunks = [b'{"type":"knowledge"}\n', b'{"type":"crystal"}\n']
        mock_stream.return_value = _FakeStreamResponse(200, chunks=chunks)

        params = ExportParams(scopes=["knowledge", "crystals"])
        result = list(self.client.export_import.export_data(params))

        assert result == chunks
        call_args = mock_stream.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/export" in call_args[0][1]
        body = call_args.kwargs.get("json", {})
        assert body["scopes"] == ["knowledge", "crystals"]

    @patch.object(httpx.Client, "stream")
    def test_export_data_empty_response(self, mock_stream):
        """export_data with no data returns empty iterator."""
        mock_stream.return_value = _FakeStreamResponse(200, chunks=[])

        params = ExportParams(scopes=["sessions"])
        result = list(self.client.export_import.export_data(params))

        assert result == []

    @patch.object(httpx.Client, "stream")
    def test_export_data_error(self, mock_stream):
        """export_data raises EngramError on server error."""
        mock_stream.return_value = _FakeStreamResponse(
            400,
            json_body={"code": "VALIDATION_ERROR", "message": "invalid scopes"},
        )

        params = ExportParams(scopes=["knowledge"])
        with pytest.raises(EngramError, match="invalid scopes"):
            list(self.client.export_import.export_data(params))

    @patch.object(httpx.Client, "stream")
    def test_export_data_with_filters(self, mock_stream):
        """export_data sends filter params in the body."""
        mock_stream.return_value = _FakeStreamResponse(200, chunks=[b"data"])

        params = ExportParams(
            scopes=["knowledge"],
            format="archive",
            compress=False,
        )
        list(self.client.export_import.export_data(params))

        call_args = mock_stream.call_args
        body = call_args.kwargs.get("json", {})
        assert body["format"] == "archive"
        assert body["compress"] is False

    # -----------------------------------------------------------------------
    # estimate_export (JSON)
    # -----------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_estimate_export(self, mock_request):
        """estimate_export returns ExportEstimate via standard _request."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_EXPORT_ESTIMATE),
            request=httpx.Request("POST", "http://test:3100/v1/export/estimate"),
        )

        params = ExportParams(scopes=["knowledge", "crystals"])
        result = self.client.export_import.estimate_export(params)

        assert isinstance(result, ExportEstimate)
        assert result.knowledge_items == 100
        assert result.crystals == 10
        assert result.total_entities == 685
        assert result.estimated_size_bytes == 524288
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/export/estimate" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_estimate_export_error(self, mock_request):
        """estimate_export raises EngramError on failure."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "scopes required"},
            request=httpx.Request("POST", "http://test:3100/v1/export/estimate"),
        )

        params = ExportParams(scopes=["knowledge"])
        with pytest.raises(EngramError, match="scopes required"):
            self.client.export_import.estimate_export(params)

    # -----------------------------------------------------------------------
    # import_data (multipart)
    # -----------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_import_data(self, mock_request):
        """import_data sends multipart with file and options."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_IMPORT_RESULT},
            request=httpx.Request("POST", "http://test:3100/v1/import"),
        )

        options = ImportOptions(on_conflict="skip", wipe=False)
        result = self.client.export_import.import_data(
            file=b'{"sessions":[]}',
            filename="backup.json",
            content_type="application/json",
            options=options,
        )

        assert isinstance(result, ImportResult)
        assert result.success is True
        assert result.counts["knowledge"].inserted == 10
        assert result.duration == 2.5
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/import" in call_args[0][1]
        # Verify multipart structure
        files = call_args.kwargs.get("files", {})
        assert "file" in files
        data = call_args.kwargs.get("data", {})
        assert "options" in data

    @patch.object(httpx.Client, "request")
    def test_import_data_without_options(self, mock_request):
        """import_data works without options (no data form field)."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_IMPORT_RESULT},
            request=httpx.Request("POST", "http://test:3100/v1/import"),
        )

        result = self.client.export_import.import_data(
            file=b"binary-data",
            filename="backup.bin",
            content_type="application/octet-stream",
        )

        assert isinstance(result, ImportResult)
        call_args = mock_request.call_args
        # No data field should be sent
        assert "data" not in call_args.kwargs or call_args.kwargs.get("data") is None

    @patch.object(httpx.Client, "request")
    def test_import_data_options_serialized_as_json_string(self, mock_request):
        """import_data serializes options dict to JSON string for multipart."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_IMPORT_RESULT},
            request=httpx.Request("POST", "http://test:3100/v1/import"),
        )

        options = ImportOptions(on_conflict="overwrite", force=True)
        self.client.export_import.import_data(
            file=b"data",
            filename="backup.json",
            content_type="application/json",
            options=options,
        )

        call_args = mock_request.call_args
        data = call_args.kwargs.get("data", {})
        import json
        parsed = json.loads(data["options"])
        assert parsed["onConflict"] == "overwrite"
        assert parsed["force"] is True

    @patch.object(httpx.Client, "request")
    def test_import_data_error(self, mock_request):
        """import_data raises EngramError on server error."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid file format"},
            request=httpx.Request("POST", "http://test:3100/v1/import"),
        )

        with pytest.raises(EngramError, match="invalid file format"):
            self.client.export_import.import_data(
                file=b"bad",
                filename="bad.txt",
                content_type="text/plain",
            )

    # -----------------------------------------------------------------------
    # preview_import (multipart)
    # -----------------------------------------------------------------------

    @patch.object(httpx.Client, "request")
    def test_preview_import(self, mock_request):
        """preview_import sends multipart and returns ImportPreview."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_IMPORT_PREVIEW},
            request=httpx.Request("POST", "http://test:3100/v1/import/preview"),
        )

        result = self.client.export_import.preview_import(
            file=b'{"sessions":[]}',
            filename="backup.json",
            content_type="application/json",
        )

        assert isinstance(result, ImportPreview)
        assert result.success is True
        assert result.schema_version is not None
        assert result.schema_version.migration_required is False
        assert result.conflict_count == 0
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/import/preview" in call_args[0][1]
        files = call_args.kwargs.get("files", {})
        assert "file" in files

    @patch.object(httpx.Client, "request")
    def test_preview_import_error(self, mock_request):
        """preview_import raises EngramError on server error."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid archive format"},
            request=httpx.Request("POST", "http://test:3100/v1/import/preview"),
        )

        with pytest.raises(EngramError, match="invalid archive format"):
            self.client.export_import.preview_import(
                file=b"bad",
                filename="bad.txt",
                content_type="text/plain",
            )
