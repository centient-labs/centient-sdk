"""Tests for session links resource."""
from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from engram.client import EngramClient
from engram.types.coordination import (
    CreateSessionLinkParams,
    SessionLink,
)
from tests.conftest import make_api_response, SAMPLE_SESSION_LINK


class TestSyncSessionLinksResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_session_link(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SESSION_LINK),
            request=httpx.Request("POST", "http://test:3100/v1/session-links"),
        )

        params = CreateSessionLinkParams(
            source_session_id="sess-123",
            target_session_id="sess-456",
            relationship="builds_on",
        )
        link = self.client.session_links.create(params)

        assert isinstance(link, SessionLink)
        assert link.id == "sl-1"
        assert link.relationship == "builds_on"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/session-links" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_get_session_link(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_SESSION_LINK),
            request=httpx.Request("GET", "http://test:3100/v1/session-links/sl-1"),
        )

        link = self.client.session_links.get("sl-1")

        assert isinstance(link, SessionLink)
        assert link.source_session_id == "sess-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/session-links/sl-1" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_delete_session_link(self, mock_request):
        mock_request.return_value = httpx.Response(
            204,
            request=httpx.Request("DELETE", "http://test:3100/v1/session-links/sl-1"),
        )

        self.client.session_links.delete("sl-1")

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert "/v1/session-links/sl-1" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_outgoing_links(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_SESSION_LINK], total=1, has_more=False),
            request=httpx.Request(
                "GET", "http://test:3100/v1/session-links/outgoing/sess-123"
            ),
        )

        result = self.client.session_links.list_outgoing("sess-123")

        assert len(result.items) == 1
        assert result.total == 1
        assert result.has_more is False
        assert isinstance(result.items[0], SessionLink)
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/session-links/outgoing/sess-123" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_incoming_links(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([SAMPLE_SESSION_LINK], total=1, has_more=False),
            request=httpx.Request(
                "GET", "http://test:3100/v1/session-links/incoming/sess-456"
            ),
        )

        result = self.client.session_links.list_incoming("sess-456")

        assert len(result.items) == 1
        assert result.total == 1
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/session-links/incoming/sess-456" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_list_outgoing_empty(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([], total=0, has_more=False),
            request=httpx.Request(
                "GET", "http://test:3100/v1/session-links/outgoing/sess-999"
            ),
        )

        result = self.client.session_links.list_outgoing("sess-999")

        assert len(result.items) == 0
        assert result.total == 0
