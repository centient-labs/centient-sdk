"""User resources for the Engram SDK.

Resource-based interface for user management: user creation (with an initial
API key), listing, lookup, and deletion (optionally revoking API keys).

Mirrors the TypeScript SDK's ``UsersResource``
(``packages/sdk/src/resources/users.ts``).

The user endpoints use the standard ``{ data }`` envelope. The single-object
routes nest their payload one level deeper:

* ``POST /v1/users`` -> ``{ data: { user, key } }``
* ``GET /v1/users`` -> ``{ data: { users: [...] } }``
* ``GET /v1/users/:idOrName`` -> ``{ data: { user } }``
* ``DELETE /v1/users/:idOrName`` -> ``{ data: { deleted, revokedKeys } }``
"""
from __future__ import annotations

from typing import List, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.users import (
    CreateUserParams,
    CreateUserResult,
    DeleteUserResult,
    User,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


class UsersResource(BaseResource):
    """Async resource for user accounts and API key provisioning.

    Example::

        # Create a new user (returns user + initial API key)
        result = await client.users.create(CreateUserParams(name="alice"))

        # List all users
        users = await client.users.list()

        # Get a user by ID or name
        user = await client.users.get("alice")

        # Delete a user and revoke their keys
        result = await client.users.delete("alice", revoke_keys=True)
    """

    async def create(self, params: CreateUserParams) -> CreateUserResult:
        """Create a new user. Returns the user and an initial API key.

        Args:
            params: The user creation parameters (``name`` and optional
                ``display_name``).

        Returns:
            The created user and its initial API key.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/users", body)
        return CreateUserResult.model_validate(response["data"])

    async def list(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[User]:
        """List all users.

        Args:
            limit: Maximum number of results to return.
            offset: Number of results to skip.

        Returns:
            A list of users.
        """
        qs: dict[str, str] = {}
        if limit is not None:
            qs["limit"] = str(limit)
        if offset is not None:
            qs["offset"] = str(offset)
        response = await self._request(
            "GET", "/v1/users", params=qs if qs else None
        )
        return [User.model_validate(u) for u in response["data"]["users"]]

    async def get(self, id_or_name: str) -> User:
        """Get a user by ID or name.

        Args:
            id_or_name: The user ID or name.

        Returns:
            The user.
        """
        response = await self._request(
            "GET", f"/v1/users/{quote(id_or_name, safe='')}"
        )
        return User.model_validate(response["data"]["user"])

    async def delete(
        self, id_or_name: str, revoke_keys: bool = False
    ) -> DeleteUserResult:
        """Delete a user by ID or name, optionally revoking all their API keys.

        Args:
            id_or_name: The user ID or name.
            revoke_keys: When ``True``, revoke all of the user's API keys.

        Returns:
            Deletion result, including the count of revoked keys.
        """
        params = {"revokeKeys": "true"} if revoke_keys else None
        response = await self._request(
            "DELETE", f"/v1/users/{quote(id_or_name, safe='')}", params=params
        )
        return DeleteUserResult.model_validate(response["data"])


class SyncUsersResource(SyncBaseResource):
    """Sync resource for user accounts and API key provisioning."""

    def create(self, params: CreateUserParams) -> CreateUserResult:
        """Create a new user. Returns the user and an initial API key.

        Args:
            params: The user creation parameters (``name`` and optional
                ``display_name``).

        Returns:
            The created user and its initial API key.
        """
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/users", body)
        return CreateUserResult.model_validate(response["data"])

    def list(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[User]:
        """List all users.

        Args:
            limit: Maximum number of results to return.
            offset: Number of results to skip.

        Returns:
            A list of users.
        """
        qs: dict[str, str] = {}
        if limit is not None:
            qs["limit"] = str(limit)
        if offset is not None:
            qs["offset"] = str(offset)
        response = self._request("GET", "/v1/users", params=qs if qs else None)
        return [User.model_validate(u) for u in response["data"]["users"]]

    def get(self, id_or_name: str) -> User:
        """Get a user by ID or name.

        Args:
            id_or_name: The user ID or name.

        Returns:
            The user.
        """
        response = self._request(
            "GET", f"/v1/users/{quote(id_or_name, safe='')}"
        )
        return User.model_validate(response["data"]["user"])

    def delete(
        self, id_or_name: str, revoke_keys: bool = False
    ) -> DeleteUserResult:
        """Delete a user by ID or name, optionally revoking all their API keys.

        Args:
            id_or_name: The user ID or name.
            revoke_keys: When ``True``, revoke all of the user's API keys.

        Returns:
            Deletion result, including the count of revoked keys.
        """
        params = {"revokeKeys": "true"} if revoke_keys else None
        response = self._request(
            "DELETE", f"/v1/users/{quote(id_or_name, safe='')}", params=params
        )
        return DeleteUserResult.model_validate(response["data"])
