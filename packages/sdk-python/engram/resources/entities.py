"""Entity resources for the Engram SDK."""
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.entities import (
    EntityCard,
    EntityClass,
    EntityReviewAction,
    EntityReviewResult,
    EntityWithEdges,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class EntitiesResource(BaseResource):
    """Async resource for entities."""

    async def list(
        self,
        class_filter: Optional[EntityClass] = None,
        verified: Optional[bool] = None,
        min_confidence: Optional[float] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> PaginatedResult[EntityCard]:
        """List entities.

        Args:
            class_filter: Filter by entity class.
            verified: Filter by verified status.
            min_confidence: Filter by minimum confidence score.
            limit: Maximum number of results to return.
            offset: Number of results to skip.

        Returns:
            Paginated list of entity cards.
        """
        qs: dict[str, str] = {}
        if class_filter is not None:
            qs["class"] = class_filter.value
        if verified is not None:
            qs["verified"] = str(verified).lower()
        if min_confidence is not None:
            qs["min_confidence"] = str(min_confidence)
        if limit is not None:
            qs["limit"] = str(limit)
        if offset is not None:
            qs["offset"] = str(offset)
        response = await self._request(
            "GET", "/v1/entities", params=qs if qs else None
        )
        return self._parse_list(response, EntityCard)

    async def get(self, entity_id: str) -> EntityWithEdges:
        """Get an entity by ID.

        Args:
            entity_id: The entity ID.

        Returns:
            Entity card with edges.
        """
        response = await self._request(
            "GET", f"/v1/entities/{quote(entity_id, safe='')}"
        )
        return EntityWithEdges.model_validate(response["data"])

    async def review(
        self,
        entity_id: str,
        action: EntityReviewAction,
        target_entity_id: Optional[str] = None,
    ) -> EntityReviewResult:
        """Review an entity (approve merge, create new, or dismiss).

        Args:
            entity_id: The entity ID to review.
            action: The review action to take.
            target_entity_id: Target entity ID for merge actions.

        Returns:
            Review result with resolution details.
        """
        body: dict[str, str] = {"action": action.value}
        if target_entity_id is not None:
            body["targetEntityId"] = target_entity_id
        response = await self._request(
            "POST",
            f"/v1/entities/{quote(entity_id, safe='')}/review",
            body,
        )
        return EntityReviewResult.model_validate(response["data"])


class SyncEntitiesResource(SyncBaseResource):
    """Sync resource for entities."""

    def list(
        self,
        class_filter: Optional[EntityClass] = None,
        verified: Optional[bool] = None,
        min_confidence: Optional[float] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> PaginatedResult[EntityCard]:
        """List entities.

        Args:
            class_filter: Filter by entity class.
            verified: Filter by verified status.
            min_confidence: Filter by minimum confidence score.
            limit: Maximum number of results to return.
            offset: Number of results to skip.

        Returns:
            Paginated list of entity cards.
        """
        qs: dict[str, str] = {}
        if class_filter is not None:
            qs["class"] = class_filter.value
        if verified is not None:
            qs["verified"] = str(verified).lower()
        if min_confidence is not None:
            qs["min_confidence"] = str(min_confidence)
        if limit is not None:
            qs["limit"] = str(limit)
        if offset is not None:
            qs["offset"] = str(offset)
        response = self._request(
            "GET", "/v1/entities", params=qs if qs else None
        )
        return self._parse_list(response, EntityCard)

    def get(self, entity_id: str) -> EntityWithEdges:
        """Get an entity by ID.

        Args:
            entity_id: The entity ID.

        Returns:
            Entity card with edges.
        """
        response = self._request(
            "GET", f"/v1/entities/{quote(entity_id, safe='')}"
        )
        return EntityWithEdges.model_validate(response["data"])

    def review(
        self,
        entity_id: str,
        action: EntityReviewAction,
        target_entity_id: Optional[str] = None,
    ) -> EntityReviewResult:
        """Review an entity (approve merge, create new, or dismiss).

        Args:
            entity_id: The entity ID to review.
            action: The review action to take.
            target_entity_id: Target entity ID for merge actions.

        Returns:
            Review result with resolution details.
        """
        body: dict[str, str] = {"action": action.value}
        if target_entity_id is not None:
            body["targetEntityId"] = target_entity_id
        response = self._request(
            "POST",
            f"/v1/entities/{quote(entity_id, safe='')}/review",
            body,
        )
        return EntityReviewResult.model_validate(response["data"])
