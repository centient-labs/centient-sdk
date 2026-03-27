"""Blobs resources for the Engram SDK."""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError
from engram.types.blobs import (
    BlobMetadata,
    BlobUploadResponse,
    BlobReference,
    GcResult,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class BlobsResource(BaseResource):
    """Async resource for blob storage operations."""

    async def upload(
        self,
        content: bytes,
        mime_type: str = "application/octet-stream",
    ) -> BlobUploadResponse:
        """Upload blob content.

        Args:
            content: Raw bytes to upload.
            mime_type: MIME type of the content. Defaults to ``application/octet-stream``.

        Returns:
            Upload response with blob id, checksum, mimeType, sizeBytes, createdAt.
        """
        response = await self._client._request_raw(
            "POST", "/v1/blobs", content=content, content_type=mime_type
        )
        data = response.json()
        return BlobUploadResponse.model_validate(data["data"])

    async def download(self, blob_id: str) -> bytes:
        """Download blob content by ID.

        Args:
            blob_id: The blob identifier.

        Returns:
            Raw bytes of the blob content.
        """
        response = await self._client._request_raw(
            "GET", f"/v1/blobs/{blob_id}"
        )
        return response.content

    async def get_metadata(self, blob_id: str) -> Optional[BlobMetadata]:
        """Get blob metadata by ID.

        Returns None if the blob is not found (404).

        Args:
            blob_id: The blob identifier.
        """
        try:
            response = await self._request("GET", f"/v1/blobs/{blob_id}/metadata")
            return BlobMetadata.model_validate(response["data"])
        except EngramError as exc:
            if exc.status_code == 404:
                return None
            raise

    async def delete(self, blob_id: str) -> None:
        """Delete a blob (decrements reference count).

        Args:
            blob_id: The blob identifier.
        """
        await self._request("DELETE", f"/v1/blobs/{blob_id}")

    async def add_reference(self, blob_id: str) -> BlobReference:
        """Increment the reference count for a blob.

        Args:
            blob_id: The blob identifier.

        Returns:
            BlobReference with added=True on success.
        """
        response = await self._request("POST", f"/v1/blobs/{blob_id}/reference")
        return BlobReference.model_validate(response["data"])

    async def gc(self) -> GcResult:
        """Run garbage collection to delete unreferenced blobs.

        Returns:
            GcResult with the count of deleted blobs.
        """
        response = await self._request("POST", "/v1/blobs/gc")
        return GcResult.model_validate(response["data"])


class SyncBlobsResource(SyncBaseResource):
    """Sync resource for blob storage operations."""

    def upload(
        self,
        content: bytes,
        mime_type: str = "application/octet-stream",
    ) -> BlobUploadResponse:
        """Upload blob content.

        Args:
            content: Raw bytes to upload.
            mime_type: MIME type of the content. Defaults to ``application/octet-stream``.

        Returns:
            Upload response with blob id, checksum, mimeType, sizeBytes, createdAt.
        """
        response = self._client._request_raw(
            "POST", "/v1/blobs", content=content, content_type=mime_type
        )
        data = response.json()
        return BlobUploadResponse.model_validate(data["data"])

    def download(self, blob_id: str) -> bytes:
        """Download blob content by ID.

        Args:
            blob_id: The blob identifier.

        Returns:
            Raw bytes of the blob content.
        """
        response = self._client._request_raw(
            "GET", f"/v1/blobs/{blob_id}"
        )
        return response.content

    def get_metadata(self, blob_id: str) -> Optional[BlobMetadata]:
        """Get blob metadata by ID.

        Returns None if the blob is not found (404).

        Args:
            blob_id: The blob identifier.
        """
        try:
            response = self._request("GET", f"/v1/blobs/{blob_id}/metadata")
            return BlobMetadata.model_validate(response["data"])
        except EngramError as exc:
            if exc.status_code == 404:
                return None
            raise

    def delete(self, blob_id: str) -> None:
        """Delete a blob (decrements reference count).

        Args:
            blob_id: The blob identifier.
        """
        self._request("DELETE", f"/v1/blobs/{blob_id}")

    def add_reference(self, blob_id: str) -> BlobReference:
        """Increment the reference count for a blob.

        Args:
            blob_id: The blob identifier.

        Returns:
            BlobReference with added=True on success.
        """
        response = self._request("POST", f"/v1/blobs/{blob_id}/reference")
        return BlobReference.model_validate(response["data"])

    def gc(self) -> GcResult:
        """Run garbage collection to delete unreferenced blobs.

        Returns:
            GcResult with the count of deleted blobs.
        """
        response = self._request("POST", "/v1/blobs/gc")
        return GcResult.model_validate(response["data"])
