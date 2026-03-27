"""Export/Import resources for the Engram SDK."""
from __future__ import annotations

import json
from typing import AsyncIterator, Iterator, TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.types.export_import import (
    ExportEstimate,
    ExportParams,
    ImportOptions,
    ImportPreview,
    ImportResult,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class ExportImportResource(BaseResource):
    """Async resource for export/import operations."""

    async def export_data(self, params: ExportParams) -> AsyncIterator[bytes]:
        """Export data as a stream of byte chunks.

        Args:
            params: Export parameters specifying scopes, filters, and format.

        Returns:
            Async iterator of byte chunks from the export stream.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        async for chunk in self._client._request_stream("POST", "/v1/export", body):
            yield chunk

    async def estimate_export(self, params: ExportParams) -> ExportEstimate:
        """Estimate export size without performing the export.

        Args:
            params: Export parameters specifying scopes, filters, and format.

        Returns:
            Estimated entity counts and byte size.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/export/estimate", body)
        return ExportEstimate.model_validate(response["data"])

    async def import_data(
        self,
        file: bytes,
        filename: str,
        content_type: str,
        options: ImportOptions | None = None,
    ) -> ImportResult:
        """Import data from a file.

        Args:
            file: Raw bytes of the import file.
            filename: Name of the file being imported.
            content_type: MIME type of the file.
            options: Import options (conflict resolution, wipe, etc.).

        Returns:
            Result of the import operation.
        """
        files = {"file": (filename, file, content_type)}
        data: dict[str, str] | None = None
        if options is not None:
            data = {
                "options": json.dumps(
                    options.model_dump(by_alias=True, exclude_none=True)
                )
            }
        response = await self._client._request_multipart(
            "POST", "/v1/import", files, data
        )
        return ImportResult.model_validate(response["data"])

    async def preview_import(
        self,
        file: bytes,
        filename: str,
        content_type: str,
    ) -> ImportPreview:
        """Preview an import without applying changes.

        Args:
            file: Raw bytes of the import file.
            filename: Name of the file being previewed.
            content_type: MIME type of the file.

        Returns:
            Preview showing what would be imported.
        """
        files = {"file": (filename, file, content_type)}
        response = await self._client._request_multipart(
            "POST", "/v1/import/preview", files
        )
        return ImportPreview.model_validate(response["data"])


class SyncExportImportResource(SyncBaseResource):
    """Sync resource for export/import operations."""

    def export_data(self, params: ExportParams) -> Iterator[bytes]:
        """Export data as a stream of byte chunks.

        Args:
            params: Export parameters specifying scopes, filters, and format.

        Returns:
            Iterator of byte chunks from the export stream.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        yield from self._client._request_stream("POST", "/v1/export", body)

    def estimate_export(self, params: ExportParams) -> ExportEstimate:
        """Estimate export size without performing the export.

        Args:
            params: Export parameters specifying scopes, filters, and format.

        Returns:
            Estimated entity counts and byte size.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/export/estimate", body)
        return ExportEstimate.model_validate(response["data"])

    def import_data(
        self,
        file: bytes,
        filename: str,
        content_type: str,
        options: ImportOptions | None = None,
    ) -> ImportResult:
        """Import data from a file.

        Args:
            file: Raw bytes of the import file.
            filename: Name of the file being imported.
            content_type: MIME type of the file.
            options: Import options (conflict resolution, wipe, etc.).

        Returns:
            Result of the import operation.
        """
        files = {"file": (filename, file, content_type)}
        data: dict[str, str] | None = None
        if options is not None:
            data = {
                "options": json.dumps(
                    options.model_dump(by_alias=True, exclude_none=True)
                )
            }
        response = self._client._request_multipart(
            "POST", "/v1/import", files, data
        )
        return ImportResult.model_validate(response["data"])

    def preview_import(
        self,
        file: bytes,
        filename: str,
        content_type: str,
    ) -> ImportPreview:
        """Preview an import without applying changes.

        Args:
            file: Raw bytes of the import file.
            filename: Name of the file being previewed.
            content_type: MIME type of the file.

        Returns:
            Preview showing what would be imported.
        """
        files = {"file": (filename, file, content_type)}
        response = self._client._request_multipart(
            "POST", "/v1/import/preview", files
        )
        return ImportPreview.model_validate(response["data"])
