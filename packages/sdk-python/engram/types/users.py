"""User management types for the Engram SDK.

Mirrors the TypeScript SDK's user types
(``packages/sdk/src/resources/users.ts``).

The user endpoints use the standard ``{ data }`` envelope. The single-object
routes nest their payload one level deeper (e.g. ``{ data: { user } }`` /
``{ data: { user, key } }``); the resource unwraps that member before
validation, so these models describe the inner payload shapes only.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "User",
    "ApiKey",
    "CreateUserParams",
    "CreateUserResult",
    "DeleteUserResult",
]


class User(BaseModel):
    """A user account."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    name: str
    display_name: Optional[str] = None
    created_at: str


class ApiKey(BaseModel):
    """An API key provisioned for a user.

    The plaintext ``value`` is returned only at creation time.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    id: str
    name: str
    prefix: str
    value: str


class CreateUserParams(BaseModel):
    """Parameters for creating a user."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    name: str
    display_name: Optional[str] = None


class CreateUserResult(BaseModel):
    """Result of creating a user: the user plus its initial API key."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    user: User
    key: ApiKey


class DeleteUserResult(BaseModel):
    """Result of deleting a user."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    deleted: bool
    revoked_keys: int
