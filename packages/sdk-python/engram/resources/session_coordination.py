"""Session coordination resources for the Engram SDK."""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.common import PaginatedResult
from engram.types.coordination import (
    BranchTreeNode,
    CloseBranchParams,
    ConstraintViolation,
    CreateBranchParams,
    CreateConstraintParams,
    CreateDecisionPointParams,
    CreateNoteEdgeParams,
    CreateStuckDetectionParams,
    DecisionPoint,
    DecisionPointWithBranches,
    ExplorationBranch,
    ListBranchesParams,
    ListConstraintsParams,
    ListDecisionPointsParams,
    ListNoteEdgesParams,
    ListStuckDetectionsParams,
    NoteTraversalResult,
    ResolveStuckDetectionParams,
    SessionConstraint,
    SessionNoteEdge,
    StuckDetection,
    TraverseNotesParams,
    UpdateBranchParams,
    UpdateConstraintParams,
    UpdateDecisionPointParams,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


# ============================================================================
# Session Constraints
# ============================================================================


class SessionConstraintsResource(BaseResource):
    """Async resource for session constraints, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(
        self, params: CreateConstraintParams
    ) -> SessionConstraint:
        """Create a constraint."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    async def get(self, id: str) -> SessionConstraint:
        """Get a constraint by ID."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}",
        )
        return SessionConstraint.model_validate(response["data"])

    async def list(
        self, params: Optional[ListConstraintsParams] = None
    ) -> PaginatedResult[SessionConstraint]:
        """List constraints."""
        qs: dict[str, str] = {}
        if params:
            if params.active is not None:
                qs["active"] = str(params.active).lower()
            if params.scope:
                qs["scope"] = params.scope
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionConstraint)

    async def get_active(self) -> list[SessionConstraint]:
        """Get active constraints."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/active",
        )
        return [
            SessionConstraint.model_validate(c) for c in response["data"]
        ]

    async def update(
        self, id: str, params: UpdateConstraintParams
    ) -> SessionConstraint:
        """Update a constraint."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    async def lift(
        self, id: str, reason: Optional[str] = None
    ) -> SessionConstraint:
        """Lift (deactivate) a constraint."""
        body: dict[str, Any] = {}
        if reason is not None:
            body["reason"] = reason
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}/lift",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    async def check_violations(
        self, text: str
    ) -> dict[str, Any]:
        """Check if text violates any active constraints."""
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/check",
            {"text": text},
        )
        data = response["data"]
        return {
            "violations": [
                ConstraintViolation.model_validate(v)
                for v in data.get("violations", [])
            ],
            "has_violations": data.get("hasViolations", False),
        }


class SyncSessionConstraintsResource(SyncBaseResource):
    """Sync resource for session constraints, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(
        self, params: CreateConstraintParams
    ) -> SessionConstraint:
        """Create a constraint."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    def get(self, id: str) -> SessionConstraint:
        """Get a constraint by ID."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}",
        )
        return SessionConstraint.model_validate(response["data"])

    def list(
        self, params: Optional[ListConstraintsParams] = None
    ) -> PaginatedResult[SessionConstraint]:
        """List constraints."""
        qs: dict[str, str] = {}
        if params:
            if params.active is not None:
                qs["active"] = str(params.active).lower()
            if params.scope:
                qs["scope"] = params.scope
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionConstraint)

    def get_active(self) -> list[SessionConstraint]:
        """Get active constraints."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/active",
        )
        return [
            SessionConstraint.model_validate(c) for c in response["data"]
        ]

    def update(
        self, id: str, params: UpdateConstraintParams
    ) -> SessionConstraint:
        """Update a constraint."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    def lift(
        self, id: str, reason: Optional[str] = None
    ) -> SessionConstraint:
        """Lift (deactivate) a constraint."""
        body: dict[str, Any] = {}
        if reason is not None:
            body["reason"] = reason
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/{quote(id, safe='')}/lift",
            body,
        )
        return SessionConstraint.model_validate(response["data"])

    def check_violations(self, text: str) -> dict[str, Any]:
        """Check if text violates any active constraints."""
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/constraints/check",
            {"text": text},
        )
        data = response["data"]
        return {
            "violations": [
                ConstraintViolation.model_validate(v)
                for v in data.get("violations", [])
            ],
            "has_violations": data.get("hasViolations", False),
        }


# ============================================================================
# Session Decision Points
# ============================================================================


class SessionDecisionPointsResource(BaseResource):
    """Async resource for session decision points, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(
        self, params: CreateDecisionPointParams
    ) -> DecisionPoint:
        """Create a decision point."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points",
            body,
        )
        return DecisionPoint.model_validate(response["data"])

    async def get(
        self, id: str, include_branches: bool = False
    ) -> DecisionPoint | DecisionPointWithBranches:
        """Get a decision point by ID."""
        qs: dict[str, str] = {}
        if include_branches:
            qs["includeBranches"] = "true"
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}",
            params=qs if qs else None,
        )
        if include_branches:
            return DecisionPointWithBranches.model_validate(response["data"])
        return DecisionPoint.model_validate(response["data"])

    async def list(
        self, params: Optional[ListDecisionPointsParams] = None
    ) -> PaginatedResult[DecisionPoint]:
        """List decision points."""
        qs: dict[str, str] = {}
        if params:
            if params.category:
                qs["category"] = params.category
            if params.resolved is not None:
                qs["resolved"] = str(params.resolved).lower()
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points",
            params=qs if qs else None,
        )
        return self._parse_list(response, DecisionPoint)

    async def update(
        self, id: str, params: UpdateDecisionPointParams
    ) -> DecisionPoint:
        """Update a decision point."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}",
            body,
        )
        return DecisionPoint.model_validate(response["data"])

    async def resolve(
        self, id: str, chosen_branch_id: Optional[str] = None
    ) -> DecisionPoint:
        """Resolve a decision point."""
        body: dict[str, Any] = {}
        if chosen_branch_id is not None:
            body["chosenBranchId"] = chosen_branch_id
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}/resolve",
            body,
        )
        return DecisionPoint.model_validate(response["data"])


class SyncSessionDecisionPointsResource(SyncBaseResource):
    """Sync resource for session decision points, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(
        self, params: CreateDecisionPointParams
    ) -> DecisionPoint:
        """Create a decision point."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points",
            body,
        )
        return DecisionPoint.model_validate(response["data"])

    def get(
        self, id: str, include_branches: bool = False
    ) -> DecisionPoint | DecisionPointWithBranches:
        """Get a decision point by ID."""
        qs: dict[str, str] = {}
        if include_branches:
            qs["includeBranches"] = "true"
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}",
            params=qs if qs else None,
        )
        if include_branches:
            return DecisionPointWithBranches.model_validate(response["data"])
        return DecisionPoint.model_validate(response["data"])

    def list(
        self, params: Optional[ListDecisionPointsParams] = None
    ) -> PaginatedResult[DecisionPoint]:
        """List decision points."""
        qs: dict[str, str] = {}
        if params:
            if params.category:
                qs["category"] = params.category
            if params.resolved is not None:
                qs["resolved"] = str(params.resolved).lower()
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points",
            params=qs if qs else None,
        )
        return self._parse_list(response, DecisionPoint)

    def update(
        self, id: str, params: UpdateDecisionPointParams
    ) -> DecisionPoint:
        """Update a decision point."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}",
            body,
        )
        return DecisionPoint.model_validate(response["data"])

    def resolve(
        self, id: str, chosen_branch_id: Optional[str] = None
    ) -> DecisionPoint:
        """Resolve a decision point."""
        body: dict[str, Any] = {}
        if chosen_branch_id is not None:
            body["chosenBranchId"] = chosen_branch_id
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/decision-points/{quote(id, safe='')}/resolve",
            body,
        )
        return DecisionPoint.model_validate(response["data"])


# ============================================================================
# Session Branches
# ============================================================================


class SessionBranchesResource(BaseResource):
    """Async resource for session branches, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(
        self, params: CreateBranchParams
    ) -> ExplorationBranch:
        """Create a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])

    async def get(self, id: str) -> ExplorationBranch:
        """Get a branch by ID."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}",
        )
        return ExplorationBranch.model_validate(response["data"])

    async def list(
        self, params: Optional[ListBranchesParams] = None
    ) -> PaginatedResult[ExplorationBranch]:
        """List branches."""
        qs: dict[str, str] = {}
        if params:
            if params.decision_point_id:
                qs["decisionPointId"] = params.decision_point_id
            if params.status:
                qs["status"] = params.status
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches",
            params=qs if qs else None,
        )
        return self._parse_list(response, ExplorationBranch)

    async def get_tree(self) -> list[BranchTreeNode]:
        """Get branch tree visualization."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/tree",
        )
        return [BranchTreeNode.model_validate(n) for n in response["data"]]

    async def get_active(self) -> Optional[ExplorationBranch]:
        """Get the active branch."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/active",
        )
        if response["data"] is None:
            return None
        return ExplorationBranch.model_validate(response["data"])

    async def switch(
        self, branch_id: Optional[str]
    ) -> dict[str, Any]:
        """Switch the active branch."""
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/switch",
            {"branchId": branch_id},
        )
        return response["data"]

    async def update(
        self, id: str, params: UpdateBranchParams
    ) -> ExplorationBranch:
        """Update a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])

    async def close(
        self, id: str, params: CloseBranchParams
    ) -> ExplorationBranch:
        """Close a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}/close",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])


class SyncSessionBranchesResource(SyncBaseResource):
    """Sync resource for session branches, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(self, params: CreateBranchParams) -> ExplorationBranch:
        """Create a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])

    def get(self, id: str) -> ExplorationBranch:
        """Get a branch by ID."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}",
        )
        return ExplorationBranch.model_validate(response["data"])

    def list(
        self, params: Optional[ListBranchesParams] = None
    ) -> PaginatedResult[ExplorationBranch]:
        """List branches."""
        qs: dict[str, str] = {}
        if params:
            if params.decision_point_id:
                qs["decisionPointId"] = params.decision_point_id
            if params.status:
                qs["status"] = params.status
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches",
            params=qs if qs else None,
        )
        return self._parse_list(response, ExplorationBranch)

    def get_tree(self) -> list[BranchTreeNode]:
        """Get branch tree visualization."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/tree",
        )
        return [BranchTreeNode.model_validate(n) for n in response["data"]]

    def get_active(self) -> Optional[ExplorationBranch]:
        """Get the active branch."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/active",
        )
        if response["data"] is None:
            return None
        return ExplorationBranch.model_validate(response["data"])

    def switch(self, branch_id: Optional[str]) -> dict[str, Any]:
        """Switch the active branch."""
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/switch",
            {"branchId": branch_id},
        )
        return response["data"]

    def update(
        self, id: str, params: UpdateBranchParams
    ) -> ExplorationBranch:
        """Update a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "PATCH",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])

    def close(
        self, id: str, params: CloseBranchParams
    ) -> ExplorationBranch:
        """Close a branch."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/branches/{quote(id, safe='')}/close",
            body,
        )
        return ExplorationBranch.model_validate(response["data"])


# ============================================================================
# Session Note Edges
# ============================================================================


class SessionNoteEdgesResource(BaseResource):
    """Async resource for session note edges, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(
        self, params: CreateNoteEdgeParams
    ) -> SessionNoteEdge:
        """Create a note edge."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges",
            body,
        )
        return SessionNoteEdge.model_validate(response["data"])

    async def get(self, id: str) -> SessionNoteEdge:
        """Get a note edge by ID."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/{quote(id, safe='')}",
        )
        return SessionNoteEdge.model_validate(response["data"])

    async def list(
        self, params: Optional[ListNoteEdgesParams] = None
    ) -> PaginatedResult[SessionNoteEdge]:
        """List note edges."""
        qs: dict[str, str] = {}
        if params:
            if params.source_note_id:
                qs["sourceNoteId"] = params.source_note_id
            if params.target_note_id:
                qs["targetNoteId"] = params.target_note_id
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionNoteEdge)

    async def traverse(
        self, params: TraverseNotesParams
    ) -> list[NoteTraversalResult]:
        """Traverse the note graph from a starting note."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/traverse",
            body,
        )
        return [
            NoteTraversalResult.model_validate(r) for r in response["data"]
        ]

    async def delete(self, id: str) -> None:
        """Delete a note edge."""
        await self._request(
            "DELETE",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/{quote(id, safe='')}",
        )


class SyncSessionNoteEdgesResource(SyncBaseResource):
    """Sync resource for session note edges, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(self, params: CreateNoteEdgeParams) -> SessionNoteEdge:
        """Create a note edge."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges",
            body,
        )
        return SessionNoteEdge.model_validate(response["data"])

    def get(self, id: str) -> SessionNoteEdge:
        """Get a note edge by ID."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/{quote(id, safe='')}",
        )
        return SessionNoteEdge.model_validate(response["data"])

    def list(
        self, params: Optional[ListNoteEdgesParams] = None
    ) -> PaginatedResult[SessionNoteEdge]:
        """List note edges."""
        qs: dict[str, str] = {}
        if params:
            if params.source_note_id:
                qs["sourceNoteId"] = params.source_note_id
            if params.target_note_id:
                qs["targetNoteId"] = params.target_note_id
            if params.relationship:
                qs["relationship"] = params.relationship
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges",
            params=qs if qs else None,
        )
        return self._parse_list(response, SessionNoteEdge)

    def traverse(
        self, params: TraverseNotesParams
    ) -> list[NoteTraversalResult]:
        """Traverse the note graph from a starting note."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/traverse",
            body,
        )
        return [
            NoteTraversalResult.model_validate(r) for r in response["data"]
        ]

    def delete(self, id: str) -> None:
        """Delete a note edge."""
        self._request(
            "DELETE",
            f"/v1/sessions/{quote(self._session_id, safe='')}/note-edges/{quote(id, safe='')}",
        )


# ============================================================================
# Session Stuck Detections
# ============================================================================


class SessionStuckDetectionsResource(BaseResource):
    """Async resource for session stuck detections, scoped to a specific session."""

    def __init__(self, client: AsyncEngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    async def create(
        self, params: CreateStuckDetectionParams
    ) -> StuckDetection:
        """Create a stuck detection."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections",
            body,
        )
        return StuckDetection.model_validate(response["data"])

    async def get(self, id: str) -> StuckDetection:
        """Get a stuck detection by ID."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/{quote(id, safe='')}",
        )
        return StuckDetection.model_validate(response["data"])

    async def list(
        self, params: Optional[ListStuckDetectionsParams] = None
    ) -> PaginatedResult[StuckDetection]:
        """List stuck detections."""
        qs: dict[str, str] = {}
        if params:
            if params.pattern_type:
                qs["patternType"] = params.pattern_type
            if params.resolved is not None:
                qs["resolved"] = str(params.resolved).lower()
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections",
            params=qs if qs else None,
        )
        return self._parse_list(response, StuckDetection)

    async def get_active(self) -> list[StuckDetection]:
        """Get active stuck detections."""
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/active",
        )
        return [StuckDetection.model_validate(d) for d in response["data"]]

    async def get_recent(
        self, pattern_type: Optional[str] = None
    ) -> Optional[StuckDetection]:
        """Get the most recent stuck detection."""
        qs: dict[str, str] = {}
        if pattern_type:
            qs["patternType"] = pattern_type
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/recent",
            params=qs if qs else None,
        )
        if response["data"] is None:
            return None
        return StuckDetection.model_validate(response["data"])

    async def check_cooldown(
        self, pattern_type: Optional[str] = None
    ) -> dict[str, bool]:
        """Check cooldown status."""
        qs: dict[str, str] = {}
        if pattern_type:
            qs["patternType"] = pattern_type
        response = await self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/cooldown",
            params=qs if qs else None,
        )
        return {"in_cooldown": response["data"].get("inCooldown", False)}

    async def resolve(
        self, id: str, params: Optional[ResolveStuckDetectionParams] = None
    ) -> StuckDetection:
        """Resolve a stuck detection."""
        body: dict[str, Any] = {}
        if params:
            body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/{quote(id, safe='')}/resolve",
            body,
        )
        return StuckDetection.model_validate(response["data"])


class SyncSessionStuckDetectionsResource(SyncBaseResource):
    """Sync resource for session stuck detections, scoped to a specific session."""

    def __init__(self, client: EngramClient, session_id: str) -> None:
        super().__init__(client)
        self._session_id = session_id

    def create(
        self, params: CreateStuckDetectionParams
    ) -> StuckDetection:
        """Create a stuck detection."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections",
            body,
        )
        return StuckDetection.model_validate(response["data"])

    def get(self, id: str) -> StuckDetection:
        """Get a stuck detection by ID."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/{quote(id, safe='')}",
        )
        return StuckDetection.model_validate(response["data"])

    def list(
        self, params: Optional[ListStuckDetectionsParams] = None
    ) -> PaginatedResult[StuckDetection]:
        """List stuck detections."""
        qs: dict[str, str] = {}
        if params:
            if params.pattern_type:
                qs["patternType"] = params.pattern_type
            if params.resolved is not None:
                qs["resolved"] = str(params.resolved).lower()
            if params.limit is not None:
                qs["limit"] = str(params.limit)
            if params.offset is not None:
                qs["offset"] = str(params.offset)
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections",
            params=qs if qs else None,
        )
        return self._parse_list(response, StuckDetection)

    def get_active(self) -> list[StuckDetection]:
        """Get active stuck detections."""
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/active",
        )
        return [StuckDetection.model_validate(d) for d in response["data"]]

    def get_recent(
        self, pattern_type: Optional[str] = None
    ) -> Optional[StuckDetection]:
        """Get the most recent stuck detection."""
        qs: dict[str, str] = {}
        if pattern_type:
            qs["patternType"] = pattern_type
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/recent",
            params=qs if qs else None,
        )
        if response["data"] is None:
            return None
        return StuckDetection.model_validate(response["data"])

    def check_cooldown(
        self, pattern_type: Optional[str] = None
    ) -> dict[str, bool]:
        """Check cooldown status."""
        qs: dict[str, str] = {}
        if pattern_type:
            qs["patternType"] = pattern_type
        response = self._request(
            "GET",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/cooldown",
            params=qs if qs else None,
        )
        return {"in_cooldown": response["data"].get("inCooldown", False)}

    def resolve(
        self, id: str, params: Optional[ResolveStuckDetectionParams] = None
    ) -> StuckDetection:
        """Resolve a stuck detection."""
        body: dict[str, Any] = {}
        if params:
            body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request(
            "POST",
            f"/v1/sessions/{quote(self._session_id, safe='')}/stuck-detections/{quote(id, safe='')}/resolve",
            body,
        )
        return StuckDetection.model_validate(response["data"])
