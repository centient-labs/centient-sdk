"""Tests for the agents resource.

Mirrors the TS resource-test pattern: assert request path/method/body/query and
response parsing. Agent responses use a NESTED envelope — ``{ data: { agent } }``
for a single agent and ``{ data: { agents } }`` for a list — so the resource
must unwrap the inner ``agent``/``agents`` key, not treat ``data`` as the payload.

The resource is instantiated directly against the client (rather than via a
``client.agents`` attribute) so these tests do not depend on central client
wiring done by the coordinator.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import EngramError
from engram.resources.agents import AgentsResource, SyncAgentsResource
from engram.types.agents import (
    AgentIdentity,
    CreateAgentParams,
    ListAgentsParams,
    UpdateAgentParams,
)


SAMPLE_AGENT = {
    "agentId": "agent-123",
    "externalId": "ext-abc",
    "displayName": "Test Agent",
    "role": "assistant",
    "permissions": ["read", "write"],
    "ownerUserId": "user-1",
    "createdAt": "2026-01-01T00:00:00Z",
    "lastActiveAt": None,
}


def _resp(json_data, method="GET", path="/v1/agents") -> httpx.Response:
    return httpx.Response(
        200,
        json=json_data,
        request=httpx.Request(method, f"http://test:3100{path}"),
    )


class TestSyncAgentsResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.agents = SyncAgentsResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_posts_and_unwraps_agent(self, mock_request):
        mock_request.return_value = _resp({"data": {"agent": SAMPLE_AGENT}}, "POST")

        result = self.agents.create(
            CreateAgentParams(
                external_id="ext-abc",
                display_name="Test Agent",
                role="assistant",
                permissions=["read", "write"],
                owner_user_id="user-1",
            )
        )

        assert isinstance(result, AgentIdentity)
        assert result.agent_id == "agent-123"
        assert result.external_id == "ext-abc"
        assert result.permissions == ["read", "write"]
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/agents"
        # snake_case params serialize to camelCase wire fields; None dropped.
        assert call_args[1]["json"] == {
            "externalId": "ext-abc",
            "displayName": "Test Agent",
            "role": "assistant",
            "permissions": ["read", "write"],
            "ownerUserId": "user-1",
        }

    @patch.object(httpx.Client, "request")
    def test_create_drops_unset_optionals(self, mock_request):
        mock_request.return_value = _resp({"data": {"agent": SAMPLE_AGENT}}, "POST")

        self.agents.create(
            CreateAgentParams(external_id="ext-abc", display_name="Test Agent")
        )

        assert mock_request.call_args[1]["json"] == {
            "externalId": "ext-abc",
            "displayName": "Test Agent",
        }

    @patch.object(httpx.Client, "request")
    def test_list_unwraps_agents_array(self, mock_request):
        mock_request.return_value = _resp({"data": {"agents": [SAMPLE_AGENT]}})

        result = self.agents.list()

        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].agent_id == "agent-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/agents"
        # No filter -> no query params reach httpx.
        assert "params" not in call_args[1] or call_args[1]["params"] is None

    @patch.object(httpx.Client, "request")
    def test_list_passes_owner_filter_as_query(self, mock_request):
        mock_request.return_value = _resp({"data": {"agents": []}})

        result = self.agents.list(ListAgentsParams(owner_user_id="user-9"))

        assert result == []
        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/agents"
        assert call_args[1]["params"] == {"ownerUserId": "user-9"}

    @patch.object(httpx.Client, "request")
    def test_get_unwraps_agent(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"agent": SAMPLE_AGENT}}, path="/v1/agents/agent-123"
        )

        result = self.agents.get("agent-123")

        assert result.agent_id == "agent-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/agents/agent-123"

    @patch.object(httpx.Client, "request")
    def test_get_url_encodes_id(self, mock_request):
        mock_request.return_value = _resp({"data": {"agent": SAMPLE_AGENT}})

        self.agents.get("a/b c")

        assert mock_request.call_args[0][1] == "/v1/agents/a%2Fb%20c"

    @patch.object(httpx.Client, "request")
    def test_update_puts_and_unwraps_agent(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"agent": SAMPLE_AGENT}}, "PUT", "/v1/agents/agent-123"
        )

        result = self.agents.update(
            "agent-123",
            UpdateAgentParams(display_name="Renamed", permissions=["read"]),
        )

        assert result.agent_id == "agent-123"
        call_args = mock_request.call_args
        assert call_args[0][0] == "PUT"
        assert call_args[0][1] == "/v1/agents/agent-123"
        assert call_args[1]["json"] == {
            "displayName": "Renamed",
            "permissions": ["read"],
        }

    @patch.object(httpx.Client, "request")
    def test_delete_unwraps_deleted(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"deleted": True}}, "DELETE", "/v1/agents/agent-123"
        )

        result = self.agents.delete("agent-123")

        assert result.deleted is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert call_args[0][1] == "/v1/agents/agent-123"

    @patch.object(httpx.Client, "request")
    def test_get_rejects_missing_agent_key(self, mock_request):
        # A response missing the inner `agent` key must fail loudly (mirrors the
        # TS resource's ResponseShapeError), not return a model with empty fields.
        mock_request.return_value = _resp({"data": {}})

        with pytest.raises(EngramError) as exc_info:
            self.agents.get("agent-123")
        assert exc_info.value.code == "INTERNAL_ERROR"

    @patch.object(httpx.Client, "request")
    def test_list_rejects_non_array_agents(self, mock_request):
        mock_request.return_value = _resp({"data": {"agents": "nope"}})

        with pytest.raises(EngramError) as exc_info:
            self.agents.list()
        assert exc_info.value.code == "INTERNAL_ERROR"


class TestAsyncAgentsResource:
    @pytest.mark.asyncio
    async def test_async_create_unwraps_agent(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        agents = AgentsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*args, **kwargs):
                    return _resp({"data": {"agent": SAMPLE_AGENT}}, "POST")

                mock_request.side_effect = _r
                result = await agents.create(
                    CreateAgentParams(external_id="ext-abc", display_name="Test Agent")
                )
                assert isinstance(result, AgentIdentity)
                assert result.agent_id == "agent-123"
                call_args = mock_request.call_args
                assert call_args[0][0] == "POST"
                assert call_args[0][1] == "/v1/agents"
                assert call_args[1]["json"] == {
                    "externalId": "ext-abc",
                    "displayName": "Test Agent",
                }
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_list_with_filter(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        agents = AgentsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*args, **kwargs):
                    return _resp({"data": {"agents": [SAMPLE_AGENT]}})

                mock_request.side_effect = _r
                result = await agents.list(ListAgentsParams(owner_user_id="user-9"))
                assert len(result) == 1
                call_args = mock_request.call_args
                assert call_args[0][1] == "/v1/agents"
                assert call_args[1]["params"] == {"ownerUserId": "user-9"}
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_delete(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        agents = AgentsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*args, **kwargs):
                    return _resp(
                        {"data": {"deleted": True}}, "DELETE", "/v1/agents/agent-123"
                    )

                mock_request.side_effect = _r
                result = await agents.delete("agent-123")
                assert result.deleted is True
                assert mock_request.call_args[0][0] == "DELETE"
                assert mock_request.call_args[0][1] == "/v1/agents/agent-123"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get_rejects_missing_agent_key(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        agents = AgentsResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*args, **kwargs):
                    return _resp({"data": {}})

                mock_request.side_effect = _r
                with pytest.raises(EngramError) as exc_info:
                    await agents.get("agent-123")
                assert exc_info.value.code == "INTERNAL_ERROR"
        finally:
            await client.close()
