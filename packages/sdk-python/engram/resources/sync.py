"""Sync resource for the Engram SDK — multi-node replication.

Resource-based interface for push/pull replication, conflict resolution, and
peer management. Mirrors the TypeScript SDK's ``SyncResource``
(``packages/sdk/src/resources/sync.ts``).

Envelope rules (matching the server contract):

- Most ``/v1/sync`` routes use the standard ``{ success, data }`` envelope.
- The peer routes (``/v1/sync/peers/*``) use BARE shapes: ``{ peer }``,
  ``{ peers }``, ``{ removed, name }`` — they are NOT enveloped.
- ``push`` sends NDJSON (``application/x-ndjson``) and ``pull`` parses an NDJSON
  response stream (one serialized changelog entry per line).

Contract drift surfaces as :class:`~engram.errors.EngramError`
(code ``INTERNAL_ERROR``); a malformed NDJSON line surfaces as
:class:`~engram.errors.NetworkError`, mirroring the TS SDK.
"""
from __future__ import annotations

import json
from typing import Any, List, Optional, TYPE_CHECKING
from urllib.parse import quote

from pydantic import ValidationError as PydanticValidationError

from engram._base import BaseResource, SyncBaseResource
from engram.errors import EngramError, NetworkError
from engram.types.sync import (
    CreatePeerParams,
    ListConflictsParams,
    ResolveConflictParams,
    SyncChange,
    SyncConflict,
    SyncPeer,
    SyncPullParams,
    SyncPullResult,
    SyncPushResult,
    SyncStatus,
)

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient


_BODY_EXCERPT_MAX = 200

# The four entity types the server always reports counts for.
_SYNC_ENTITY_TYPES = (
    "knowledge_crystals",
    "knowledge_crystal_edges",
    "sessions",
    "session_notes",
)


def _truncate_body(body: Any) -> str:
    """Render a short, repr-safe excerpt of an unexpected response body."""
    text = repr(body)
    if len(text) > _BODY_EXCERPT_MAX:
        return text[:_BODY_EXCERPT_MAX] + "...(truncated)"
    return text


def _unwrap_data(body: Any, route: str) -> Any:
    """Unwrap the standard ``{ data }`` envelope, failing loudly on drift."""
    if not isinstance(body, dict) or "data" not in body:
        raise EngramError(
            f"Unexpected {route} response shape (expected {{ data }}); "
            f"got: {_truncate_body(body)}",
            code="INTERNAL_ERROR",
        )
    return body["data"]


def _require_peer(body: Any, route: str) -> dict:
    """Narrow a bare ``{ peer }`` peers response."""
    if not isinstance(body, dict) or not isinstance(body.get("peer"), dict):
        raise EngramError(
            f"Unexpected {route} response shape (expected {{ peer }}); "
            f"got: {_truncate_body(body)}",
            code="INTERNAL_ERROR",
        )
    return body["peer"]


def _require_peers(body: Any, route: str) -> list:
    """Narrow a bare ``{ peers: [...] }`` peers-list response."""
    if not isinstance(body, dict) or not isinstance(body.get("peers"), list):
        raise EngramError(
            f"Unexpected {route} response shape (expected {{ peers }}); "
            f"got: {_truncate_body(body)}",
            code="INTERNAL_ERROR",
        )
    return body["peers"]


def _parse_pull_ndjson(text: str, route: str) -> List[SyncChange]:
    """Parse an NDJSON pull response into a list of SyncChange.

    Mirrors the TS validation: a malformed/truncated line, a missing required
    field, or an unknown ``entityType`` raises :class:`NetworkError` with the
    offending line index — a contract drift fails here, not as an AttributeError
    at the call site.
    """
    changes: List[SyncChange] = []
    lines = [line for line in text.split("\n") if line.strip()]
    for i, line in enumerate(lines):
        try:
            raw = json.loads(line)
        except (ValueError, TypeError):
            raise NetworkError(
                f"Failed to parse NDJSON line {i} from {route}: {line[:200]}"
            )
        if not isinstance(raw, dict) or not all(
            raw.get(k)
            for k in ("seq", "entityType", "entityId", "operation", "createdAt")
        ):
            raise NetworkError(
                f"Malformed SyncChange at NDJSON line {i} from {route}: "
                "missing required field(s)"
            )
        if raw.get("entityType") not in _SYNC_ENTITY_TYPES:
            raise NetworkError(
                f'Unexpected entityType "{raw.get("entityType")}" at NDJSON '
                f"line {i} from {route}"
            )
        # A field with the wrong type (e.g. seq as a number, changedFields as a
        # list) surfaces as a structured NetworkError carrying the line index —
        # consistent with the other parse-boundary failures above — rather than
        # leaking a raw pydantic ValidationError to the caller.
        try:
            changes.append(SyncChange.model_validate(raw))
        except PydanticValidationError as exc:
            raise NetworkError(
                f"Malformed SyncChange at NDJSON line {i} from {route}: {exc}"
            )
    return changes


def _build_push_ndjson(changes: List[SyncChange]) -> bytes:
    """Serialize changes to NDJSON bytes (one entry per line, trailing newline).

    Empty payload → empty body, matching the TS SDK and the server contract.
    """
    if not changes:
        return b""
    body = (
        "\n".join(
            json.dumps(c.model_dump(by_alias=True, exclude_none=False)) for c in changes
        )
        + "\n"
    )
    return body.encode("utf-8")


# ============================================================================
# Async resources
# ============================================================================


class SyncPeersResource(BaseResource):
    """Async sub-resource for managing sync peers.

    The peers routes (``/v1/sync/peers/*``) use BARE response shapes
    (``{ peer }``, ``{ peers }``, ``{ removed, name }``) — they are NOT wrapped
    in the standard ``{ success, data }`` envelope.
    """

    async def create(self, params: CreatePeerParams) -> SyncPeer:
        """Register a new sync peer."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = await self._request("POST", "/v1/sync/peers", body)
        return SyncPeer.model_validate(_require_peer(response, "POST /v1/sync/peers"))

    async def list(self) -> List[SyncPeer]:
        """List all registered sync peers."""
        response = await self._request("GET", "/v1/sync/peers")
        peers = _require_peers(response, "GET /v1/sync/peers")
        return [SyncPeer.model_validate(p) for p in peers]

    async def get(self, name: str) -> SyncPeer:
        """Get a sync peer by name."""
        response = await self._request(
            "GET", f"/v1/sync/peers/{quote(name, safe='')}"
        )
        return SyncPeer.model_validate(
            _require_peer(response, "GET /v1/sync/peers/{name}")
        )

    async def delete(self, name: str) -> dict:
        """Delete a sync peer by name. Returns ``{ removed, name }``."""
        return await self._request(
            "DELETE", f"/v1/sync/peers/{quote(name, safe='')}"
        )

    async def link(self, name: str) -> None:
        """Enable automatic sync link for a peer."""
        await self._request("POST", f"/v1/sync/peers/{quote(name, safe='')}/link")

    async def unlink(self, name: str) -> None:
        """Disable automatic sync link for a peer."""
        await self._request("DELETE", f"/v1/sync/peers/{quote(name, safe='')}/link")

    async def pause(self, name: str) -> None:
        """Pause an active sync link for a peer."""
        await self._request(
            "POST", f"/v1/sync/peers/{quote(name, safe='')}/link/pause"
        )

    async def resume(self, name: str) -> None:
        """Resume a paused sync link for a peer."""
        await self._request(
            "POST", f"/v1/sync/peers/{quote(name, safe='')}/link/resume"
        )


class SyncResource(BaseResource):
    """Async resource for multi-node data synchronization.

    Provides push/pull replication, conflict detection and resolution, and
    peer-to-peer sync orchestration. ``push``/``pull`` exchange the raw NDJSON
    changelog wire format directly with a peer and are intended for tooling and
    tests — routine background replication is driven by the server-side link
    daemon.
    """

    def __init__(self, client: AsyncEngramClient) -> None:
        super().__init__(client)
        self._peers = SyncPeersResource(client)

    @property
    def peers(self) -> SyncPeersResource:
        """Access the peers sub-resource for managing sync peers."""
        return self._peers

    async def push(self, changes: Optional[List[SyncChange]] = None) -> SyncPushResult:
        """Push local changes to the server as NDJSON."""
        response = await self._client._request_raw(
            "POST",
            "/v1/sync/push",
            content=_build_push_ndjson(changes or []),
            content_type="application/x-ndjson",
        )
        data = _unwrap_data(response.json(), "POST /v1/sync/push")
        return SyncPushResult.model_validate(data)

    async def pull(self, params: SyncPullParams) -> List[SyncChange]:
        """Pull remote changes from the server (NDJSON response).

        ``params.since_seq`` is required — pass ``None`` to pull from the
        beginning of the changelog.
        """
        body = json.dumps(
            params.model_dump(by_alias=True, exclude_none=True)
            | {"sinceSeq": params.since_seq}
        ).encode("utf-8")
        response = await self._client._request_raw(
            "POST", "/v1/sync/pull", content=body, content_type="application/json"
        )
        return _parse_pull_ndjson(response.text, "POST /v1/sync/pull")

    async def get_status(self) -> SyncStatus:
        """Get the current sync status."""
        response = await self._request("GET", "/v1/sync/status")
        return SyncStatus.model_validate(_unwrap_data(response, "GET /v1/sync/status"))

    async def push_to(self, peer: str) -> SyncPushResult:
        """Push local changes to a specific peer."""
        response = await self._request(
            "POST", "/v1/sync/push-to", params={"peer": peer}
        )
        return SyncPushResult.model_validate(
            _unwrap_data(response, "POST /v1/sync/push-to")
        )

    async def pull_from(self, peer: str) -> SyncPullResult:
        """Trigger a daemon-side pull from a specific peer."""
        response = await self._request(
            "POST", "/v1/sync/pull-from", params={"peer": peer}
        )
        return SyncPullResult.model_validate(
            _unwrap_data(response, "POST /v1/sync/pull-from")
        )

    async def list_conflicts(
        self, params: Optional[ListConflictsParams] = None
    ) -> dict:
        """List sync conflicts. Returns ``{ "conflicts": [...], "total": int }``."""
        qs: Optional[dict] = None
        if params is not None and params.unresolved is not None:
            qs = {"unresolved": str(params.unresolved).lower()}
        response = await self._request("GET", "/v1/sync/conflicts", params=qs)
        data = _unwrap_data(response, "GET /v1/sync/conflicts")
        if not isinstance(data, dict) or not isinstance(data.get("conflicts"), list):
            raise EngramError(
                "Unexpected GET /v1/sync/conflicts response shape "
                f"(expected {{ conflicts, total }}); got: {_truncate_body(data)}",
                code="INTERNAL_ERROR",
            )
        return {
            "conflicts": [SyncConflict.model_validate(c) for c in data["conflicts"]],
            "total": data.get("total", len(data["conflicts"])),
        }

    async def resolve_conflict(
        self, conflict_id: str, params: Optional[ResolveConflictParams] = None
    ) -> SyncConflict:
        """Resolve a sync conflict by ID."""
        body = (
            params.model_dump(by_alias=True, exclude_none=True) if params else None
        )
        response = await self._request(
            "POST",
            f"/v1/sync/conflicts/{quote(conflict_id, safe='')}/resolve",
            body,
        )
        return SyncConflict.model_validate(
            _unwrap_data(response, "POST /v1/sync/conflicts/{id}/resolve")
        )


# ============================================================================
# Sync (synchronous-client) resources
# ============================================================================


class SyncSyncPeersResource(SyncBaseResource):
    """Synchronous-client sub-resource for managing sync peers."""

    def create(self, params: CreatePeerParams) -> SyncPeer:
        """Register a new sync peer."""
        body = params.model_dump(by_alias=True, exclude_none=True)
        response = self._request("POST", "/v1/sync/peers", body)
        return SyncPeer.model_validate(_require_peer(response, "POST /v1/sync/peers"))

    def list(self) -> List[SyncPeer]:
        """List all registered sync peers."""
        response = self._request("GET", "/v1/sync/peers")
        peers = _require_peers(response, "GET /v1/sync/peers")
        return [SyncPeer.model_validate(p) for p in peers]

    def get(self, name: str) -> SyncPeer:
        """Get a sync peer by name."""
        response = self._request("GET", f"/v1/sync/peers/{quote(name, safe='')}")
        return SyncPeer.model_validate(
            _require_peer(response, "GET /v1/sync/peers/{name}")
        )

    def delete(self, name: str) -> dict:
        """Delete a sync peer by name. Returns ``{ removed, name }``."""
        return self._request("DELETE", f"/v1/sync/peers/{quote(name, safe='')}")

    def link(self, name: str) -> None:
        """Enable automatic sync link for a peer."""
        self._request("POST", f"/v1/sync/peers/{quote(name, safe='')}/link")

    def unlink(self, name: str) -> None:
        """Disable automatic sync link for a peer."""
        self._request("DELETE", f"/v1/sync/peers/{quote(name, safe='')}/link")

    def pause(self, name: str) -> None:
        """Pause an active sync link for a peer."""
        self._request("POST", f"/v1/sync/peers/{quote(name, safe='')}/link/pause")

    def resume(self, name: str) -> None:
        """Resume a paused sync link for a peer."""
        self._request("POST", f"/v1/sync/peers/{quote(name, safe='')}/link/resume")


class SyncSyncResource(SyncBaseResource):
    """Synchronous-client resource for multi-node data synchronization."""

    def __init__(self, client: EngramClient) -> None:
        super().__init__(client)
        self._peers = SyncSyncPeersResource(client)

    @property
    def peers(self) -> SyncSyncPeersResource:
        """Access the peers sub-resource for managing sync peers."""
        return self._peers

    def push(self, changes: Optional[List[SyncChange]] = None) -> SyncPushResult:
        """Push local changes to the server as NDJSON."""
        response = self._client._request_raw(
            "POST",
            "/v1/sync/push",
            content=_build_push_ndjson(changes or []),
            content_type="application/x-ndjson",
        )
        data = _unwrap_data(response.json(), "POST /v1/sync/push")
        return SyncPushResult.model_validate(data)

    def pull(self, params: SyncPullParams) -> List[SyncChange]:
        """Pull remote changes from the server (NDJSON response)."""
        body = json.dumps(
            params.model_dump(by_alias=True, exclude_none=True)
            | {"sinceSeq": params.since_seq}
        ).encode("utf-8")
        response = self._client._request_raw(
            "POST", "/v1/sync/pull", content=body, content_type="application/json"
        )
        return _parse_pull_ndjson(response.text, "POST /v1/sync/pull")

    def get_status(self) -> SyncStatus:
        """Get the current sync status."""
        response = self._request("GET", "/v1/sync/status")
        return SyncStatus.model_validate(_unwrap_data(response, "GET /v1/sync/status"))

    def push_to(self, peer: str) -> SyncPushResult:
        """Push local changes to a specific peer."""
        response = self._request("POST", "/v1/sync/push-to", params={"peer": peer})
        return SyncPushResult.model_validate(
            _unwrap_data(response, "POST /v1/sync/push-to")
        )

    def pull_from(self, peer: str) -> SyncPullResult:
        """Trigger a daemon-side pull from a specific peer."""
        response = self._request("POST", "/v1/sync/pull-from", params={"peer": peer})
        return SyncPullResult.model_validate(
            _unwrap_data(response, "POST /v1/sync/pull-from")
        )

    def list_conflicts(self, params: Optional[ListConflictsParams] = None) -> dict:
        """List sync conflicts. Returns ``{ "conflicts": [...], "total": int }``."""
        qs: Optional[dict] = None
        if params is not None and params.unresolved is not None:
            qs = {"unresolved": str(params.unresolved).lower()}
        response = self._request("GET", "/v1/sync/conflicts", params=qs)
        data = _unwrap_data(response, "GET /v1/sync/conflicts")
        if not isinstance(data, dict) or not isinstance(data.get("conflicts"), list):
            raise EngramError(
                "Unexpected GET /v1/sync/conflicts response shape "
                f"(expected {{ conflicts, total }}); got: {_truncate_body(data)}",
                code="INTERNAL_ERROR",
            )
        return {
            "conflicts": [SyncConflict.model_validate(c) for c in data["conflicts"]],
            "total": data.get("total", len(data["conflicts"])),
        }

    def resolve_conflict(
        self, conflict_id: str, params: Optional[ResolveConflictParams] = None
    ) -> SyncConflict:
        """Resolve a sync conflict by ID."""
        body = (
            params.model_dump(by_alias=True, exclude_none=True) if params else None
        )
        response = self._request(
            "POST",
            f"/v1/sync/conflicts/{quote(conflict_id, safe='')}/resolve",
            body,
        )
        return SyncConflict.model_validate(
            _unwrap_data(response, "POST /v1/sync/conflicts/{id}/resolve")
        )
