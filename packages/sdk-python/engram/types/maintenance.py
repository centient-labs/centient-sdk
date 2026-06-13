"""Maintenance operation types for the Engram SDK.

Mirrors the TypeScript SDK's maintenance types
(``packages/sdk/src/resources/maintenance.ts``).

The maintenance endpoints return **bare** response bodies (not wrapped in the
standard ``{ data }`` envelope) as of engram-server 0.34 / ADR-022. The
resource parses these bodies directly rather than unwrapping ``data``.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "MaintenanceParams",
    "VacuumParams",
    "TombstoneCleanupResult",
    "ChangelogCompactResult",
    "VacuumResult",
]


class MaintenanceParams(BaseModel):
    """Parameters for tombstone-cleanup and changelog-compact operations."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    days: Optional[int] = None
    dry_run: Optional[bool] = None


class VacuumParams(BaseModel):
    """Parameters for the vacuum operation.

    When ``full`` is ``True``, runs ``VACUUM (FULL, ANALYZE)`` — rewrites each
    tombstone table and shrinks the database on disk, but takes an ``ACCESS
    EXCLUSIVE`` lock (blocks all access to that table for the duration). Run it
    in a maintenance window. Requires an **admin** API key (a plain write key is
    rejected with 403). When omitted/``False``, runs the non-blocking
    ``VACUUM (ANALYZE)``.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    full: Optional[bool] = None


class TombstoneCleanupResult(BaseModel):
    """Result of a tombstone-cleanup operation (bare, non-enveloped body)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    deleted: int
    warnings: List[str]
    dry_run: bool


class ChangelogCompactResult(BaseModel):
    """Result of a changelog-compact operation (bare, non-enveloped body)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    deleted: int
    below_seq: Optional[str] = None
    dry_run: bool
    reason: Optional[str] = None


class VacuumResult(BaseModel):
    """Result of a vacuum operation (bare, non-enveloped body).

    Requires engram-server >= 0.34.0 (engram-server#766). Against older servers
    the route does not exist and the call fails with a 404.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    vacuumed: List[str]
    full: bool
