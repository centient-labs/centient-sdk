"""Audit resources for the Engram SDK."""
from __future__ import annotations

from typing import TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.types.audit import (
    AuditBatchIngestParams,
    AuditBatchIngestResult,
    AuditEvent,
    AuditFlushResult,
    AuditIngestParams,
    AuditIngestResult,
    AuditListParams,
    AuditPruneParams,
    AuditPruneResult,
    AuditStats,
    AuditStatsParams,
)
from engram.types.common import PaginatedResult

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class AuditResource(BaseResource):
    """Async resource for audit event operations."""

    async def ingest(self, params: AuditIngestParams) -> AuditIngestResult:
        """Ingest a single audit event.

        The event is buffered and flushed asynchronously. Returns 202.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/audit/ingest", body)
        return AuditIngestResult.model_validate(response["data"])

    async def ingest_batch(self, params: AuditBatchIngestParams) -> AuditBatchIngestResult:
        """Ingest a batch of audit events (up to 1000).

        Events are buffered and flushed asynchronously. Returns 202.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/audit/ingest/batch", body)
        return AuditBatchIngestResult.model_validate(response["data"])

    async def flush(self) -> AuditFlushResult:
        """Force flush the audit event buffer."""
        response = await self._request("POST", "/v1/audit/flush")
        return AuditFlushResult.model_validate(response["data"])

    async def list_events(
        self, params: AuditListParams | None = None
    ) -> PaginatedResult[AuditEvent]:
        """List audit events with optional filters."""
        query_params: list[tuple[str, str]] = []
        if params is not None:
            dumped = params.model_dump(by_alias=True, exclude_none=True)
            for key, value in dumped.items():
                if isinstance(value, list):
                    for item in value:
                        query_params.append((key, str(item)))
                else:
                    query_params.append((key, str(value)))

        response = await self._request(
            "GET", "/v1/audit/events", params=query_params or None
        )
        return self._parse_list(response, AuditEvent)

    async def get_event(self, event_id: str) -> AuditEvent:
        """Get a single audit event by ID."""
        response = await self._request("GET", f"/v1/audit/events/{event_id}")
        return AuditEvent.model_validate(response["data"])

    async def get_stats(
        self, params: AuditStatsParams | None = None
    ) -> AuditStats:
        """Get aggregate audit event statistics."""
        query_params: list[tuple[str, str]] | None = None
        if params is not None:
            dumped = params.model_dump(by_alias=True, exclude_none=True)
            if dumped:
                query_params = [(k, str(v)) for k, v in dumped.items()]

        response = await self._request(
            "GET", "/v1/audit/stats", params=query_params
        )
        return AuditStats.model_validate(response["data"])

    async def prune(self, params: AuditPruneParams) -> AuditPruneResult:
        """Prune audit events older than the specified number of days."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("DELETE", "/v1/audit/prune", body)
        return AuditPruneResult.model_validate(response["data"])


class SyncAuditResource(SyncBaseResource):
    """Sync resource for audit event operations."""

    def ingest(self, params: AuditIngestParams) -> AuditIngestResult:
        """Ingest a single audit event.

        The event is buffered and flushed asynchronously. Returns 202.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/audit/ingest", body)
        return AuditIngestResult.model_validate(response["data"])

    def ingest_batch(self, params: AuditBatchIngestParams) -> AuditBatchIngestResult:
        """Ingest a batch of audit events (up to 1000).

        Events are buffered and flushed asynchronously. Returns 202.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/audit/ingest/batch", body)
        return AuditBatchIngestResult.model_validate(response["data"])

    def flush(self) -> AuditFlushResult:
        """Force flush the audit event buffer."""
        response = self._request("POST", "/v1/audit/flush")
        return AuditFlushResult.model_validate(response["data"])

    def list_events(
        self, params: AuditListParams | None = None
    ) -> PaginatedResult[AuditEvent]:
        """List audit events with optional filters."""
        query_params: list[tuple[str, str]] = []
        if params is not None:
            dumped = params.model_dump(by_alias=True, exclude_none=True)
            for key, value in dumped.items():
                if isinstance(value, list):
                    for item in value:
                        query_params.append((key, str(item)))
                else:
                    query_params.append((key, str(value)))

        response = self._request(
            "GET", "/v1/audit/events", params=query_params or None
        )
        return self._parse_list(response, AuditEvent)

    def get_event(self, event_id: str) -> AuditEvent:
        """Get a single audit event by ID."""
        response = self._request("GET", f"/v1/audit/events/{event_id}")
        return AuditEvent.model_validate(response["data"])

    def get_stats(
        self, params: AuditStatsParams | None = None
    ) -> AuditStats:
        """Get aggregate audit event statistics."""
        query_params: list[tuple[str, str]] | None = None
        if params is not None:
            dumped = params.model_dump(by_alias=True, exclude_none=True)
            if dumped:
                query_params = [(k, str(v)) for k, v in dumped.items()]

        response = self._request(
            "GET", "/v1/audit/stats", params=query_params
        )
        return AuditStats.model_validate(response["data"])

    def prune(self, params: AuditPruneParams) -> AuditPruneResult:
        """Prune audit events older than the specified number of days."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("DELETE", "/v1/audit/prune", body)
        return AuditPruneResult.model_validate(response["data"])
