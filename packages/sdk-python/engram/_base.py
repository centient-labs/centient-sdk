"""Base resource class for the Engram Python SDK."""
from __future__ import annotations

from typing import Any, TypeVar, TYPE_CHECKING

from engram.types.common import PaginatedResult

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient

_T = TypeVar("_T")


class BaseResource:
    """Base class for async resource classes."""

    def __init__(self, client: AsyncEngramClient) -> None:
        self._client = client

    async def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
    ) -> Any:
        return await self._client._request(method, path, body, params=params)

    def _parse_list(
        self,
        response: dict[str, Any],
        model_class: type[_T],
        key: str = "data",
    ) -> PaginatedResult[_T]:
        """Parse a paginated list response into a typed PaginatedResult."""
        data = response.get(key, [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return PaginatedResult(
            items=[model_class.model_validate(item) for item in data],
            total=pagination.get("total", len(data)),
            has_more=pagination.get("hasMore", False),
        )


class SyncBaseResource:
    """Base class for sync resource classes."""

    def __init__(self, client: EngramClient) -> None:
        self._client = client

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
    ) -> Any:
        return self._client._request(method, path, body, params=params)

    def _parse_list(
        self,
        response: dict[str, Any],
        model_class: type[_T],
        key: str = "data",
    ) -> PaginatedResult[_T]:
        """Parse a paginated list response into a typed PaginatedResult."""
        data = response.get(key, [])
        pagination = (response.get("meta") or {}).get("pagination", {})
        return PaginatedResult(
            items=[model_class.model_validate(item) for item in data],
            total=pagination.get("total", len(data)),
            has_more=pagination.get("hasMore", False),
        )
