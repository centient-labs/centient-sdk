"""Tests for the events resource (SSE streaming)."""
from __future__ import annotations

import json
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator, List
from unittest.mock import MagicMock, patch

import httpx
import pytest

from engram.client import EngramClient
from engram.errors import EngramError
from engram.resources.events import (
    EventSubscription,
    EventsResource,
    SyncEventsResource,
    _build_events_url,
    _parse_sse_line,
)
from engram.types.events import EngramEventType, EngramStreamEvent


# ============================================================================
# SSE line parser unit tests
# ============================================================================


class TestParseSSELine:
    """Unit tests for the SSE line parser."""

    def test_data_line_buffers(self):
        """data: lines are buffered without emitting an event."""
        buf: dict = {}
        event = _parse_sse_line('data: {"id":"1","type":"crystal.created","timestamp":"t","entityType":"crystal","entityId":"c1","summary":"s"}', buf)
        assert event is None
        assert "data_lines" in buf

    def test_empty_line_flushes_buffer(self):
        """An empty line flushes the buffer and emits an event."""
        buf: dict = {}
        _parse_sse_line('data: {"id":"1","type":"crystal.created","timestamp":"t","entityType":"crystal","entityId":"c1","summary":"s"}', buf)
        event = _parse_sse_line("", buf)
        assert event is not None
        assert isinstance(event, EngramStreamEvent)
        assert event.id == "1"
        assert event.type == EngramEventType.CRYSTAL_CREATED
        assert event.entity_type == "crystal"
        assert event.entity_id == "c1"
        assert event.summary == "s"

    def test_comment_line_ignored(self):
        """Lines starting with : are comments and are ignored."""
        buf: dict = {}
        event = _parse_sse_line(":this is a comment", buf)
        assert event is None

    def test_event_line_ignored(self):
        """event: lines are informational and ignored (type comes from JSON)."""
        buf: dict = {}
        event = _parse_sse_line("event: crystal.created", buf)
        assert event is None

    def test_id_line_ignored(self):
        """id: lines are informational and ignored (id comes from JSON)."""
        buf: dict = {}
        event = _parse_sse_line("id: 42", buf)
        assert event is None

    def test_empty_line_without_buffer_is_noop(self):
        """An empty line without buffered data does not emit."""
        buf: dict = {}
        event = _parse_sse_line("", buf)
        assert event is None

    def test_multiline_data(self):
        """Multiple data: lines are concatenated."""
        buf: dict = {}
        _parse_sse_line('data: {"id":"1","type":"crystal.created",', buf)
        _parse_sse_line('data: "timestamp":"t","entityType":"crystal","entityId":"c1","summary":"s"}', buf)
        event = _parse_sse_line("", buf)
        assert event is not None
        assert event.id == "1"

    def test_invalid_json_returns_none(self):
        """Invalid JSON is logged and returns None."""
        buf: dict = {}
        _parse_sse_line("data: NOT_JSON", buf)
        event = _parse_sse_line("", buf)
        assert event is None

    def test_data_with_optional_data_field(self):
        """Events with an optional data payload parse correctly."""
        buf: dict = {}
        payload = {
            "id": "2",
            "type": "note.created",
            "timestamp": "2026-01-01T00:00:00Z",
            "entityType": "note",
            "entityId": "n1",
            "summary": "Note created",
            "data": {"content": "hello"},
        }
        _parse_sse_line(f"data: {json.dumps(payload)}", buf)
        event = _parse_sse_line("", buf)
        assert event is not None
        assert event.data == {"content": "hello"}

    def test_buffer_clears_after_flush(self):
        """Buffer is cleared after flushing an event."""
        buf: dict = {}
        _parse_sse_line('data: {"id":"1","type":"crystal.created","timestamp":"t","entityType":"crystal","entityId":"c1","summary":"s"}', buf)
        _parse_sse_line("", buf)
        assert buf == {}


# ============================================================================
# URL builder tests
# ============================================================================


class TestBuildEventsUrl:
    def test_no_types(self):
        path, params = _build_events_url(None)
        assert path == "/v1/events"
        assert params is None

    def test_empty_types(self):
        path, params = _build_events_url([])
        assert path == "/v1/events"
        assert params is None

    def test_single_type(self):
        path, params = _build_events_url([EngramEventType.CRYSTAL_CREATED])
        assert path == "/v1/events"
        assert params == {"types": "crystal.created"}

    def test_multiple_types(self):
        path, params = _build_events_url([
            EngramEventType.CRYSTAL_CREATED,
            EngramEventType.NOTE_CREATED,
        ])
        assert path == "/v1/events"
        assert params == {"types": "crystal.created,note.created"}


# ============================================================================
# EventSubscription tests
# ============================================================================


class TestEventSubscription:
    def test_initial_state(self):
        sub = EventSubscription()
        assert sub.closed is False
        assert sub._response is None

    def test_close(self):
        sub = EventSubscription()
        sub.close()
        assert sub.closed is True

    def test_close_with_response(self):
        sub = EventSubscription()
        mock_response = MagicMock()
        sub._response = mock_response
        sub.close()
        assert sub.closed is True
        mock_response.close.assert_called_once()


# ============================================================================
# EngramStreamEvent model tests
# ============================================================================


class TestEngramStreamEvent:
    def test_parse_from_dict(self):
        data = {
            "id": "evt-1",
            "type": "crystal.created",
            "timestamp": "2026-01-01T00:00:00Z",
            "entityType": "crystal",
            "entityId": "kc-123",
            "summary": "Crystal created",
            "data": {"title": "My Crystal"},
        }
        event = EngramStreamEvent.model_validate(data)
        assert event.id == "evt-1"
        assert event.type == EngramEventType.CRYSTAL_CREATED
        assert event.entity_type == "crystal"
        assert event.entity_id == "kc-123"
        assert event.summary == "Crystal created"
        assert event.data == {"title": "My Crystal"}

    def test_parse_without_data(self):
        data = {
            "id": "evt-2",
            "type": "session.started",
            "timestamp": "2026-01-01T00:00:00Z",
            "entityType": "session",
            "entityId": "sess-1",
            "summary": "Session started",
        }
        event = EngramStreamEvent.model_validate(data)
        assert event.data is None

    def test_all_event_types(self):
        """All enum values are valid."""
        expected = {
            "crystal.created",
            "crystal.updated",
            "crystal.deleted",
            "note.created",
            "note.updated",
            "note.deleted",
            "session.started",
            "session.ended",
            "coherence.contradiction_detected",
        }
        assert {e.value for e in EngramEventType} == expected


# ============================================================================
# EngramEventType tests
# ============================================================================


class TestEngramEventType:
    def test_string_value(self):
        assert EngramEventType.CRYSTAL_CREATED == "crystal.created"
        assert str(EngramEventType.CRYSTAL_CREATED) == "EngramEventType.CRYSTAL_CREATED"
        assert EngramEventType.CRYSTAL_CREATED.value == "crystal.created"

    def test_is_str_subclass(self):
        """EngramEventType instances are str instances (str, Enum)."""
        assert isinstance(EngramEventType.CRYSTAL_CREATED, str)


# ============================================================================
# SyncEventsResource tests
# ============================================================================


def _make_sse_body(events: List[dict]) -> str:
    """Build a raw SSE body from a list of event dicts."""
    lines = []
    for evt in events:
        lines.append(f"data: {json.dumps(evt)}")
        lines.append("")  # blank line = event boundary
    return "\n".join(lines)


SAMPLE_SSE_EVENT = {
    "id": "evt-1",
    "type": "crystal.created",
    "timestamp": "2026-01-01T00:00:00Z",
    "entityType": "crystal",
    "entityId": "kc-1",
    "summary": "Crystal created",
}


class _FakeStreamResponse:
    """Minimal fake for httpx streaming response context."""

    def __init__(self, lines: List[str], status_code: int = 200):
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self._lines = lines
        self.text = ""

    def iter_lines(self) -> Iterator[str]:
        yield from self._lines

    def read(self):
        pass

    def close(self):
        pass

    def json(self):
        return {"code": "HTTP_ERROR", "message": "Error"}


class TestSyncEventsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    def test_subscribe_requires_callback(self):
        """subscribe() raises ValueError without on_event."""
        with pytest.raises(ValueError, match="on_event"):
            self.client.events.subscribe()

    def test_subscribe_iter_yields_events(self):
        """subscribe_iter yields parsed events from SSE stream."""
        sse_lines = [
            f"data: {json.dumps(SAMPLE_SSE_EVENT)}",
            "",
        ]
        fake_response = _FakeStreamResponse(sse_lines)

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            events = list(self.client.events.subscribe_iter())

        assert len(events) == 1
        assert events[0].id == "evt-1"
        assert events[0].type == EngramEventType.CRYSTAL_CREATED

    def test_subscribe_iter_with_type_filter(self):
        """subscribe_iter passes type filter as query params."""
        sse_lines = [
            f"data: {json.dumps(SAMPLE_SSE_EVENT)}",
            "",
        ]
        fake_response = _FakeStreamResponse(sse_lines)
        captured_kwargs: dict = {}

        @contextmanager
        def fake_stream(method, url, **kwargs):
            captured_kwargs.update(kwargs)
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            events = list(self.client.events.subscribe_iter(
                types=[EngramEventType.CRYSTAL_CREATED]
            ))

        assert captured_kwargs.get("params") == {"types": "crystal.created"}

    def test_subscribe_iter_error_response(self):
        """subscribe_iter raises EngramError on non-2xx response."""
        fake_response = _FakeStreamResponse([], status_code=401)

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            with pytest.raises(EngramError):
                list(self.client.events.subscribe_iter())

    def test_subscribe_iter_multiple_events(self):
        """subscribe_iter yields multiple events."""
        event2 = {
            "id": "evt-2",
            "type": "note.created",
            "timestamp": "2026-01-01T00:00:01Z",
            "entityType": "note",
            "entityId": "n-1",
            "summary": "Note created",
        }
        sse_lines = [
            f"data: {json.dumps(SAMPLE_SSE_EVENT)}",
            "",
            f"data: {json.dumps(event2)}",
            "",
        ]
        fake_response = _FakeStreamResponse(sse_lines)

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            events = list(self.client.events.subscribe_iter())

        assert len(events) == 2
        assert events[0].type == EngramEventType.CRYSTAL_CREATED
        assert events[1].type == EngramEventType.NOTE_CREATED

    def test_subscribe_iter_skips_comments(self):
        """subscribe_iter ignores SSE comment lines."""
        sse_lines = [
            ":this is a heartbeat",
            f"data: {json.dumps(SAMPLE_SSE_EVENT)}",
            "",
        ]
        fake_response = _FakeStreamResponse(sse_lines)

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            events = list(self.client.events.subscribe_iter())

        assert len(events) == 1

    def test_subscribe_sends_api_key(self):
        """subscribe sends X-API-Key header when configured."""
        client = EngramClient(base_url="http://test:3100", api_key="test-key", allow_insecure=True)
        fake_response = _FakeStreamResponse([])
        captured_kwargs: dict = {}

        @contextmanager
        def fake_stream(method, url, **kwargs):
            captured_kwargs.update(kwargs)
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            list(client.events.subscribe_iter())

        assert captured_kwargs.get("headers", {}).get("X-API-Key") == "test-key"
        client.close()

    def test_subscribe_callback_receives_events(self):
        """subscribe() calls on_event for each received event."""
        sse_lines = [
            f"data: {json.dumps(SAMPLE_SSE_EVENT)}",
            "",
        ]
        fake_response = _FakeStreamResponse(sse_lines)
        received: List[EngramStreamEvent] = []

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield fake_response

        with patch("httpx.Client.stream", side_effect=fake_stream):
            sub = self.client.events.subscribe(on_event=lambda e: received.append(e))
            # Wait briefly for the background thread to process
            if sub._thread:
                sub._thread.join(timeout=2.0)

        assert len(received) == 1
        assert received[0].id == "evt-1"

    def test_subscribe_error_callback(self):
        """subscribe() calls on_error when connection fails."""
        errors: List[Exception] = []

        @contextmanager
        def fake_stream(method, url, **kwargs):
            yield _FakeStreamResponse([], status_code=500)

        with patch("httpx.Client.stream", side_effect=fake_stream):
            sub = self.client.events.subscribe(
                on_event=lambda e: None,
                on_error=lambda e: errors.append(e),
            )
            if sub._thread:
                sub._thread.join(timeout=2.0)

        assert len(errors) == 1
        assert isinstance(errors[0], EngramError)


# ============================================================================
# Import/export sanity checks
# ============================================================================


class TestImports:
    def test_types_importable_from_engram(self):
        """Event types are importable from the top-level engram package."""
        from engram import EngramEventType, EngramStreamEvent, EventSubscription
        assert EngramEventType is not None
        assert EngramStreamEvent is not None
        assert EventSubscription is not None

    def test_resource_importable_from_engram(self):
        """Event resources are importable from the top-level engram package."""
        from engram import EventsResource, SyncEventsResource
        assert EventsResource is not None
        assert SyncEventsResource is not None

    def test_client_has_events_attribute(self):
        """Both sync and async clients expose an events attribute."""
        client = EngramClient(base_url="http://test:3100")
        assert hasattr(client, "events")
        assert isinstance(client.events, SyncEventsResource)
        client.close()
