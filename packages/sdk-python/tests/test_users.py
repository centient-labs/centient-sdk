"""Tests for the users resource.

Mirrors the TS resource-test pattern: assert request path/method/body/query
and response unwrapping for the users endpoints. The users endpoints use the
standard ``{ data }`` envelope; the single-object routes nest their payload one
level deeper (``{ data: { user } }`` / ``{ data: { user, key } }`` /
``{ data: { users: [...] } }``), so these tests pin that unwrapping.

The users resource is not wired onto the client, so the resources are
instantiated directly against a real client (with httpx patched).
"""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.resources.users import SyncUsersResource, UsersResource
from engram.types.users import (
    ApiKey,
    CreateUserParams,
    CreateUserResult,
    DeleteUserResult,
    User,
)


SAMPLE_USER = {
    "id": "user-1",
    "name": "alice",
    "displayName": "Alice",
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_USER_NO_DISPLAY = {
    "id": "user-2",
    "name": "bob",
    "displayName": None,
    "createdAt": "2026-01-02T00:00:00Z",
}

SAMPLE_API_KEY = {
    "id": "key-1",
    "name": "default",
    "prefix": "ek_abc",
    "value": "ek_abc_secret_value",
}


class TestSyncUsersResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.users = SyncUsersResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_unwraps_user_and_key(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"user": SAMPLE_USER, "key": SAMPLE_API_KEY}},
            request=httpx.Request("POST", "http://test:3100/v1/users"),
        )

        result = self.users.create(
            CreateUserParams(name="alice", display_name="Alice")
        )

        assert isinstance(result, CreateUserResult)
        assert isinstance(result.user, User)
        assert isinstance(result.key, ApiKey)
        assert result.user.id == "user-1"
        assert result.user.name == "alice"
        assert result.user.display_name == "Alice"
        assert result.key.value == "ek_abc_secret_value"
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/v1/users"
        # camelCase body, with no display name sent when omitted is covered below.
        assert call_args[1]["json"] == {"name": "alice", "displayName": "Alice"}

    @patch.object(httpx.Client, "request")
    def test_create_omits_display_name_when_absent(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"user": SAMPLE_USER_NO_DISPLAY, "key": SAMPLE_API_KEY}},
            request=httpx.Request("POST", "http://test:3100/v1/users"),
        )

        self.users.create(CreateUserParams(name="bob"))

        assert mock_request.call_args[1]["json"] == {"name": "bob"}

    @patch.object(httpx.Client, "request")
    def test_list_unwraps_users_array(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"users": [SAMPLE_USER, SAMPLE_USER_NO_DISPLAY]}},
            request=httpx.Request("GET", "http://test:3100/v1/users"),
        )

        users = self.users.list()

        assert isinstance(users, list)
        assert len(users) == 2
        assert all(isinstance(u, User) for u in users)
        assert users[0].name == "alice"
        assert users[1].display_name is None
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/users"
        # No pagination params -> no query params reach httpx at all.
        assert "params" not in call_args[1]

    @patch.object(httpx.Client, "request")
    def test_list_sends_limit_and_offset(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"users": []}},
            request=httpx.Request("GET", "http://test:3100/v1/users"),
        )

        users = self.users.list(limit=10, offset=5)

        assert users == []
        assert mock_request.call_args[1]["params"] == {"limit": "10", "offset": "5"}

    @patch.object(httpx.Client, "request")
    def test_get_unwraps_user(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"user": SAMPLE_USER}},
            request=httpx.Request("GET", "http://test:3100/v1/users/alice"),
        )

        user = self.users.get("alice")

        assert isinstance(user, User)
        assert user.id == "user-1"
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert call_args[0][1] == "/v1/users/alice"

    @patch.object(httpx.Client, "request")
    def test_get_url_encodes_id(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"user": SAMPLE_USER}},
            request=httpx.Request("GET", "http://test:3100/v1/users/a%2Fb"),
        )

        self.users.get("a/b")

        assert mock_request.call_args[0][1] == "/v1/users/a%2Fb"

    @patch.object(httpx.Client, "request")
    def test_delete_default_sends_no_query(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"deleted": True, "revokedKeys": 0}},
            request=httpx.Request("DELETE", "http://test:3100/v1/users/alice"),
        )

        result = self.users.delete("alice")

        assert isinstance(result, DeleteUserResult)
        assert result.deleted is True
        assert result.revoked_keys == 0
        call_args = mock_request.call_args
        assert call_args[0][0] == "DELETE"
        assert call_args[0][1] == "/v1/users/alice"
        assert "params" not in call_args[1]

    @patch.object(httpx.Client, "request")
    def test_delete_revoke_keys_sets_query(self, mock_request):
        mock_request.return_value = httpx.Response(
            200,
            json={"data": {"deleted": True, "revokedKeys": 3}},
            request=httpx.Request("DELETE", "http://test:3100/v1/users/alice?revokeKeys=true"),
        )

        result = self.users.delete("alice", revoke_keys=True)

        assert result.revoked_keys == 3
        call_args = mock_request.call_args
        assert call_args[0][1] == "/v1/users/alice"
        assert call_args[1]["params"] == {"revokeKeys": "true"}


class TestAsyncUsersResource:
    @pytest.mark.asyncio
    async def test_async_create_unwraps_user_and_key(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        users = UsersResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json={"data": {"user": SAMPLE_USER, "key": SAMPLE_API_KEY}},
                        request=httpx.Request("POST", "http://test:3100/v1/users"),
                    )

                mock_request.side_effect = _resp
                result = await users.create(CreateUserParams(name="alice"))
                assert isinstance(result, CreateUserResult)
                assert result.user.name == "alice"
                assert result.key.prefix == "ek_abc"
                call_args = mock_request.call_args
                assert call_args[0][0] == "POST"
                assert call_args[0][1] == "/v1/users"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_list_unwraps_users_array(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        users = UsersResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    return httpx.Response(
                        200,
                        json={"data": {"users": [SAMPLE_USER]}},
                        request=httpx.Request("GET", "http://test:3100/v1/users"),
                    )

                mock_request.side_effect = _resp
                result = await users.list()
                assert isinstance(result, list)
                assert result[0].name == "alice"
                assert mock_request.call_args[0][1] == "/v1/users"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_get_and_delete(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        users = UsersResource(client)
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _resp(*args, **kwargs):
                    if args[0] == "DELETE":
                        return httpx.Response(
                            200,
                            json={"data": {"deleted": True, "revokedKeys": 1}},
                            request=httpx.Request("DELETE", "http://test:3100/v1/users/alice"),
                        )
                    return httpx.Response(
                        200,
                        json={"data": {"user": SAMPLE_USER}},
                        request=httpx.Request("GET", "http://test:3100/v1/users/alice"),
                    )

                mock_request.side_effect = _resp
                user = await users.get("alice")
                assert isinstance(user, User)
                assert user.id == "user-1"

                result = await users.delete("alice", revoke_keys=True)
                assert isinstance(result, DeleteUserResult)
                assert result.revoked_keys == 1
                assert mock_request.call_args[1]["params"] == {"revokeKeys": "true"}
        finally:
            await client.close()
