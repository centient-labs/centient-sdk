"""Tests for the sync (multi-node replication) resource.

Mirrors the TS resource-test pattern: assert request path/method/body and
response parsing for the standard ``{ data }`` envelope, the BARE peer shapes,
and the NDJSON push/pull wire format.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import EngramError, NetworkError
from engram.resources.sync import (
    SyncResource,
    SyncSyncResource,
)
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


def _counts(n: int = 0) -> dict:
    entry = {"inserted": n, "updated": 0, "skipped": 0}
    return {
        "knowledge_crystals": entry,
        "knowledge_crystal_edges": entry,
        "sessions": entry,
        "session_notes": entry,
    }


PUSH_RESULT = {"counts": _counts(2), "conflicts": 0, "duration": 12.5}

PEER = {
    "id": "peer-1",
    "name": "node-b",
    "url": "https://b.example",
    "lastPushAt": None,
    "lastPullAt": None,
    "lastPushSeq": None,
    "lastPullSeq": None,
    "linkEnabled": False,
    "linkIntervalSeconds": 300,
    "linkLastSyncAt": None,
    "linkLastError": None,
    "linkPaused": False,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

CONFLICT = {
    "id": "conf-1",
    "entityType": "knowledge_crystals",
    "entityId": "kc-1",
    "fieldName": "title",
    "localValue": "a",
    "remoteValue": "b",
    "localUpdatedAt": None,
    "remoteUpdatedAt": None,
    "winner": "local",
    "resolution": "auto_lww",
    "resolvedAt": None,
    "createdAt": "2026-01-01T00:00:00Z",
}

STATUS = {
    "instanceId": "inst-1",
    "schemaVersion": "1",
    "peersCount": 2,
    "activeLinksCount": 1,
    "changelogSize": 42,
}

CHANGE = {
    "seq": "10",
    "entityType": "knowledge_crystals",
    "entityId": "kc-1",
    "operation": "insert",
    "changedFields": {"title": "x"},
    "previousValues": None,
    "createdAt": "2026-01-01T00:00:00Z",
}


def _resp(status_code=200, json_data=None, text=None, method="POST", url="http://test:3100/x"):
    if text is not None:
        return httpx.Response(status_code, text=text, request=httpx.Request(method, url))
    return httpx.Response(status_code, json=json_data, request=httpx.Request(method, url))


class TestSyncSyncResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.sync = SyncSyncResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_push_serializes_ndjson(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": PUSH_RESULT})
        change = SyncChange.model_validate(CHANGE)

        result = self.sync.push([change])

        assert isinstance(result, SyncPushResult)
        assert result.counts.knowledge_crystals.inserted == 2
        assert result.conflicts == 0
        call = mock_request.call_args
        assert call[0][0] == "POST"
        assert call[0][1] == "/v1/sync/push"
        assert call[1]["headers"]["Content-Type"] == "application/x-ndjson"
        body = call[1]["content"].decode("utf-8")
        assert body.endswith("\n")
        line = json.loads(body.strip())
        # Serialized back to camelCase wire keys.
        assert line["entityType"] == "knowledge_crystals"
        assert line["entityId"] == "kc-1"

    @patch.object(httpx.Client, "request")
    def test_push_empty_sends_empty_body(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": PUSH_RESULT})
        self.sync.push([])
        assert mock_request.call_args[1]["content"] == b""

    @patch.object(httpx.Client, "request")
    def test_push_rejects_unenveloped_body(self, mock_request):
        mock_request.return_value = _resp(json_data=PUSH_RESULT)  # missing { data }
        with pytest.raises(EngramError) as exc:
            self.sync.push([])
        assert exc.value.code == "INTERNAL_ERROR"

    @patch.object(httpx.Client, "request")
    def test_pull_parses_ndjson(self, mock_request):
        ndjson = json.dumps(CHANGE) + "\n" + json.dumps({**CHANGE, "seq": "11"}) + "\n"
        mock_request.return_value = _resp(text=ndjson)

        changes = self.sync.pull(SyncPullParams(since_seq=None))

        assert len(changes) == 2
        assert changes[0].seq == "10"
        assert changes[1].seq == "11"
        call = mock_request.call_args
        assert call[0][1] == "/v1/sync/pull"
        sent = json.loads(call[1]["content"].decode("utf-8"))
        assert sent["sinceSeq"] is None

    @patch.object(httpx.Client, "request")
    def test_pull_malformed_line_raises_network_error(self, mock_request):
        mock_request.return_value = _resp(text="{not json}\n")
        with pytest.raises(NetworkError):
            self.sync.pull(SyncPullParams(since_seq="5"))

    @patch.object(httpx.Client, "request")
    def test_pull_unknown_entity_type_raises(self, mock_request):
        bad = json.dumps({**CHANGE, "entityType": "bogus"}) + "\n"
        mock_request.return_value = _resp(text=bad)
        with pytest.raises(NetworkError):
            self.sync.pull(SyncPullParams(since_seq="5"))

    @patch.object(httpx.Client, "request")
    def test_get_status(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": STATUS}, method="GET")
        status = self.sync.get_status()
        assert isinstance(status, SyncStatus)
        assert status.instance_id == "inst-1"
        assert status.peers_count == 2
        assert mock_request.call_args[0][1] == "/v1/sync/status"

    @patch.object(httpx.Client, "request")
    def test_push_to_sets_peer_query(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": PUSH_RESULT})
        self.sync.push_to("node-b")
        call = mock_request.call_args
        assert call[0][1] == "/v1/sync/push-to"
        assert call[1]["params"] == {"peer": "node-b"}

    @patch.object(httpx.Client, "request")
    def test_pull_from_normalizes_max_seq(self, mock_request):
        mock_request.return_value = _resp(
            json_data={"data": {"entriesStreamed": 3, "maxSeq": None, "duration": 1.0}}
        )
        result = self.sync.pull_from("node-b")
        assert isinstance(result, SyncPullResult)
        assert result.entries_streamed == 3
        assert result.max_seq is None

    @patch.object(httpx.Client, "request")
    def test_list_conflicts(self, mock_request):
        mock_request.return_value = _resp(
            json_data={"data": {"conflicts": [CONFLICT], "total": 1}}, method="GET"
        )
        result = self.sync.list_conflicts(ListConflictsParams(unresolved=True))
        assert result["total"] == 1
        assert isinstance(result["conflicts"][0], SyncConflict)
        assert mock_request.call_args[1]["params"] == {"unresolved": "true"}

    @patch.object(httpx.Client, "request")
    def test_resolve_conflict(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": CONFLICT})
        result = self.sync.resolve_conflict(
            "conf-1", ResolveConflictParams(resolution="local")
        )
        assert isinstance(result, SyncConflict)
        call = mock_request.call_args
        assert call[0][1] == "/v1/sync/conflicts/conf-1/resolve"
        assert call[1]["json"] == {"resolution": "local"}


class TestSyncSyncPeersResource:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")
        self.sync = SyncSyncResource(self.client)

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_create_peer_bare_shape(self, mock_request):
        mock_request.return_value = _resp(json_data={"peer": PEER})
        peer = self.sync.peers.create(
            CreatePeerParams(name="node-b", url="https://b.example")
        )
        assert isinstance(peer, SyncPeer)
        assert peer.name == "node-b"
        assert mock_request.call_args[0][1] == "/v1/sync/peers"

    @patch.object(httpx.Client, "request")
    def test_list_peers_bare_shape(self, mock_request):
        mock_request.return_value = _resp(json_data={"peers": [PEER]}, method="GET")
        peers = self.sync.peers.list()
        assert len(peers) == 1
        assert peers[0].id == "peer-1"

    @patch.object(httpx.Client, "request")
    def test_list_peers_rejects_wrong_shape(self, mock_request):
        mock_request.return_value = _resp(json_data={"data": [PEER]}, method="GET")
        with pytest.raises(EngramError) as exc:
            self.sync.peers.list()
        assert exc.value.code == "INTERNAL_ERROR"

    @patch.object(httpx.Client, "request")
    def test_delete_peer_returns_bare(self, mock_request):
        mock_request.return_value = _resp(
            json_data={"removed": True, "name": "node-b"}, method="DELETE"
        )
        result = self.sync.peers.delete("node-b")
        assert result == {"removed": True, "name": "node-b"}

    @patch.object(httpx.Client, "request")
    def test_link_toggles(self, mock_request):
        mock_request.return_value = _resp(json_data={"peer": PEER})
        assert self.sync.peers.link("node-b") is None
        assert mock_request.call_args[0][1] == "/v1/sync/peers/node-b/link"
        self.sync.peers.pause("node-b")
        assert mock_request.call_args[0][1] == "/v1/sync/peers/node-b/link/pause"


class TestAsyncSyncResource:
    @pytest.mark.asyncio
    async def test_async_push(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*a, **k):
                    return _resp(json_data={"data": PUSH_RESULT})

                mock_request.side_effect = _r
                result = await SyncResource(client).push([SyncChange.model_validate(CHANGE)])
                assert isinstance(result, SyncPushResult)
                assert result.counts.sessions.skipped == 0
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_pull(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*a, **k):
                    return _resp(text=json.dumps(CHANGE) + "\n")

                mock_request.side_effect = _r
                changes = await SyncResource(client).pull(SyncPullParams(since_seq=None))
                assert len(changes) == 1
                assert changes[0].entity_id == "kc-1"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_async_peers_create(self):
        client = AsyncEngramClient(base_url="http://test:3100")
        try:
            with patch.object(httpx.AsyncClient, "request") as mock_request:
                async def _r(*a, **k):
                    return _resp(json_data={"peer": PEER})

                mock_request.side_effect = _r
                peer = await SyncResource(client).peers.create(
                    CreatePeerParams(name="node-b", url="https://b.example")
                )
                assert peer.name == "node-b"
        finally:
            await client.close()
