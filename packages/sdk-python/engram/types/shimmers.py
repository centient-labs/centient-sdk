"""Shimmer types for the Engram SDK.

Mirrors the TypeScript SDK's shimmer types
(``packages/sdk/src/types/shimmer.ts``, ADR-027 / engram-server #931, #933).

A *shimmer* is node-local, TTL-backed operational state — what engram is *doing
right now* (in contrast to a crystal, what it *remembers*). Three record types,
each with its own write semantic:

- **lock** — CAS acquire / hold / renew + TTL lease; the ``owner_token`` is the
  holder's release/renew capability.
- **heartbeat** — last-writer-wins overwrite + TTL liveness window; NEVER CAS.
- **ipc** — write-once + atomic exactly-once delete-on-consume + TTL backstop.

**Security (engram-server #933 P1):** a lock's ``owner_token`` is REDACTED to
``None`` on every response a non-owner can observe — reads (:meth:`get`) and 409
CAS-conflict bodies. The token is echoed back ONLY on a successful
acquire/renew, and only the value the caller itself supplied.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

__all__ = [
    "ShimmerRecordType",
    "Shimmer",
    "ShimmerRead",
    "ShimmerDeleteResult",
    "AcquireLockParams",
    "RenewLockParams",
    "ReleaseLockParams",
]


ShimmerRecordType = Literal["lock", "heartbeat", "ipc"]
"""The three shimmer record types.

- ``lock``: CAS acquire/hold/renew/release + TTL lease.
- ``heartbeat``: overwrite / last-writer-wins + TTL liveness window (never CAS).
- ``ipc``: write-once + atomic exactly-once delete-on-consume + TTL backstop.
"""


class Shimmer(BaseModel):
    """A shimmer record as returned by an acquire/renew success.

    The only response that may carry an ``owner_token`` (the caller's own,
    echoed back). For lock acquire/renew the token is non-null; for
    heartbeat/ipc it is always null.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    record_type: ShimmerRecordType
    record_key: str
    value: Any = None
    owner_token: Optional[str] = None
    revision: int
    created_at: str
    updated_at: str
    fades_at: str


class ShimmerRead(BaseModel):
    """A shimmer as returned by a TTL-filtered read (:meth:`get`).

    Identical to :class:`Shimmer` except the ``owner_token`` is ALWAYS ``None``
    — a reader never learns another client's lock token (engram-server #933 P1).
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    record_type: ShimmerRecordType
    record_key: str
    value: Any = None
    owner_token: None = None
    revision: int
    created_at: str
    updated_at: str
    fades_at: str


class ShimmerDeleteResult(BaseModel):
    """Result of a DELETE — lock release or ipc consume.

    - lock release: ``released`` is true iff an owner-matched live lock was
      deleted; ``consumed`` is always ``None``.
    - ipc consume: ``consumed`` is the exactly-once consumed record (with its
      ``owner_token`` redacted to ``None``), or ``None`` when no live message
      existed; ``released`` mirrors ``consumed is not None``.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    released: bool
    consumed: Optional[ShimmerRead] = None


class AcquireLockParams(BaseModel):
    """Options for acquiring a lock."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    owner_token: str
    ttl_seconds: int
    value: Any = None


class RenewLockParams(BaseModel):
    """Options for renewing a held lock (CAS)."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    owner_token: str
    expected_revision: int
    ttl_seconds: int
    value: Any = None


class ReleaseLockParams(BaseModel):
    """Options for releasing a lock (owner-guarded).

    Must match the live holder; a non-holder gets ``released=False``, not an
    error.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    owner_token: str
