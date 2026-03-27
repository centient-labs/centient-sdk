"""Common types shared across the Engram SDK."""
from __future__ import annotations

from typing import Any, Generic, TypeVar, Optional

from pydantic import BaseModel

T = TypeVar("T")

__all__ = [
    "PaginatedResult",
    "PaginationMeta",
    "ApiResponse",
]


class PaginatedResult(Generic[T]):
    """Typed result from paginated list endpoints."""

    def __init__(self, items: list[T], total: int, has_more: bool) -> None:
        self.items = items
        self.total = total
        self.has_more = has_more

    def __repr__(self) -> str:
        return f"PaginatedResult(items={len(self.items)}, total={self.total}, has_more={self.has_more})"


class PaginationMeta(BaseModel):
    total: int
    limit: int
    offset: Optional[int] = None
    has_more: bool


class ApiResponse(BaseModel, Generic[T]):
    data: T
    meta: Optional[dict[str, Any]] = None  # Keep loose - pagination is extracted by resources
