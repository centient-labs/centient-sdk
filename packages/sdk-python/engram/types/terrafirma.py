"""Terrafirma types for the Engram SDK (ADR-049)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from engram.types.knowledge_crystal import NodeType

__all__ = [
    # Enums / Literal types
    "TerrafirmaMode",
    "ProcessStatus",
    "SyncStatus",
    "MigrationStatus",
    "SyncScope",
    # Response models — GET /v1/terrafirma/status
    "TerrafirmaWatcherStatus",
    "TerrafirmaReconcilerStatus",
    "TerrafirmaSyncCounts",
    "TerrafirmaSuggestedAction",
    "TerrafirmaStatus",
    # Response models — GET /v1/terrafirma/files/:filePath
    "CrystalMembershipInfo",
    "FileConflictInfo",
    "TerrafirmaFileInfo",
    # Response models — POST /v1/terrafirma/migrations
    "MigrationStartResult",
    # Response models — GET /v1/terrafirma/migrations/current
    "MigrationError",
    "MigrationCurrentStatus",
    # Response models — POST /v1/terrafirma/sync
    "SyncResult",
    # Request param models (snake_case — no alias_generator)
    "StartMigrationOptions",
    "TriggerSyncOptions",
]

# ============================================================================
# Enums / Literal Types
# ============================================================================

TerrafirmaMode = Literal["steady_state", "migration", "initial_scan"]

ProcessStatus = Literal["running", "idle", "stopped", "error"]

SyncStatus = Literal[
    "pending", "syncing", "synced", "fs_dirty", "conflict", "orphaned", "error"
]

MigrationStatus = Literal["running", "completed", "failed", "not_found"]

SyncScope = Literal["all", "errors", "conflicts"]

# ============================================================================
# Response Models — GET /v1/terrafirma/status
# ============================================================================


class TerrafirmaWatcherStatus(BaseModel):
    """Watcher process status."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: ProcessStatus
    uptime_seconds: int
    events_processed_24h: int = Field(alias="eventsProcessed24h")
    last_event_at: Optional[str] = None


class TerrafirmaReconcilerStatus(BaseModel):
    """Reconciler process status."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: ProcessStatus
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None


class TerrafirmaSyncCounts(BaseModel):
    """7-state sync counts (ADR-049 D1)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    total: int
    synced: int
    pending: int
    syncing: int
    fs_dirty: int
    conflict: int
    orphaned: int
    error: int
    last_synced_at: Optional[str] = None


class TerrafirmaSuggestedAction(BaseModel):
    """Suggested action from the status endpoint."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    action: str
    label: str
    endpoint: str
    count: Optional[int] = None


class TerrafirmaStatus(BaseModel):
    """Full terrafirma status overview."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    mode: TerrafirmaMode
    watcher: TerrafirmaWatcherStatus
    reconciler: TerrafirmaReconcilerStatus
    sync: TerrafirmaSyncCounts
    suggested_actions: list[TerrafirmaSuggestedAction]


# ============================================================================
# Response Models — GET /v1/terrafirma/files/:filePath
# ============================================================================


class CrystalMembershipInfo(BaseModel):
    """Crystal membership info for a synced file."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    crystal_id: str
    node_type: NodeType
    tags: list[str]
    folder_path: Optional[str] = None


class FileConflictInfo(BaseModel):
    """Conflict information for a synced file."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    detected_at: str
    reason: str
    watcher_hash: str
    reconciler_hash: str
    resolution_action: str
    resolution_description: str


class TerrafirmaFileInfo(BaseModel):
    """Detailed sync state for a specific file."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    file_path: str
    sync_status: SyncStatus
    content_hash: str
    last_modified: str
    size_bytes: int
    entity_id: str
    crystal_memberships: list[CrystalMembershipInfo]
    engram_item_id: str
    version: int
    last_synced_at: str
    conflict: Optional[FileConflictInfo] = None


# ============================================================================
# Response Models — POST /v1/terrafirma/migrations
# ============================================================================


class MigrationStartResult(BaseModel):
    """Result of starting or dry-running a migration."""

    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, extra="allow"
    )

    dry_run: bool


# ============================================================================
# Response Models — GET /v1/terrafirma/migrations/current
# ============================================================================


class MigrationError(BaseModel):
    """An error encountered during migration."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    file_path: str
    error_code: str
    message: str
    recoverable: bool


class MigrationCurrentStatus(BaseModel):
    """Current or most recent migration status."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: MigrationStatus
    migration_id: str
    files_total: int
    files_processed: int
    files_errored: int
    files_remaining: int
    current_entity: Optional[str] = None
    entities_completed: list[str]
    entities_remaining: list[str]
    started_at: str
    completed_at: Optional[str] = None
    elapsed_seconds: float
    checkpoint_id: str
    errors: list[MigrationError]


# ============================================================================
# Response Models — POST /v1/terrafirma/sync
# ============================================================================


class SyncResult(BaseModel):
    """Result of triggering a manual sync."""

    model_config = ConfigDict(
        populate_by_name=True, alias_generator=to_camel, extra="allow"
    )

    dry_run: bool


# ============================================================================
# Request Param Models (snake_case — NO alias_generator)
# ============================================================================


class StartMigrationOptions(BaseModel):
    """Request params for starting a migration. Uses snake_case (server Zod schema)."""

    model_config = ConfigDict(populate_by_name=True)

    dry_run: bool
    entity_ids: Optional[list[str]] = None


class TriggerSyncOptions(BaseModel):
    """Request params for triggering a sync. Uses snake_case (server Zod schema)."""

    model_config = ConfigDict(populate_by_name=True)

    dry_run: bool
    scope: Optional[SyncScope] = None
    entity_id: Optional[str] = None
    file_paths: Optional[list[str]] = None
