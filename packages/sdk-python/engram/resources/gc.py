"""GC (garbage collection) resources for the Engram SDK.

Resource-based interface for knowledge garbage-collection operations:
listing candidates, reading the audit log, and triggering a (optionally
dry-run) GC pass.

Mirrors the TypeScript SDK's ``GcResource``
(``packages/sdk/src/resources/gc.ts``).

The candidate-list and audit-log endpoints return the standard ``{ data, meta }``
envelope where ``data`` carries the list payload plus sibling scalars; the
``hasMore`` flag is sourced from ``meta.pagination.hasMore`` (defaulting to
``False``) and folded into the returned result model, exactly as the TS SDK does.
"""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.types.gc import (
    GcAuditResult,
    GcCandidatesResult,
    GcRunOptions,
    GcRunResult,
    ListGcAuditParams,
    ListGcCandidatesParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _has_more(response: Any) -> bool:
    """Extract ``meta.pagination.hasMore`` from an envelope, defaulting to False."""
    pagination = ((response or {}).get("meta") or {}).get("pagination") or {}
    return bool(pagination.get("hasMore", False))


def _candidate_query(params: Optional[ListGcCandidatesParams]) -> Optional[dict[str, str]]:
    """Build the candidate-list query params, dropping ``None`` values."""
    if params is None:
        return None
    qs: dict[str, str] = {}
    if params.threshold is not None:
        qs["threshold"] = str(params.threshold)
    if params.limit is not None:
        qs["limit"] = str(params.limit)
    if params.offset is not None:
        qs["offset"] = str(params.offset)
    return qs or None


def _audit_query(params: Optional[ListGcAuditParams]) -> Optional[dict[str, str]]:
    """Build the audit-log query params, dropping ``None`` values."""
    if params is None:
        return None
    qs: dict[str, str] = {}
    if params.limit is not None:
        qs["limit"] = str(params.limit)
    if params.offset is not None:
        qs["offset"] = str(params.offset)
    return qs or None


def _build_candidates_result(response: Any) -> GcCandidatesResult:
    data = dict(response["data"])
    data["hasMore"] = _has_more(response)
    return GcCandidatesResult.model_validate(data)


def _build_audit_result(response: Any) -> GcAuditResult:
    data = dict(response["data"])
    data["hasMore"] = _has_more(response)
    return GcAuditResult.model_validate(data)


class GcResource(BaseResource):
    """Async resource for knowledge garbage-collection operations.

    Example::

        candidates = await client.gc.get_candidates(
            ListGcCandidatesParams(threshold=0.2, limit=50)
        )
        audit = await client.gc.get_audit_log()
        result = await client.gc.run(GcRunOptions(dry_run=True))
    """

    async def get_candidates(
        self, params: Optional[ListGcCandidatesParams] = None
    ) -> GcCandidatesResult:
        """List garbage-collection candidates ranked by relevance score."""
        response = await self._request(
            "GET", "/v1/gc/candidates", params=_candidate_query(params)
        )
        return _build_candidates_result(response)

    async def get_audit_log(
        self, params: Optional[ListGcAuditParams] = None
    ) -> GcAuditResult:
        """Get the GC audit log of previous runs."""
        response = await self._request(
            "GET", "/v1/gc/audit", params=_audit_query(params)
        )
        return _build_audit_result(response)

    async def run(self, options: Optional[GcRunOptions] = None) -> GcRunResult:
        """Run garbage collection, optionally as a dry run."""
        body = (
            options.model_dump(by_alias=True, exclude_none=True) if options else None
        )
        response = await self._request("POST", "/v1/gc/run", body)
        return GcRunResult.model_validate(response["data"])


class SyncGcResource(SyncBaseResource):
    """Sync resource for knowledge garbage-collection operations."""

    def get_candidates(
        self, params: Optional[ListGcCandidatesParams] = None
    ) -> GcCandidatesResult:
        """List garbage-collection candidates ranked by relevance score."""
        response = self._request(
            "GET", "/v1/gc/candidates", params=_candidate_query(params)
        )
        return _build_candidates_result(response)

    def get_audit_log(
        self, params: Optional[ListGcAuditParams] = None
    ) -> GcAuditResult:
        """Get the GC audit log of previous runs."""
        response = self._request(
            "GET", "/v1/gc/audit", params=_audit_query(params)
        )
        return _build_audit_result(response)

    def run(self, options: Optional[GcRunOptions] = None) -> GcRunResult:
        """Run garbage collection, optionally as a dry run."""
        body = (
            options.model_dump(by_alias=True, exclude_none=True) if options else None
        )
        response = self._request("POST", "/v1/gc/run", body)
        return GcRunResult.model_validate(response["data"])
