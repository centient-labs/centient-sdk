"""Shimmers resource for the Engram SDK (engram ``/v1/shimmers``).

Ergonomic, use-case-named wrappers over the per-type shimmer write semantics. A
shimmer is node-local, TTL-backed operational state: locks (CAS), heartbeats
(overwrite), and ipc (write-once + exactly-once consume).

Mirrors the TypeScript SDK's ``ShimmersResource``
(``packages/sdk/src/resources/shimmers.ts``, ADR-027 / engram-server #931, #933).

Endpoint mapping::

    heartbeat(key, ...)     -> POST   /v1/shimmers              (recordType: heartbeat)
    acquire_lock(key, ...)  -> POST   /v1/shimmers              (recordType: lock)
    renew_lock(key, ...)    -> PUT    /v1/shimmers/:key         (recordType: lock, CAS)
    release_lock(key, ...)  -> DELETE /v1/shimmers/:key?recordType=lock&ownerToken=...
    emit_ipc(key, ...)      -> POST   /v1/shimmers              (recordType: ipc)
    consume_ipc(key)        -> DELETE /v1/shimmers/:key?recordType=ipc
    get(key, record_type)   -> GET    /v1/shimmers/:key?recordType=...

Single-object responses are unwrapped from the standard ``{ data }`` envelope.
The entire surface requires a WRITE-scoped key and answers 503
(:class:`~engram.errors.ShimmerDisabledError`) when ``ENGRAM_SHIMMER_ENABLED``
is off. Lock acquire/renew CAS failures and ipc write-once collisions surface as
:class:`~engram.errors.ShimmerCasConflictError` (409). Both are raised centrally
by ``parse_api_error`` from the server error codes.
"""
from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import quote

from engram._base import BaseResource, SyncBaseResource
from engram.types.shimmers import (
    AcquireLockParams,
    ReleaseLockParams,
    RenewLockParams,
    Shimmer,
    ShimmerDeleteResult,
    ShimmerRead,
    ShimmerRecordType,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


def _heartbeat_body(key: str, value: Any, ttl_seconds: int) -> dict[str, Any]:
    body: dict[str, Any] = {
        "recordType": "heartbeat",
        "key": key,
        "ttlSeconds": ttl_seconds,
    }
    if value is not None:
        body["value"] = value
    return body


def _acquire_body(key: str, params: AcquireLockParams) -> dict[str, Any]:
    body: dict[str, Any] = {
        "recordType": "lock",
        "key": key,
        "ownerToken": params.owner_token,
        "ttlSeconds": params.ttl_seconds,
    }
    if params.value is not None:
        body["value"] = params.value
    return body


def _renew_body(params: RenewLockParams) -> dict[str, Any]:
    body: dict[str, Any] = {
        "recordType": "lock",
        "ownerToken": params.owner_token,
        "expectedRevision": params.expected_revision,
        "ttlSeconds": params.ttl_seconds,
    }
    if params.value is not None:
        body["value"] = params.value
    return body


def _ipc_body(key: str, value: Any, ttl_seconds: int) -> dict[str, Any]:
    body: dict[str, Any] = {
        "recordType": "ipc",
        "key": key,
        "ttlSeconds": ttl_seconds,
    }
    if value is not None:
        body["value"] = value
    return body


class ShimmersResource(BaseResource):
    """Async resource for node-local TTL-backed operational state.

    Attached as ``client.shimmers``. Locks, heartbeats, and ipc.

    Example::

        # Emit a heartbeat (never conflicts)
        await client.shimmers.heartbeat("worker-1", {"phase": "build"}, ttl_seconds=30)

        # Acquire a lock (raises ShimmerCasConflictError if held)
        lock = await client.shimmers.acquire_lock(
            "deploy", AcquireLockParams(owner_token="me", ttl_seconds=60)
        )
    """

    async def heartbeat(
        self, key: str, value: Any, ttl_seconds: int
    ) -> Shimmer:
        """Emit/refresh a heartbeat: unconditional overwrite + TTL window.

        Last-writer-wins — a heartbeat NEVER conflicts.
        """
        response = await self._request(
            "POST", "/v1/shimmers", _heartbeat_body(key, value, ttl_seconds)
        )
        return Shimmer.model_validate(response["data"])

    async def acquire_lock(self, key: str, params: AcquireLockParams) -> Shimmer:
        """Acquire a lock if it is free (CAS acquire-if-absent).

        The returned record echoes back the ``owner_token`` you supplied — keep
        it; it is the capability required to renew or release.

        Raises:
            ShimmerCasConflictError: 409 — the lock is already held by another
                live owner (the holder's token is NOT exposed).
        """
        response = await self._request(
            "POST", "/v1/shimmers", _acquire_body(key, params)
        )
        return Shimmer.model_validate(response["data"])

    async def renew_lock(self, key: str, params: RenewLockParams) -> Shimmer:
        """Renew a held lock (CAS).

        The supplied ``expected_revision`` and ``owner_token`` must match the
        live holder. On success the lease is extended and the revision advances.

        Raises:
            ShimmerCasConflictError: 409 — the revision/owner did not match the
                live holder.
        """
        response = await self._request(
            "PUT",
            f"/v1/shimmers/{quote(key, safe='')}",
            _renew_body(params),
        )
        return Shimmer.model_validate(response["data"])

    async def release_lock(
        self, key: str, params: ReleaseLockParams
    ) -> ShimmerDeleteResult:
        """Release a lock (owner-guarded).

        ``released`` is true iff a live lock held by the supplied owner was
        deleted; a non-holder gets ``released=False`` (not an error).
        ``consumed`` is always ``None`` for a lock release.
        """
        response = await self._request(
            "DELETE",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": "lock", "ownerToken": params.owner_token},
        )
        return ShimmerDeleteResult.model_validate(response["data"])

    async def emit_ipc(self, key: str, value: Any, ttl_seconds: int) -> Shimmer:
        """Post an ipc message (write-once).

        The key holds at most one live message until it is consumed or fades.

        Raises:
            ShimmerCasConflictError: 409 — a live message already occupies the
                key.
        """
        response = await self._request(
            "POST", "/v1/shimmers", _ipc_body(key, value, ttl_seconds)
        )
        return Shimmer.model_validate(response["data"])

    async def consume_ipc(self, key: str) -> Optional[ShimmerRead]:
        """Consume an ipc message (atomic exactly-once ``DELETE ... RETURNING``).

        Exactly one concurrent caller receives the record; every other receives
        ``None``. Returns the consumed record (with its ``owner_token`` redacted
        to ``None``), or ``None`` when no live message existed.
        """
        response = await self._request(
            "DELETE",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": "ipc"},
        )
        result = ShimmerDeleteResult.model_validate(response["data"])
        return result.consumed

    async def get(self, key: str, record_type: ShimmerRecordType) -> ShimmerRead:
        """Read a live shimmer (TTL-filtered).

        Returns the record for (``record_type``, ``key``) when LIVE
        (fades_at > now). A faded-but-unreaped row reads as absent. The result
        NEVER carries an ``owner_token`` (always ``None`` on a read).

        Raises:
            NotFoundError: 404 — no live shimmer for (record_type, key).
        """
        response = await self._request(
            "GET",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": record_type},
        )
        return ShimmerRead.model_validate(response["data"])


class SyncShimmersResource(SyncBaseResource):
    """Sync resource for node-local TTL-backed operational state."""

    def heartbeat(self, key: str, value: Any, ttl_seconds: int) -> Shimmer:
        """Emit/refresh a heartbeat: unconditional overwrite + TTL window."""
        response = self._request(
            "POST", "/v1/shimmers", _heartbeat_body(key, value, ttl_seconds)
        )
        return Shimmer.model_validate(response["data"])

    def acquire_lock(self, key: str, params: AcquireLockParams) -> Shimmer:
        """Acquire a lock if it is free (CAS acquire-if-absent).

        Raises:
            ShimmerCasConflictError: 409 — the lock is already held.
        """
        response = self._request("POST", "/v1/shimmers", _acquire_body(key, params))
        return Shimmer.model_validate(response["data"])

    def renew_lock(self, key: str, params: RenewLockParams) -> Shimmer:
        """Renew a held lock (CAS).

        Raises:
            ShimmerCasConflictError: 409 — the revision/owner did not match.
        """
        response = self._request(
            "PUT",
            f"/v1/shimmers/{quote(key, safe='')}",
            _renew_body(params),
        )
        return Shimmer.model_validate(response["data"])

    def release_lock(
        self, key: str, params: ReleaseLockParams
    ) -> ShimmerDeleteResult:
        """Release a lock (owner-guarded)."""
        response = self._request(
            "DELETE",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": "lock", "ownerToken": params.owner_token},
        )
        return ShimmerDeleteResult.model_validate(response["data"])

    def emit_ipc(self, key: str, value: Any, ttl_seconds: int) -> Shimmer:
        """Post an ipc message (write-once).

        Raises:
            ShimmerCasConflictError: 409 — a live message already occupies the
                key.
        """
        response = self._request(
            "POST", "/v1/shimmers", _ipc_body(key, value, ttl_seconds)
        )
        return Shimmer.model_validate(response["data"])

    def consume_ipc(self, key: str) -> Optional[ShimmerRead]:
        """Consume an ipc message (atomic exactly-once)."""
        response = self._request(
            "DELETE",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": "ipc"},
        )
        result = ShimmerDeleteResult.model_validate(response["data"])
        return result.consumed

    def get(self, key: str, record_type: ShimmerRecordType) -> ShimmerRead:
        """Read a live shimmer (TTL-filtered).

        Raises:
            NotFoundError: 404 — no live shimmer for (record_type, key).
        """
        response = self._request(
            "GET",
            f"/v1/shimmers/{quote(key, safe='')}",
            params={"recordType": record_type},
        )
        return ShimmerRead.model_validate(response["data"])
