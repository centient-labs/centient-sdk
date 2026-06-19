"""Tests for the memory-spaces resource.

Mirrors the TS resource-test pattern: assert request path/method/body/query and
response parsing for the standard ``{ data }`` envelope, whose inner payload is
keyed by member name (``{ data: { space } }``, ``{ data: { spaces } }``,
``{ data: { member } }``). The resource unwraps ``data`` then the named member;
these tests pin that contract.

The memory-spaces resource is not (yet) wired onto the client, so the tests
instantiate the resource classes directly with the client.
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.resources.memory_spaces import (
    MemorySpacesResource,
    SyncMemorySpacesResource,
)
from engram.types.memory_spaces import (
    CreateMemorySpaceParams,
    JoinMemorySpaceParams,
    MemorySpace,
    MemorySpaceInitialMember,
    MemorySpaceMember,
    MemorySpaceWithMembers,
)


SAMPLE_SPACE = {
    "id": "space-1",
    "title": "Shared Space",
    "description": "A collaborative space",
    "visibility": "shared",
    "nodeType": "memory_space",
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_MEMBER = {
    "agentId": "agent-1",
    "permission": "write",
    "joinedAt": "2026-01-02T00:00:00Z",
}

SAMPLE_SPACE_WITH_MEMBERS = {
    **SAMPLE_SPACE,
    "members": [SAMPLE_MEMBER],
}


def _resp(json_data, method="GET", url="http://test:3100"):
    return httpx.Response(
        200, json=json_data, request=httpx.Request(method, url)
    )


class TestSyncMemorySpacesResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.resource = SyncMemorySpacesResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_list(self, mock_request):
        mock_request.return_value = _resp({"data": {"spaces": [SAMPLE_SPACE]}})

        spaces = self.resource.list()

        assert isinstance(spaces, list)
        assert len(spaces) == 1
        assert isinstance(spaces[0], MemorySpace)
        assert spaces[0].id == "space-1"
        assert spaces[0].node_type == "memory_space"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/memory-spaces"
        # No agent filter => no query params reach httpx.
        assert "params" not in call_args[1] or call_args[1].get("params") is None

    @patch.object(httpx.Client, "request")
    def test_list_with_agent_filter(self, mock_request):
        mock_request.return_value = _resp({"data": {"spaces": []}})

        spaces = self.resource.list(agent_id="agent-1")

        assert spaces == []
        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/memory-spaces"
        assert call_args[1]["params"] == {"agentId": "agent-1"}

    @patch.object(httpx.Client, "request")
    def test_create(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"space": SAMPLE_SPACE}},
            method="POST",
            url="http://test:3100/v1/memory-spaces",
        )

        space = self.resource.create(
            CreateMemorySpaceParams(
                title="Shared Space",
                description="A collaborative space",
                visibility="shared",
                initial_members=[
                    MemorySpaceInitialMember(agent_id="agent-1", permission="admin")
                ],
            )
        )

        assert isinstance(space, MemorySpace)
        assert space.id == "space-1"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/memory-spaces"
        assert call_args[1]["json"] == {
            "title": "Shared Space",
            "description": "A collaborative space",
            "visibility": "shared",
            "initialMembers": [{"agentId": "agent-1", "permission": "admin"}],
        }

    @patch.object(httpx.Client, "request")
    def test_create_minimal_drops_none(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"space": SAMPLE_SPACE}},
            method="POST",
            url="http://test:3100/v1/memory-spaces",
        )

        self.resource.create(CreateMemorySpaceParams(title="Only Title"))

        assert mock_request.call_args[1]["json"] == {"title": "Only Title"}

    @patch.object(httpx.Client, "request")
    def test_get(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"space": SAMPLE_SPACE_WITH_MEMBERS}}
        )

        space = self.resource.get("space-1/with slash")

        assert isinstance(space, MemorySpaceWithMembers)
        assert len(space.members) == 1
        assert space.members[0].agent_id == "agent-1"
        assert space.members[0].permission == "write"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        # Path param is URL-encoded with quote(..., safe='').
        assert call_args[0][1] == "/v1/memory-spaces/space-1%2Fwith%20slash"

    @patch.object(httpx.Client, "request")
    def test_join(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"member": SAMPLE_MEMBER}},
            method="POST",
            url="http://test:3100/v1/memory-spaces/space-1/join",
        )

        member = self.resource.join(
            "space-1", JoinMemorySpaceParams(agent_id="agent-1", permission="write")
        )

        assert isinstance(member, MemorySpaceMember)
        assert member.agent_id == "agent-1"
        assert member.permission == "write"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/memory-spaces/space-1/join"
        assert call_args[1]["json"] == {"agentId": "agent-1", "permission": "write"}

    @patch.object(httpx.Client, "request")
    def test_leave(self, mock_request):
        mock_request.return_value = _resp(
            {"data": {"removed": True}},
            method="DELETE",
            url="http://test:3100/v1/memory-spaces/space-1/leave",
        )

        result = self.resource.leave("space-1", "agent-1")

        assert result == {"removed": True}
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert call_args[0][1] == "/v1/memory-spaces/space-1/leave"
        assert call_args[1]["params"] == {"agentId": "agent-1"}


class TestAsyncMemorySpacesResource:
    @pytest.mark.asyncio
    async def test_async_list(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = MemorySpacesResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _side(*args, **kwargs):
                    return _resp({"data": {"spaces": [SAMPLE_SPACE]}})

                mock_request.side_effect = _side
                spaces = await resource.list()
                assert len(spaces) == 1
                assert spaces[0].id == "space-1"
                call_args = mock_request.call_args
                assert call_args[0][0] == "GET"
                assert call_args[0][1] == "/v1/memory-spaces"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_create(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = MemorySpacesResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _side(*args, **kwargs):
                    return _resp(
                        {"data": {"space": SAMPLE_SPACE}},
                        method="POST",
                        url="http://test:3100/v1/memory-spaces",
                    )

                mock_request.side_effect = _side
                space = await resource.create(
                    CreateMemorySpaceParams(title="Shared Space")
                )
                assert isinstance(space, MemorySpace)
                assert space.id == "space-1"
                assert mock_request.call_args[1]["json"] == {"title": "Shared Space"}
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = MemorySpacesResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _side(*args, **kwargs):
                    return _resp({"data": {"space": SAMPLE_SPACE_WITH_MEMBERS}})

                mock_request.side_effect = _side
                space = await resource.get("space-1")
                assert isinstance(space, MemorySpaceWithMembers)
                assert len(space.members) == 1
                assert mock_request.call_args[0][1] == "/v1/memory-spaces/space-1"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_join(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = MemorySpacesResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _side(*args, **kwargs):
                    return _resp(
                        {"data": {"member": SAMPLE_MEMBER}},
                        method="POST",
                        url="http://test:3100/v1/memory-spaces/space-1/join",
                    )

                mock_request.side_effect = _side
                member = await resource.join(
                    "space-1",
                    JoinMemorySpaceParams(agent_id="agent-1", permission="write"),
                )
                assert isinstance(member, MemorySpaceMember)
                assert member.agent_id == "agent-1"
                assert mock_request.call_args[0][1] == (
                    "/v1/memory-spaces/space-1/join"
                )
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_leave(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        resource = MemorySpacesResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _side(*args, **kwargs):
                    return _resp(
                        {"data": {"removed": True}},
                        method="DELETE",
                        url="http://test:3100/v1/memory-spaces/space-1/leave",
                    )

                mock_request.side_effect = _side
                result = await resource.leave("space-1", "agent-1")
                assert result == {"removed": True}
                assert mock_request.call_args[1]["params"] == {"agentId": "agent-1"}
        finally:
            await client.close()
