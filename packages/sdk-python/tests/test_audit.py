"""Tests for audit resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.errors import EngramError, NotFoundError
from engram.types.audit import (
    AuditBatchIngestParams,
    AuditBatchIngestResult,
    AuditEvent,
    AuditFlushResult,
    AuditIngestParams,
    AuditIngestResult,
    AuditListParams,
    AuditPruneParams,
    AuditPruneResult,
    AuditStats,
    AuditStatsParams,
)
from tests.conftest import make_api_response


SAMPLE_AUDIT_EVENT = {
    "id": "audit-001",
    "timestamp": "2026-01-01T00:00:00Z",
    "level": "info",
    "component": "sdk",
    "message": "Test event",
    "service": "engram",
    "version": "0.16.0",
    "pid": 1234,
    "hostname": "localhost",
    "eventType": "tool_call",
    "tool": "search",
    "outcome": "success",
    "durationMs": 150,
    "projectPath": "/test",
    "sessionId": "sess-123",
    "input": {"query": "test"},
    "output": {"count": 5},
    "context": {},
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
}


class TestSyncAuditResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_ingest(self, mock_request):
        """Ingest single event returns AuditIngestResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"accepted": True}),
            request=httpx.Request("POST", "http://test:3100/v1/audit/ingest"),
        )

        params = AuditIngestParams(
            level="info",
            component="sdk",
            message="Test event",
        )
        result = self.client.audit.ingest(params)

        assert isinstance(result, AuditIngestResult)
        assert result.accepted is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/audit/ingest" in call_args[0][1]
        body = call_args.kwargs.get("json", {})
        assert body["level"] == "info"
        assert body["component"] == "sdk"

    @patch.object(httpx.Client, "request")
    def test_ingest_with_all_fields(self, mock_request):
        """Ingest with all optional fields sends correct camelCase body."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"accepted": True}),
            request=httpx.Request("POST", "http://test:3100/v1/audit/ingest"),
        )

        params = AuditIngestParams(
            level="warn",
            component="api",
            message="Warning event",
            event_type="tool_call",
            tool="search",
            outcome="failure",
            duration_ms=200,
            project_path="/test",
            session_id="sess-123",
        )
        self.client.audit.ingest(params)

        call_args = mock_request.call_args
        body = call_args.kwargs.get("json", {})
        assert body["eventType"] == "tool_call"
        assert body["durationMs"] == 200
        assert body["projectPath"] == "/test"
        assert body["sessionId"] == "sess-123"

    @patch.object(httpx.Client, "request")
    def test_ingest_batch(self, mock_request):
        """Ingest batch returns AuditBatchIngestResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"accepted": 3}),
            request=httpx.Request("POST", "http://test:3100/v1/audit/ingest/batch"),
        )

        events = [
            AuditIngestParams(level="info", component="sdk", message=f"Event {i}")
            for i in range(3)
        ]
        params = AuditBatchIngestParams(events=events)
        result = self.client.audit.ingest_batch(params)

        assert isinstance(result, AuditBatchIngestResult)
        assert result.accepted == 3
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/audit/ingest/batch" in call_args[0][1]
        body = call_args.kwargs.get("json", {})
        assert len(body["events"]) == 3

    @patch.object(httpx.Client, "request")
    def test_flush(self, mock_request):
        """Flush returns AuditFlushResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"flushed": True}),
            request=httpx.Request("POST", "http://test:3100/v1/audit/flush"),
        )

        result = self.client.audit.flush()

        assert isinstance(result, AuditFlushResult)
        assert result.flushed is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/audit/flush" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_events(self, mock_request):
        """List events returns PaginatedResult[AuditEvent]."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_AUDIT_EVENT], total=1),
            request=httpx.Request("GET", "http://test:3100/v1/audit/events"),
        )

        result = self.client.audit.list_events()

        assert len(result.items) == 1
        assert isinstance(result.items[0], AuditEvent)
        assert result.items[0].id == "audit-001"
        assert result.total == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/audit/events" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_events_with_filters(self, mock_request):
        """List events with filter params sends correct query params."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([], total=0),
            request=httpx.Request("GET", "http://test:3100/v1/audit/events"),
        )

        params = AuditListParams(
            level="error",
            component="sdk",
            limit=10,
        )
        self.client.audit.list_events(params)

        call_args = mock_request.call_args
        passed_params = call_args.kwargs.get("params")
        assert passed_params is not None
        # Convert list of tuples to dict for easy checking
        params_dict = dict(passed_params)
        assert params_dict.get("level") == "error"
        assert params_dict.get("component") == "sdk"
        assert params_dict.get("limit") == "10"

    @patch.object(httpx.Client, "request")
    def test_get_event(self, mock_request):
        """Get event by ID returns AuditEvent."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_AUDIT_EVENT),
            request=httpx.Request("GET", "http://test:3100/v1/audit/events/audit-001"),
        )

        result = self.client.audit.get_event("audit-001")

        assert isinstance(result, AuditEvent)
        assert result.id == "audit-001"
        assert result.level == "info"
        assert result.component == "sdk"
        assert result.event_type == "tool_call"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/audit/events/audit-001" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_event_not_found(self, mock_request):
        """Get event raises NotFoundError on 404."""
        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "event not found"},
            request=httpx.Request("GET", "http://test:3100/v1/audit/events/missing"),
        )

        with pytest.raises(NotFoundError, match="event not found"):
            self.client.audit.get_event("missing")

    @patch.object(httpx.Client, "request")
    def test_get_stats(self, mock_request):
        """Get stats returns AuditStats."""
        stats_data = {
            "total": 100,
            "byLevel": {"info": 80, "error": 20},
            "byOutcome": {"success": 90, "failure": 10},
            "byComponent": {"sdk": 60, "api": 40},
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(stats_data),
            request=httpx.Request("GET", "http://test:3100/v1/audit/stats"),
        )

        result = self.client.audit.get_stats()

        assert isinstance(result, AuditStats)
        assert result.total == 100
        assert result.by_level["info"] == 80
        assert result.by_outcome["success"] == 90
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/audit/stats" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_stats_with_params(self, mock_request):
        """Get stats with date range sends query params."""
        stats_data = {
            "total": 50,
            "byLevel": {"info": 50},
            "byOutcome": {"success": 50},
            "byComponent": {"sdk": 50},
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(stats_data),
            request=httpx.Request("GET", "http://test:3100/v1/audit/stats"),
        )

        params = AuditStatsParams(
            since="2026-01-01T00:00:00Z",
            until="2026-01-31T23:59:59Z",
        )
        self.client.audit.get_stats(params)

        call_args = mock_request.call_args
        passed_params = call_args.kwargs.get("params")
        assert passed_params is not None
        params_dict = dict(passed_params)
        assert params_dict.get("since") == "2026-01-01T00:00:00Z"
        assert params_dict.get("until") == "2026-01-31T23:59:59Z"

    @patch.object(httpx.Client, "request")
    def test_prune(self, mock_request):
        """Prune returns AuditPruneResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response({"deleted": 42}),
            request=httpx.Request("DELETE", "http://test:3100/v1/audit/prune"),
        )

        params = AuditPruneParams(older_than_days=30)
        result = self.client.audit.prune(params)

        assert isinstance(result, AuditPruneResult)
        assert result.deleted == 42
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/audit/prune" in call_args[0][1]
        body = call_args.kwargs.get("json", {})
        assert body["olderThanDays"] == 30

    @patch.object(httpx.Client, "request")
    def test_prune_error(self, mock_request):
        """Prune raises EngramError on validation error."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "olderThanDays must be positive"},
            request=httpx.Request("DELETE", "http://test:3100/v1/audit/prune"),
        )

        params = AuditPruneParams(older_than_days=-1)
        with pytest.raises(EngramError, match="olderThanDays must be positive"):
            self.client.audit.prune(params)
