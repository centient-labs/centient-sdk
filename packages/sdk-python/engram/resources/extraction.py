"""Extraction resources for the Engram SDK."""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from engram._base import BaseResource, SyncBaseResource
from engram.types.entities import (
    ExtractionConfig,
    ExtractionJob,
    ExtractionJobStatus,
    ExtractionStats,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class ExtractionResource(BaseResource):
    """Async resource for entity extraction."""

    async def extract(
        self,
        source_id: str,
        source_type: str,
        rescan: bool = False,
    ) -> ExtractionJob:
        """Submit a source for entity extraction.

        Args:
            source_id: The ID of the source to extract from.
            source_type: The type of the source.
            rescan: Whether to force a rescan of previously extracted content.

        Returns:
            The created extraction job.
        """
        body: dict = {
            "sourceId": source_id,
            "sourceType": source_type,
            "rescan": rescan,
        }
        response = await self._request(
            "POST", "/v1/extraction/extract", body
        )
        return ExtractionJob.model_validate(response["data"])

    async def list_jobs(
        self,
        status: Optional[ExtractionJobStatus] = None,
    ) -> list[ExtractionJob]:
        """List extraction jobs.

        Args:
            status: Filter by job status.

        Returns:
            List of extraction jobs.
        """
        qs: dict[str, str] = {}
        if status is not None:
            qs["status"] = status.value
        response = await self._request(
            "GET", "/v1/extraction/jobs", params=qs if qs else None
        )
        return [
            ExtractionJob.model_validate(j) for j in response["data"]
        ]

    async def update_config(
        self,
        threshold: Optional[float] = None,
        daily_cap: Optional[int] = None,
    ) -> ExtractionConfig:
        """Update extraction configuration.

        Args:
            threshold: Confidence threshold for extraction.
            daily_cap: Maximum number of API calls per day.

        Returns:
            Updated extraction configuration.
        """
        body: dict = {}
        if threshold is not None:
            body["threshold"] = threshold
        if daily_cap is not None:
            body["dailyCap"] = daily_cap
        response = await self._request(
            "PATCH", "/v1/extraction/config", body
        )
        return ExtractionConfig.model_validate(response["data"])

    async def get_stats(self) -> ExtractionStats:
        """Get extraction statistics.

        Returns:
            Extraction statistics including job counts, usage, and entity counts.
        """
        response = await self._request("GET", "/v1/extraction/stats")
        return ExtractionStats.model_validate(response["data"])


class SyncExtractionResource(SyncBaseResource):
    """Sync resource for entity extraction."""

    def extract(
        self,
        source_id: str,
        source_type: str,
        rescan: bool = False,
    ) -> ExtractionJob:
        """Submit a source for entity extraction.

        Args:
            source_id: The ID of the source to extract from.
            source_type: The type of the source.
            rescan: Whether to force a rescan of previously extracted content.

        Returns:
            The created extraction job.
        """
        body: dict = {
            "sourceId": source_id,
            "sourceType": source_type,
            "rescan": rescan,
        }
        response = self._request(
            "POST", "/v1/extraction/extract", body
        )
        return ExtractionJob.model_validate(response["data"])

    def list_jobs(
        self,
        status: Optional[ExtractionJobStatus] = None,
    ) -> list[ExtractionJob]:
        """List extraction jobs.

        Args:
            status: Filter by job status.

        Returns:
            List of extraction jobs.
        """
        qs: dict[str, str] = {}
        if status is not None:
            qs["status"] = status.value
        response = self._request(
            "GET", "/v1/extraction/jobs", params=qs if qs else None
        )
        return [
            ExtractionJob.model_validate(j) for j in response["data"]
        ]

    def update_config(
        self,
        threshold: Optional[float] = None,
        daily_cap: Optional[int] = None,
    ) -> ExtractionConfig:
        """Update extraction configuration.

        Args:
            threshold: Confidence threshold for extraction.
            daily_cap: Maximum number of API calls per day.

        Returns:
            Updated extraction configuration.
        """
        body: dict = {}
        if threshold is not None:
            body["threshold"] = threshold
        if daily_cap is not None:
            body["dailyCap"] = daily_cap
        response = self._request(
            "PATCH", "/v1/extraction/config", body
        )
        return ExtractionConfig.model_validate(response["data"])

    def get_stats(self) -> ExtractionStats:
        """Get extraction statistics.

        Returns:
            Extraction statistics including job counts, usage, and entity counts.
        """
        response = self._request("GET", "/v1/extraction/stats")
        return ExtractionStats.model_validate(response["data"])
