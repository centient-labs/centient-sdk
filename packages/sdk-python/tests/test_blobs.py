"""Tests for blobs resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.errors import EngramError, NotFoundError
from engram.types.blobs import BlobMetadata, BlobUploadResponse, BlobReference, GcResult
from tests.conftest import make_api_response


SAMPLE_BLOB_UPLOAD = {
    "id": "blob-001",
    "checksum": "sha256:abc123",
    "mimeType": "image/png",
    "sizeBytes": 1024,
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_BLOB_METADATA = {
    "id": "blob-001",
    "checksum": "sha256:abc123",
    "mimeType": "image/png",
    "sizeBytes": 1024,
    "storagePath": "/storage/blobs/blob-001",
    "referenceCount": 2,
    "createdAt": "2026-01-01T00:00:00Z",
    "lastAccessedAt": "2026-01-15T00:00:00Z",
}


class TestSyncBlobsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_upload(self, mock_request):
        """Upload sends binary via _request_raw and returns BlobUploadResponse."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_BLOB_UPLOAD},
            request=httpx.Request("POST", "http://test:3100/v1/blobs"),
        )

        result = self.client.blobs.upload(b"\x89PNG\r\n", mime_type="image/png")

        assert isinstance(result, BlobUploadResponse)
        assert result.id == "blob-001"
        assert result.checksum == "sha256:abc123"
        assert result.size_bytes == 1024
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "POST"
        assert "/v1/blobs" in call_kwargs[0][1]
        assert call_kwargs.kwargs["headers"]["Content-Type"] == "image/png"

    @patch.object(httpx.Client, "request")
    def test_upload_default_mime_type(self, mock_request):
        """Upload uses application/octet-stream by default."""
        mock_request.return_value = httpx.Response(
            200,
            json={"data": SAMPLE_BLOB_UPLOAD},
            request=httpx.Request("POST", "http://test:3100/v1/blobs"),
        )

        self.client.blobs.upload(b"binary-data")

        call_kwargs = mock_request.call_args
        assert call_kwargs.kwargs["headers"]["Content-Type"] == "application/octet-stream"

    @patch.object(httpx.Client, "request")
    def test_download(self, mock_request):
        """Download returns raw bytes via _request_raw."""
        mock_request.return_value = httpx.Response(
            200,
            content=b"\x89PNG\r\nimage-data",
            request=httpx.Request("GET", "http://test:3100/v1/blobs/blob-001"),
        )

        result = self.client.blobs.download("blob-001")

        assert isinstance(result, bytes)
        assert result == b"\x89PNG\r\nimage-data"
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "GET"
        assert "/v1/blobs/blob-001" in call_kwargs[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_metadata(self, mock_request):
        """Get metadata returns BlobMetadata."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_BLOB_METADATA),
            request=httpx.Request("GET", "http://test:3100/v1/blobs/blob-001/metadata"),
        )

        result = self.client.blobs.get_metadata("blob-001")

        assert isinstance(result, BlobMetadata)
        assert result.id == "blob-001"
        assert result.mime_type == "image/png"
        assert result.size_bytes == 1024
        assert result.reference_count == 2
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "GET"
        assert "/v1/blobs/blob-001/metadata" in call_kwargs[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_metadata_not_found(self, mock_request):
        """Get metadata returns None on 404."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "blob not found"},
            request=httpx.Request("GET", "http://test:3100/v1/blobs/missing/metadata"),
        )

        result = self.client.blobs.get_metadata("missing")

        assert result is None

    @patch.object(httpx.Client, "request")
    def test_delete(self, mock_request):
        """Delete sends DELETE request."""
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/blobs/blob-001"),
        )

        self.client.blobs.delete("blob-001")

        mock_request.assert_called_once()
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "DELETE"
        assert "/v1/blobs/blob-001" in call_kwargs[0][1]

    @patch.object(httpx.Client, "request")
    def test_add_reference(self, mock_request):
        """Add reference returns BlobReference."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"added": True}),
            request=httpx.Request("POST", "http://test:3100/v1/blobs/blob-001/reference"),
        )

        result = self.client.blobs.add_reference("blob-001")

        assert isinstance(result, BlobReference)
        assert result.added is True
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "POST"
        assert "/v1/blobs/blob-001/reference" in call_kwargs[0][1]

    @patch.object(httpx.Client, "request")
    def test_gc(self, mock_request):
        """GC returns GcResult with deleted count."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"deleted": 5}),
            request=httpx.Request("POST", "http://test:3100/v1/blobs/gc"),
        )

        result = self.client.blobs.gc()

        assert isinstance(result, GcResult)
        assert result.deleted == 5
        call_kwargs = mock_request.call_args
        assert call_kwargs[0][0] == "POST"
        assert "/v1/blobs/gc" in call_kwargs[0][1]

    @patch.object(httpx.Client, "request")
    def test_upload_error(self, mock_request):
        """Upload raises EngramError on server error."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid content type"},
            request=httpx.Request("POST", "http://test:3100/v1/blobs"),
        )

        with pytest.raises(EngramError, match="invalid content type"):
            self.client.blobs.upload(b"data", mime_type="invalid/type")

    @patch.object(httpx.Client, "request")
    def test_delete_error(self, mock_request):
        """Delete raises NotFoundError on 404."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "blob not found"},
            request=httpx.Request("DELETE", "http://test:3100/v1/blobs/missing"),
        )

        with pytest.raises(NotFoundError, match="blob not found"):
            self.client.blobs.delete("missing")
