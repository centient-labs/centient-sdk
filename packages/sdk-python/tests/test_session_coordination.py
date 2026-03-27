"""Tests for session coordination resources (constraints, decision points, branches, note edges, stuck detections)."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.resources.session_coordination import (
    SyncSessionConstraintsResource,
    SyncSessionDecisionPointsResource,
    SyncSessionBranchesResource,
    SyncSessionNoteEdgesResource,
    SyncSessionStuckDetectionsResource,
)
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
    ExplorationBranch,
    NoteTraversalResult,
    SessionConstraint,
    SessionNoteEdge,
    StuckDetection,
    TraverseNotesParams,
)
from tests.conftest import (
    make_api_response,
    SAMPLE_BRANCH,
    SAMPLE_CONSTRAINT,
    SAMPLE_DECISION_POINT,
    SAMPLE_NOTE_EDGE,
    SAMPLE_STUCK_DETECTION,
)


# ============================================================================
# Constraints
# ============================================================================


class TestSyncSessionConstraintsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncSessionConstraintsResource(self.client, "sess-123")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_constraint(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CONSTRAINT),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/constraints"),
        )

        params = CreateConstraintParams(content="No console.log", scope="session")
        constraint = self.resource.create(params)

        assert isinstance(constraint, SessionConstraint)
        assert constraint.id == "con-1"
        assert constraint.active is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/constraints" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_active_constraints(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CONSTRAINT]),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/constraints/active"),
        )

        constraints = self.resource.get_active()

        assert len(constraints) == 1
        assert isinstance(constraints[0], SessionConstraint)
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/sessions/sess-123/constraints/active" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_lift_constraint(self, mock_request):
        lifted = {**SAMPLE_CONSTRAINT, "active": False, "liftReason": "No longer needed"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(lifted),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/constraints/con-1/lift"),
        )

        constraint = self.resource.lift("con-1", reason="No longer needed")

        assert isinstance(constraint, SessionConstraint)
        assert constraint.active is False
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/constraints/con-1/lift" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_check_violations(self, mock_request):
        violation_data = {
            "violations": [
                {
                    "constraintId": "con-1",
                    "content": "No console.log",
                    "matchedKeywords": ["console"],
                    "severity": "high",
                }
            ],
            "hasViolations": True,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(violation_data),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/constraints/check"),
        )

        result = self.resource.check_violations("console.log('test')")

        assert result["has_violations"] is True
        assert len(result["violations"]) == 1
        assert isinstance(result["violations"][0], ConstraintViolation)
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/constraints/check" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_constraints(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_CONSTRAINT], total=1, has_more=False),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/constraints"),
        )

        result = self.resource.list()

        assert len(result.items) == 1
        assert result.total == 1
        assert result.has_more is False


# ============================================================================
# Decision Points
# ============================================================================


class TestSyncSessionDecisionPointsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncSessionDecisionPointsResource(self.client, "sess-123")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_decision_point(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_DECISION_POINT),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/decision-points"),
        )

        params = CreateDecisionPointParams(
            description="Choose DB",
            category="architecture",
        )
        dp = self.resource.create(params)

        assert isinstance(dp, DecisionPoint)
        assert dp.id == "dp-1"
        assert dp.description == "Choose DB"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/decision-points" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_resolve_decision_point(self, mock_request):
        resolved = {**SAMPLE_DECISION_POINT, "resolved": True, "chosenBranchId": "branch-1"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(resolved),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/decision-points/dp-1/resolve"),
        )

        dp = self.resource.resolve("dp-1", chosen_branch_id="branch-1")

        assert isinstance(dp, DecisionPoint)
        assert dp.resolved is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/decision-points/dp-1/resolve" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_decision_points(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_DECISION_POINT], total=1, has_more=False),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/decision-points"),
        )

        result = self.resource.list()

        assert len(result.items) == 1
        assert result.total == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"

    @patch.object(httpx.Client, "request")
    def test_get_decision_point(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_DECISION_POINT),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/decision-points/dp-1"),
        )

        dp = self.resource.get("dp-1")

        assert isinstance(dp, DecisionPoint)
        assert dp.category == "architecture"


# ============================================================================
# Branches
# ============================================================================


class TestSyncSessionBranchesResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncSessionBranchesResource(self.client, "sess-123")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_branch(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_BRANCH),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/branches"),
        )

        params = CreateBranchParams(
            decision_point_id="dp-1",
            label="Try Postgres",
        )
        branch = self.resource.create(params)

        assert isinstance(branch, ExplorationBranch)
        assert branch.id == "branch-1"
        assert branch.label == "Try Postgres"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/branches" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_switch_branch(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"branchId": "branch-1"}),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/branches/switch"),
        )

        result = self.resource.switch("branch-1")

        assert result["branchId"] == "branch-1"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/branches/switch" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_close_branch(self, mock_request):
        closed = {**SAMPLE_BRANCH, "status": "merged", "closedReason": "Chosen approach"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(closed),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/branches/branch-1/close"),
        )

        params = CloseBranchParams(action="merge", reason="Chosen approach")
        branch = self.resource.close("branch-1", params)

        assert isinstance(branch, ExplorationBranch)
        assert branch.status == "merged"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/branches/branch-1/close" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_tree(self, mock_request):
        tree_data = [
            {
                "decisionPointId": "dp-1",
                "description": "Choose DB",
                "branches": [
                    {
                        "id": "branch-1",
                        "label": "Try Postgres",
                        "status": "active",
                        "isActive": True,
                        "isChosen": False,
                    }
                ],
            }
        ]
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(tree_data),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/branches/tree"),
        )

        tree = self.resource.get_tree()

        assert len(tree) == 1
        assert isinstance(tree[0], BranchTreeNode)
        assert tree[0].description == "Choose DB"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/branches/tree" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_active_branch(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_BRANCH),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/branches/active"),
        )

        branch = self.resource.get_active()

        assert isinstance(branch, ExplorationBranch)
        assert branch.id == "branch-1"

    @patch.object(httpx.Client, "request")
    def test_get_active_branch_returns_none(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(None),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/branches/active"),
        )

        branch = self.resource.get_active()

        assert branch is None


# ============================================================================
# Note Edges
# ============================================================================


class TestSyncSessionNoteEdgesResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncSessionNoteEdgesResource(self.client, "sess-123")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_note_edge(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_NOTE_EDGE),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/note-edges"),
        )

        params = CreateNoteEdgeParams(
            source_note_id="note-456",
            target_note_id="note-789",
            relationship="related_to",
        )
        edge = self.resource.create(params)

        assert isinstance(edge, SessionNoteEdge)
        assert edge.id == "ne-1"
        assert edge.relationship == "related_to"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/note-edges" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_traverse_note_edges(self, mock_request):
        traversal_data = [
            {"noteId": "note-789", "depth": 1, "path": ["note-456", "note-789"]},
        ]
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(traversal_data),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/note-edges/traverse"),
        )

        params = TraverseNotesParams(start_note_id="note-456", max_depth=3)
        results = self.resource.traverse(params)

        assert len(results) == 1
        assert isinstance(results[0], NoteTraversalResult)
        assert results[0].note_id == "note-789"
        assert results[0].depth == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/note-edges/traverse" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_note_edges(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_NOTE_EDGE], total=1, has_more=False),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/note-edges"),
        )

        result = self.resource.list()

        assert len(result.items) == 1
        assert result.total == 1
        assert isinstance(result.items[0], SessionNoteEdge)

    @patch.object(httpx.Client, "request")
    def test_delete_note_edge(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/sessions/sess-123/note-edges/ne-1"),
        )

        self.resource.delete("ne-1")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/note-edges/ne-1" in call_args[0][1]


# ============================================================================
# Stuck Detections
# ============================================================================


class TestSyncSessionStuckDetectionsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncSessionStuckDetectionsResource(self.client, "sess-123")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_stuck_detection(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_STUCK_DETECTION),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/stuck-detections"),
        )

        params = CreateStuckDetectionParams(
            pattern_type="repeated_blocker",
            confidence=0.85,
            description="Same error repeated",
        )
        detection = self.resource.create(params)

        assert isinstance(detection, StuckDetection)
        assert detection.id == "stuck-1"
        assert detection.pattern_type == "repeated_blocker"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/sessions/sess-123/stuck-detections" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_recent_stuck_detection(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_STUCK_DETECTION),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/stuck-detections/recent"),
        )

        detection = self.resource.get_recent()

        assert isinstance(detection, StuckDetection)
        assert detection.confidence == 0.85
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/stuck-detections/recent" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_recent_returns_none(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(None),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/stuck-detections/recent"),
        )

        detection = self.resource.get_recent()

        assert detection is None

    @patch.object(httpx.Client, "request")
    def test_check_cooldown(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"inCooldown": True}),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/stuck-detections/cooldown"),
        )

        result = self.resource.check_cooldown()

        assert result["in_cooldown"] is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/stuck-detections/cooldown" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_check_cooldown_not_active(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"inCooldown": False}),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/stuck-detections/cooldown"),
        )

        result = self.resource.check_cooldown()

        assert result["in_cooldown"] is False

    @patch.object(httpx.Client, "request")
    def test_get_active_stuck_detections(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_STUCK_DETECTION]),
            request=httpx.Request("GET", "http://test:3100/v1/sessions/sess-123/stuck-detections/active"),
        )

        detections = self.resource.get_active()

        assert len(detections) == 1
        assert isinstance(detections[0], StuckDetection)

    @patch.object(httpx.Client, "request")
    def test_resolve_stuck_detection(self, mock_request):
        resolved = {**SAMPLE_STUCK_DETECTION, "resolved": True, "resolutionNotes": "Fixed it"}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(resolved),
            request=httpx.Request("POST", "http://test:3100/v1/sessions/sess-123/stuck-detections/stuck-1/resolve"),
        )

        detection = self.resource.resolve("stuck-1")

        assert isinstance(detection, StuckDetection)
        assert detection.resolved is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/stuck-detections/stuck-1/resolve" in call_args[0][1]
