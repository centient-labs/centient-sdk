"""Terrafirma resources for the Engram SDK (ADR-049)."""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError
from engram.types.terrafirma import (
    MigrationCurrentStatus,
    MigrationStartResult,
    StartMigrationOptions,
    SyncResult,
    TerrafirmaFileInfo,
    TerrafirmaStatus,
    TriggerSyncOptions,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class TerrafirmaResource(BaseResource):
    """Async resource for terrafirma filesystem sync operations."""

    async def get_status(self) -> TerrafirmaStatus:
        """Get sync status overview."""
        response = await self._request("GET", "/v1/terrafirma/status")
        return TerrafirmaStatus.model_validate(response["data"])

    async def get_file_info(self, file_path: str) -> Optional[TerrafirmaFileInfo]:
        """Get detailed sync state for a specific file.

        Returns None if no bridge row exists (404).
        """
        try:
            encoded = quote(file_path, safe="")
            response = await self._request(
                "GET", f"/v1/terrafirma/files/{encoded}"
            )
            return TerrafirmaFileInfo.model_validate(response["data"])
        except EngramError as exc:
            if exc.status_code == 404:
                return None
            raise

    async def get_migration_status(self) -> MigrationCurrentStatus:
        """Get current or most recent migration status."""
        response = await self._request(
            "GET", "/v1/terrafirma/migrations/current"
        )
        return MigrationCurrentStatus.model_validate(response["data"])

    async def start_migration(
        self, options: StartMigrationOptions
    ) -> MigrationStartResult:
        """Start or dry-run a migration."""
        body = options.model_dump(exclude_none=True)
        response = await self._request(
            "POST", "/v1/terrafirma/migrations", body
        )
        return MigrationStartResult.model_validate(response["data"])

    async def trigger_sync(self, options: TriggerSyncOptions) -> SyncResult:
        """Trigger a manual sync cycle."""
        body = options.model_dump(exclude_none=True)
        response = await self._request(
            "POST", "/v1/terrafirma/sync", body
        )
        return SyncResult.model_validate(response["data"])


class SyncTerrafirmaResource(SyncBaseResource):
    """Sync resource for terrafirma filesystem sync operations."""

    def get_status(self) -> TerrafirmaStatus:
        """Get sync status overview."""
        response = self._request("GET", "/v1/terrafirma/status")
        return TerrafirmaStatus.model_validate(response["data"])

    def get_file_info(self, file_path: str) -> Optional[TerrafirmaFileInfo]:
        """Get detailed sync state for a specific file.

        Returns None if no bridge row exists (404).
        """
        try:
            encoded = quote(file_path, safe="")
            response = self._request(
                "GET", f"/v1/terrafirma/files/{encoded}"
            )
            return TerrafirmaFileInfo.model_validate(response["data"])
        except EngramError as exc:
            if exc.status_code == 404:
                return None
            raise

    def get_migration_status(self) -> MigrationCurrentStatus:
        """Get current or most recent migration status."""
        response = self._request(
            "GET", "/v1/terrafirma/migrations/current"
        )
        return MigrationCurrentStatus.model_validate(response["data"])

    def start_migration(
        self, options: StartMigrationOptions
    ) -> MigrationStartResult:
        """Start or dry-run a migration."""
        body = options.model_dump(exclude_none=True)
        response = self._request(
            "POST", "/v1/terrafirma/migrations", body
        )
        return MigrationStartResult.model_validate(response["data"])

    def trigger_sync(self, options: TriggerSyncOptions) -> SyncResult:
        """Trigger a manual sync cycle."""
        body = options.model_dump(exclude_none=True)
        response = self._request(
            "POST", "/v1/terrafirma/sync", body
        )
        return SyncResult.model_validate(response["data"])
