"""Audit types for the Engram SDK."""
from __future__ import annotations

from typing import Any, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    # Literal types
    "LogLevel",
    "AuditEventType",
    "AuditOutcome",
    # Response models
    "AuditEvent",
    "AuditIngestResult",
    "AuditBatchIngestResult",
    "AuditFlushResult",
    "AuditStats",
    "AuditIngesterStats",
    "AuditPruneResult",
    # Request param models
    "AuditIngestParams",
    "AuditBatchIngestParams",
    "AuditListParams",
    "AuditStatsParams",
    "AuditPruneParams",
]

# ============================================================================
# Literal Types
# ============================================================================

LogLevel = Literal["trace", "debug", "info", "warn", "error", "fatal"]

AuditEventType = Literal[
    "pattern_search",
    "pattern_load",
    "pattern_find",
    "pattern_sign",
    "skill_execute",
    "pattern_index",
    "pattern_version_create",
    "pattern_version_deprecate",
    "artifact_search",
    "artifact_load",
    "artifact_code_extract",
    "session_start",
    "session_note",
    "session_search",
    "session_finalize",
    "research_plan",
    "consultation",
    "branch_create",
    "branch_close",
    "tool_call",
]

AuditOutcome = Literal["success", "failure", "partial"]

# ============================================================================
# Response Models
# ============================================================================


class AuditEvent(BaseModel):
    """A single audit event returned from the server."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    timestamp: str
    level: LogLevel
    component: str
    message: str
    service: str
    version: Optional[str] = None
    pid: Optional[int] = None
    hostname: Optional[str] = None
    event_type: Optional[AuditEventType] = None
    tool: Optional[str] = None
    outcome: Optional[AuditOutcome] = None
    duration_ms: Optional[int] = None
    project_path: Optional[str] = None
    session_id: Optional[str] = None
    input: dict[str, Any] = {}
    output: dict[str, Any] = {}
    context: dict[str, Any] = {}
    metadata: dict[str, Any] = {}
    created_at: str


class AuditIngestResult(BaseModel):
    """Result of ingesting a single audit event."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    accepted: bool


class AuditBatchIngestResult(BaseModel):
    """Result of ingesting a batch of audit events."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    accepted: int


class AuditFlushResult(BaseModel):
    """Result of flushing the audit buffer."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    flushed: bool


class AuditIngesterStats(BaseModel):
    """Ingester buffer statistics."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="allow")


class AuditStats(BaseModel):
    """Aggregate audit event statistics."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    total: int
    by_level: dict[str, int]
    by_outcome: dict[str, int]
    by_component: dict[str, int]
    ingester: Optional[AuditIngesterStats] = None


class AuditPruneResult(BaseModel):
    """Result of pruning old audit events."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    deleted: int


# ============================================================================
# Request Param Models (camelCase — matches server Zod schemas)
# ============================================================================


class AuditIngestParams(BaseModel):
    """Parameters for ingesting a single audit event."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    timestamp: Optional[str] = None
    level: LogLevel
    component: str
    message: str
    service: Optional[str] = None
    version: Optional[str] = None
    pid: Optional[int] = None
    hostname: Optional[str] = None
    event_type: Optional[AuditEventType] = None
    tool: Optional[str] = None
    outcome: Optional[AuditOutcome] = None
    duration_ms: Optional[int] = None
    project_path: Optional[str] = None
    session_id: Optional[str] = None
    input: Optional[dict[str, Any]] = None
    output: Optional[dict[str, Any]] = None
    context: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None


class AuditBatchIngestParams(BaseModel):
    """Parameters for batch ingesting audit events."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    events: list[AuditIngestParams]


class AuditListParams(BaseModel):
    """Query parameters for listing audit events."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    level: Optional[Union[str, List[str]]] = None
    component: Optional[str] = None
    event_type: Optional[Union[str, List[str]]] = None
    tool: Optional[str] = None
    outcome: Optional[AuditOutcome] = None
    project_path: Optional[str] = None
    session_id: Optional[str] = None
    since: Optional[str] = None
    until: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class AuditStatsParams(BaseModel):
    """Query parameters for audit statistics."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    since: Optional[str] = None
    until: Optional[str] = None


class AuditPruneParams(BaseModel):
    """Parameters for pruning old audit events."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    older_than_days: int
