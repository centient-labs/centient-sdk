"""Maintenance resource for the Engram SDK.

Resource-based interface for server maintenance operations: tombstone cleanup,
changelog compaction, and tombstone-table vacuum, all with dry-run support
where applicable.

Mirrors the TypeScript SDK's ``MaintenanceResource``
(``packages/sdk/src/resources/maintenance.ts``).

These endpoints return **bare** response bodies (not the standard ``{ data }``
envelope) as of engram-server 0.34 / ADR-022. Each method validates the bare
shape and raises :class:`~engram.errors.EngramError` (code ``INTERNAL_ERROR``)
on a contract drift, so a regression — or an older server still wrapping in
``{ data }`` — fails loudly instead of returning a model with ``undefined``
fields.
"""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import urlencode

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError
from engram.types.maintenance import (
    ChangelogCompactResult,
    MaintenanceParams,
    TombstoneCleanupResult,
    VacuumParams,
    VacuumResult,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _require_bare_object(path: str, body: Any, expected: str) -> dict:
    """Assert a bare (non-enveloped) maintenance body and return it.

    Raises if the body is missing, not a dict, or has been wrapped in the
    standard ``{ data }`` envelope (an older server / contract drift). The
    explicit ``data``-wrap check is what catches a server that has NOT migrated
    to the bare-body contract — otherwise ``model_validate`` would raise a less
    actionable pydantic error.
    """
    if not isinstance(body, dict) or "data" in body:
        raise EngramError(
            f"Unexpected POST {path} response shape (expected a bare {expected})",
            code="INTERNAL_ERROR",
        )
    return body


class MaintenanceResource(BaseResource):
    """Async resource for server maintenance and cleanup operations.

    Example::

        # Dry-run tombstone cleanup
        preview = await client.maintenance.tombstone_cleanup(
            MaintenanceParams(days=30, dry_run=True)
        )

        # Run changelog compaction
        result = await client.maintenance.changelog_compact(
            MaintenanceParams(days=90)
        )

        # Reclaim dead-tuple space (requires engram-server >= 0.34.0)
        vac = await client.maintenance.vacuum()
    """

    async def tombstone_cleanup(
        self, params: Optional[MaintenanceParams] = None
    ) -> TombstoneCleanupResult:
        """Clean up soft-deleted (tombstoned) records older than ``days``."""
        body = params.model_dump(by_alias=True, exclude_none=True) if params else None
        response = await self._request(
            "POST", "/v1/maintenance/tombstone-cleanup", body
        )
        bare = _require_bare_object(
            "/v1/maintenance/tombstone-cleanup",
            response,
            "{ deleted, warnings, dryRun }",
        )
        return TombstoneCleanupResult.model_validate(bare)

    async def changelog_compact(
        self, params: Optional[MaintenanceParams] = None
    ) -> ChangelogCompactResult:
        """Compact the changelog, removing entries older than ``days``."""
        body = params.model_dump(by_alias=True, exclude_none=True) if params else None
        response = await self._request(
            "POST", "/v1/maintenance/changelog-compact", body
        )
        bare = _require_bare_object(
            "/v1/maintenance/changelog-compact",
            response,
            "{ deleted, belowSeq, dryRun }",
        )
        return ChangelogCompactResult.model_validate(bare)

    async def vacuum(self, params: Optional[VacuumParams] = None) -> VacuumResult:
        """Reclaim physical space on the tombstone tables after bulk hard-deletes.

        Pair with :meth:`tombstone_cleanup`: that hard-deletes rows, this returns
        the dead-tuple space. Pass ``VacuumParams(full=True)`` to run
        ``VACUUM FULL`` — shrinks the database on disk but takes an ``ACCESS
        EXCLUSIVE`` lock and **requires an admin API key** (403 otherwise). A
        ``VACUUM FULL`` already in progress surfaces as a 409.

        Requires engram-server >= 0.34.0 (engram-server#766). Against older
        servers the route does not exist and the call fails with a 404.
        """
        query = ""
        if params and params.full:
            query = "?" + urlencode({"full": "true"})
        response = await self._request("POST", f"/v1/maintenance/vacuum{query}")
        bare = _require_bare_object(
            "/v1/maintenance/vacuum",
            response,
            "{ vacuumed: string[], full: boolean }",
        )
        return VacuumResult.model_validate(bare)


class SyncMaintenanceResource(SyncBaseResource):
    """Sync resource for server maintenance and cleanup operations."""

    def tombstone_cleanup(
        self, params: Optional[MaintenanceParams] = None
    ) -> TombstoneCleanupResult:
        """Clean up soft-deleted (tombstoned) records older than ``days``."""
        body = params.model_dump(by_alias=True, exclude_none=True) if params else None
        response = self._request("POST", "/v1/maintenance/tombstone-cleanup", body)
        bare = _require_bare_object(
            "/v1/maintenance/tombstone-cleanup",
            response,
            "{ deleted, warnings, dryRun }",
        )
        return TombstoneCleanupResult.model_validate(bare)

    def changelog_compact(
        self, params: Optional[MaintenanceParams] = None
    ) -> ChangelogCompactResult:
        """Compact the changelog, removing entries older than ``days``."""
        body = params.model_dump(by_alias=True, exclude_none=True) if params else None
        response = self._request("POST", "/v1/maintenance/changelog-compact", body)
        bare = _require_bare_object(
            "/v1/maintenance/changelog-compact",
            response,
            "{ deleted, belowSeq, dryRun }",
        )
        return ChangelogCompactResult.model_validate(bare)

    def vacuum(self, params: Optional[VacuumParams] = None) -> VacuumResult:
        """Reclaim physical space on the tombstone tables after bulk hard-deletes.

        See :meth:`MaintenanceResource.vacuum`. Requires engram-server >= 0.34.0.
        """
        query = ""
        if params and params.full:
            query = "?" + urlencode({"full": "true"})
        response = self._request("POST", f"/v1/maintenance/vacuum{query}")
        bare = _require_bare_object(
            "/v1/maintenance/vacuum",
            response,
            "{ vacuumed: string[], full: boolean }",
        )
        return VacuumResult.model_validate(bare)
