"""Sync (multi-node replication) types for the Engram SDK.

Mirrors the TypeScript SDK's sync types
(``packages/sdk/src/resources/sync.ts``).

The ``/v1/sync`` routes use the standard ``{ success, data }`` envelope, EXCEPT
the peer routes (``/v1/sync/peers/*``) which return BARE shapes (``{ peer }``,
``{ peers }``, ``{ removed, name }``). Push/pull exchange the raw NDJSON
changelog wire format. See the resource module for the unwrapping rules.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "SyncEntityType",
    "SyncPeer",
    "SyncConflict",
    "SyncStatus",
    "SyncChange",
    "SyncCountEntry",
    "SyncCounts",
    "SyncPushResult",
    "SyncPullResult",
    "CreatePeerParams",
    "SyncPullParams",
    "ListConflictsParams",
    "ResolveConflictParams",
]


# The four entity types the server tracks in the sync changelog. Matches the
# server's ``SyncEntityType`` enum.
SyncEntityType = Literal[
    "knowledge_crystals",
    "knowledge_crystal_edges",
    "sessions",
    "session_notes",
]


class SyncPeer(BaseModel):
    """A registered sync peer."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    name: str
    url: str
    last_push_at: Optional[str] = None
    last_pull_at: Optional[str] = None
    last_push_seq: Optional[str] = None
    last_pull_seq: Optional[str] = None
    link_enabled: bool
    link_interval_seconds: int
    link_last_sync_at: Optional[str] = None
    link_last_error: Optional[str] = None
    link_paused: bool
    created_at: str
    updated_at: str


class SyncConflict(BaseModel):
    """A single sync conflict record."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    entity_type: str
    entity_id: str
    field_name: str
    local_value: Any = None
    remote_value: Any = None
    local_updated_at: Optional[str] = None
    remote_updated_at: Optional[str] = None
    winner: str
    resolution: str
    resolved_at: Optional[str] = None
    created_at: str


class SyncStatus(BaseModel):
    """The current sync status of this instance."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    instance_id: str
    schema_version: str
    peers_count: int
    active_links_count: int
    changelog_size: int


class SyncChange(BaseModel):
    """A single change record in the sync changelog.

    One NDJSON line in the ``push`` body and the ``pull`` response stream.
    Matches the server's serialized ``SyncChangelogEntry`` wire shape.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    seq: str
    entity_type: SyncEntityType
    entity_id: str
    operation: Literal["insert", "update", "delete"]
    changed_fields: Optional[Dict[str, Any]] = None
    previous_values: Optional[Dict[str, Any]] = None
    created_at: str


class SyncCountEntry(BaseModel):
    """Apply counts for a single entity type."""

    inserted: int
    updated: int
    skipped: int


class SyncCounts(BaseModel):
    """Per-entity-type apply counts returned by push operations.

    The server always populates all four entity-type keys. The wire keys are
    the snake_case entity-type identifiers (NOT camelCase), so this model does
    NOT use the camel alias generator.
    """

    knowledge_crystals: SyncCountEntry
    knowledge_crystal_edges: SyncCountEntry
    sessions: SyncCountEntry
    session_notes: SyncCountEntry


class SyncPushResult(BaseModel):
    """Result of applying a batch of changes (``push`` / ``push_to``)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    counts: SyncCounts
    conflicts: int
    duration: float


class SyncPullResult(BaseModel):
    """Result of triggering a daemon-side pull from a named peer (``pull_from``)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    entries_streamed: int
    max_seq: Optional[str] = None
    duration: float


class CreatePeerParams(BaseModel):
    """Parameters for registering a sync peer."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    name: str
    url: str
    api_key: Optional[str] = None


class SyncPullParams(BaseModel):
    """Parameters for pulling changelog entries.

    ``since_seq`` is required by the server (``POST /v1/sync/pull`` rejects a
    missing ``sinceSeq`` with a 400). Pass ``None`` to pull from the beginning
    of the changelog.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    since_seq: Optional[str] = None
    entity_types: Optional[List[SyncEntityType]] = None


class ListConflictsParams(BaseModel):
    """Parameters for listing sync conflicts."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    unresolved: Optional[bool] = None


class ResolveConflictParams(BaseModel):
    """Parameters for resolving a sync conflict."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    resolution: Optional[Literal["local", "remote"]] = None
    rationale: Optional[str] = None
