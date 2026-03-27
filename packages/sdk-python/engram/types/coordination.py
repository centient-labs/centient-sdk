"""Coordination types for the Engram SDK."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    # Constraints
    "SessionConstraint",
    "ConstraintViolation",
    # Decision points
    "DecisionPoint",
    "DecisionPointWithBranches",
    # Exploration branches
    "ExplorationBranch",
    # Branch tree
    "BranchTreeNodeBranch",
    "BranchTreeNode",
    # Note edges
    "SessionNoteEdge",
    "NoteTraversalResult",
    # Stuck detection
    "StuckDetection",
    # Session links
    "SessionLink",
    # Constraint parameters
    "CreateConstraintParams",
    "UpdateConstraintParams",
    "ListConstraintsParams",
    # Decision point parameters
    "CreateDecisionPointParams",
    "UpdateDecisionPointParams",
    "ListDecisionPointsParams",
    # Branch parameters
    "CreateBranchParams",
    "UpdateBranchParams",
    "CloseBranchParams",
    "ListBranchesParams",
    # Note edge parameters
    "CreateNoteEdgeParams",
    "ListNoteEdgesParams",
    "TraverseNotesParams",
    # Stuck detection parameters
    "CreateStuckDetectionParams",
    "ResolveStuckDetectionParams",
    "ListStuckDetectionsParams",
    # Session link parameters
    "CreateSessionLinkParams",
    "ListSessionLinksParams",
]


# ============================================================================
# Constraints
# ============================================================================


class SessionConstraint(BaseModel):
    """A constraint within a session."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    content: str
    keywords: list[str] = Field(default_factory=list)
    # Constraint scope: "session" (whole session), "task" (single task), "file" (specific file)
    scope: Literal["session", "task", "file"]
    active: bool
    # How the constraint was detected: "auto" (system-detected) or "explicit" (user-specified)
    detected_from: Literal["auto", "explicit"] = Field(alias="detectedFrom")
    lifted_at: Optional[str] = Field(None, alias="liftedAt")
    lift_reason: Optional[str] = Field(None, alias="liftReason")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ConstraintViolation(BaseModel):
    """A detected violation of a session constraint."""

    model_config = ConfigDict(populate_by_name=True)

    constraint_id: str = Field(alias="constraintId")
    content: str
    matched_keywords: list[str] = Field(alias="matchedKeywords")
    # Violation severity: "high" (must fix), "medium" (should fix), "low" (advisory)
    severity: Literal["high", "medium", "low"]


# ============================================================================
# Decision Points
# ============================================================================


class DecisionPoint(BaseModel):
    """A decision point within a session."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    description: str
    # Decision category:
    #   "architecture"    - High-level structural decisions
    #   "implementation"  - Code-level implementation choices
    #   "tooling"         - Tool or library selection
    #   "refactoring"     - Code restructuring decisions
    #   "exploration"     - Experimental investigation paths
    #   "integration"     - External system integration choices
    category: Literal[
        "architecture",
        "implementation",
        "tooling",
        "refactoring",
        "exploration",
        "integration",
    ]
    alternatives: list[str] = Field(default_factory=list)
    rationale: Optional[str] = None
    surprise_score: Optional[float] = Field(None, alias="surpriseScore")
    resolved: bool
    resolved_at: Optional[str] = Field(None, alias="resolvedAt")
    chosen_branch_id: Optional[str] = Field(None, alias="chosenBranchId")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# ============================================================================
# Exploration Branches
# ============================================================================


class ExplorationBranch(BaseModel):
    """An exploration branch linked to a decision point."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    decision_point_id: str = Field(alias="decisionPointId")
    label: str
    # Branch lifecycle: "active" (in progress), "merged" (accepted into main path),
    #   "rejected" (discarded), "abandoned" (stopped without resolution)
    status: Literal["active", "merged", "rejected", "abandoned"]
    reason_explored: Optional[str] = Field(None, alias="reasonExplored")
    closed_reason: Optional[str] = Field(None, alias="closedReason")
    insights: list[str] = Field(default_factory=list)
    adopted_fully: bool = Field(alias="adoptedFully")
    closed_at: Optional[str] = Field(None, alias="closedAt")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class DecisionPointWithBranches(DecisionPoint):
    """A decision point with its associated branches."""

    branches: list[ExplorationBranch] = Field(default_factory=list)


# ============================================================================
# Branch Tree
# ============================================================================


class BranchTreeNodeBranch(BaseModel):
    """A branch entry within a branch tree node."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    status: Literal["active", "merged", "rejected", "abandoned"]
    is_active: bool = Field(alias="isActive")
    is_chosen: bool = Field(alias="isChosen")


class BranchTreeNode(BaseModel):
    """A node in the branch tree representation."""

    model_config = ConfigDict(populate_by_name=True)

    decision_point_id: str = Field(alias="decisionPointId")
    description: str
    branches: list[BranchTreeNodeBranch] = Field(default_factory=list)


# ============================================================================
# Note Edges
# ============================================================================


class SessionNoteEdge(BaseModel):
    """An edge connecting two session notes."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    source_note_id: str = Field(alias="sourceNoteId")
    target_note_id: str = Field(alias="targetNoteId")
    # Note edge relationships:
    #   "preceded_by"   - Source note was preceded by the target note
    #   "caused_by"     - Source note was caused by the target note
    #   "validated_by"  - Source note was validated by the target note
    #   "superseded_by" - Source note was superseded by the target note
    #   "related_to"    - General association between two notes
    relationship: Literal[
        "preceded_by", "caused_by", "validated_by", "superseded_by", "related_to"
    ]
    evidence: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")


class NoteTraversalResult(BaseModel):
    """Result of traversing note edges."""

    model_config = ConfigDict(populate_by_name=True)

    note_id: str = Field(alias="noteId")
    depth: int
    path: list[str]


# ============================================================================
# Stuck Detection
# ============================================================================


class StuckDetection(BaseModel):
    """A stuck detection record within a session."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    # Stuck pattern types:
    #   "repeated_blocker" - Same blocker encountered multiple times
    #   "no_progress"      - No meaningful progress detected over time
    #   "error_loop"       - Repeated errors without resolution
    pattern_type: Literal["repeated_blocker", "no_progress", "error_loop"] = Field(
        alias="patternType"
    )
    confidence: float
    description: str
    evidence: list[str] = Field(default_factory=list)
    resolved: bool
    resolved_at: Optional[str] = Field(None, alias="resolvedAt")
    resolution_notes: Optional[str] = Field(None, alias="resolutionNotes")
    cooldown_until: str = Field(alias="cooldownUntil")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# ============================================================================
# Session Links
# ============================================================================


class SessionLink(BaseModel):
    """A link between two sessions."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    source_session_id: str = Field(alias="sourceSessionId")
    target_session_id: str = Field(alias="targetSessionId")
    # Session link relationships:
    #   "builds_on"              - Source session builds on work from target session
    #   "extends"                - Source session extends the target session
    #   "supersedes"             - Source session supersedes the target session
    #   "resolves_blockers_from" - Source session resolves blockers from target session
    relationship: Literal[
        "builds_on", "extends", "supersedes", "resolves_blockers_from"
    ]
    evidence: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")


# ============================================================================
# Constraint Parameters
# ============================================================================


class CreateConstraintParams(BaseModel):
    """Parameters for creating a session constraint."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    keywords: Optional[list[str]] = None
    scope: Optional[Literal["session", "task", "file"]] = None
    detected_from: Optional[Literal["auto", "explicit"]] = None
    metadata: Optional[dict[str, Any]] = None


class UpdateConstraintParams(BaseModel):
    """Parameters for updating a session constraint."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: Optional[str] = None
    keywords: Optional[list[str]] = None
    scope: Optional[Literal["session", "task", "file"]] = None
    metadata: Optional[dict[str, Any]] = None


class ListConstraintsParams(BaseModel):
    """Parameters for listing session constraints."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    active: Optional[bool] = None
    scope: Optional[Literal["session", "task", "file"]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Decision Point Parameters
# ============================================================================


class CreateDecisionPointParams(BaseModel):
    """Parameters for creating a decision point."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    description: str
    category: Optional[
        Literal[
            "architecture",
            "implementation",
            "tooling",
            "refactoring",
            "exploration",
            "integration",
        ]
    ] = None
    alternatives: Optional[list[str]] = None
    rationale: Optional[str] = None
    surprise_score: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None


class UpdateDecisionPointParams(BaseModel):
    """Parameters for updating a decision point."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    description: Optional[str] = None
    category: Optional[
        Literal[
            "architecture",
            "implementation",
            "tooling",
            "refactoring",
            "exploration",
            "integration",
        ]
    ] = None
    alternatives: Optional[list[str]] = None
    rationale: Optional[str] = None
    surprise_score: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None


class ListDecisionPointsParams(BaseModel):
    """Parameters for listing decision points."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    category: Optional[
        Literal[
            "architecture",
            "implementation",
            "tooling",
            "refactoring",
            "exploration",
            "integration",
        ]
    ] = None
    resolved: Optional[bool] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Branch Parameters
# ============================================================================


class CreateBranchParams(BaseModel):
    """Parameters for creating an exploration branch."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    decision_point_id: str
    label: str
    reason_explored: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class UpdateBranchParams(BaseModel):
    """Parameters for updating an exploration branch."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    label: Optional[str] = None
    reason_explored: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class CloseBranchParams(BaseModel):
    """Parameters for closing an exploration branch."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    action: Literal["merge", "reject", "abandon"]
    reason: Optional[str] = None
    insights: Optional[list[str]] = None
    adopt_fully: Optional[bool] = None


class ListBranchesParams(BaseModel):
    """Parameters for listing exploration branches."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    decision_point_id: Optional[str] = None
    status: Optional[Literal["active", "merged", "rejected", "abandoned"]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Note Edge Parameters
# ============================================================================


class CreateNoteEdgeParams(BaseModel):
    """Parameters for creating a note edge."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    source_note_id: str
    target_note_id: str
    relationship: Literal[
        "preceded_by", "caused_by", "validated_by", "superseded_by", "related_to"
    ]
    evidence: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ListNoteEdgesParams(BaseModel):
    """Parameters for listing note edges."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    source_note_id: Optional[str] = None
    target_note_id: Optional[str] = None
    relationship: Optional[
        Literal[
            "preceded_by", "caused_by", "validated_by", "superseded_by", "related_to"
        ]
    ] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class TraverseNotesParams(BaseModel):
    """Parameters for traversing note edges."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    start_note_id: str
    relationship: Optional[
        Literal[
            "preceded_by", "caused_by", "validated_by", "superseded_by", "related_to"
        ]
    ] = None
    max_depth: Optional[int] = None


# ============================================================================
# Stuck Detection Parameters
# ============================================================================


class CreateStuckDetectionParams(BaseModel):
    """Parameters for creating a stuck detection."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    pattern_type: Literal["repeated_blocker", "no_progress", "error_loop"]
    confidence: float
    description: str
    evidence: Optional[list[str]] = None
    cooldown_minutes: Optional[int] = None


class ResolveStuckDetectionParams(BaseModel):
    """Parameters for resolving a stuck detection."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    resolution_notes: Optional[str] = None


class ListStuckDetectionsParams(BaseModel):
    """Parameters for listing stuck detections."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    pattern_type: Optional[
        Literal["repeated_blocker", "no_progress", "error_loop"]
    ] = None
    resolved: Optional[bool] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


# ============================================================================
# Session Link Parameters
# ============================================================================


class CreateSessionLinkParams(BaseModel):
    """Parameters for creating a session link."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    source_session_id: str
    target_session_id: str
    relationship: Literal[
        "builds_on", "extends", "supersedes", "resolves_blockers_from"
    ]
    evidence: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ListSessionLinksParams(BaseModel):
    """Parameters for listing session links."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    relationship: Optional[
        Literal["builds_on", "extends", "supersedes", "resolves_blockers_from"]
    ] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
