"""Tests for embedding methods on the client."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from engram.client import EngramClient
from engram.types.embeddings import (
    BatchEmbeddingResponse,
    EmbeddingInfoResponse,
    EmbeddingResponse,
)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

SAMPLE_EMBEDDING_RESPONSE = {
    "embedding": [0.1, 0.2, 0.3, 0.4, 0.5],
    "dimensions": 5,
    "model": "text-embedding-004",
    "cached": False,
    "took": 123.4,
}

SAMPLE_BATCH_RESPONSE = {
    "embeddings": [
        {"embedding": [0.1, 0.2], "dimensions": 2, "cached": False},
        {"embedding": [0.3, 0.4], "dimensions": 2, "cached": True},
    ],
    "count": 2,
    "model": "text-embedding-004",
    "took": 200.5,
}

SAMPLE_INFO_RESPONSE = {
    "available": True,
    "model": "text-embedding-004",
    "dimensions": 768,
    "maxInputChars": 8000,
    "cache": {
        "size": 42,
        "maxSize": 1000,
    },
}


# ===========================================================================
# Tests
# ===========================================================================


class TestSyncEmbeddings:
    def setup_method(self):
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self):
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_embed(self, mock_request):
        """embed() sends POST to /v1/embeddings and returns EmbeddingResponse."""
        mock_request.return_value = httpx.Response(
            200,
            json=SAMPLE_EMBEDDING_RESPONSE,
            request=httpx.Request("POST", "http://test:3100/v1/embeddings"),
        )

        result = self.client.embed("hello world")

        assert isinstance(result, EmbeddingResponse)
        assert result.embedding == [0.1, 0.2, 0.3, 0.4, 0.5]
        assert result.dimensions == 5
        assert result.model == "text-embedding-004"
        assert result.cached is False
        assert result.took == 123.4
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/embeddings" in call_args[0][1]
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body["text"] == "hello world"
        assert "module" not in body

    @patch.object(httpx.Client, "request")
    def test_embed_with_module(self, mock_request):
        """embed() passes module parameter when provided."""
        mock_request.return_value = httpx.Response(
            200,
            json=SAMPLE_EMBEDDING_RESPONSE,
            request=httpx.Request("POST", "http://test:3100/v1/embeddings"),
        )

        self.client.embed("hello world", module="session")

        call_args = mock_request.call_args
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body["text"] == "hello world"
        assert body["module"] == "session"

    @patch.object(httpx.Client, "request")
    def test_embed_batch(self, mock_request):
        """embed_batch() sends POST to /v1/embeddings/batch with texts and module."""
        mock_request.return_value = httpx.Response(
            200,
            json=SAMPLE_BATCH_RESPONSE,
            request=httpx.Request("POST", "http://test:3100/v1/embeddings/batch"),
        )

        result = self.client.embed_batch(["text1", "text2"], module="search")

        assert isinstance(result, BatchEmbeddingResponse)
        assert result.count == 2
        assert result.model == "text-embedding-004"
        assert result.took == 200.5
        assert len(result.embeddings) == 2
        assert result.embeddings[0].embedding == [0.1, 0.2]
        assert result.embeddings[0].cached is False
        assert result.embeddings[1].cached is True
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/embeddings/batch" in call_args[0][1]
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body["texts"] == ["text1", "text2"]
        assert body["module"] == "search"

    @patch.object(httpx.Client, "request")
    def test_embed_batch_default_module(self, mock_request):
        """embed_batch() defaults to module='search'."""
        mock_request.return_value = httpx.Response(
            200,
            json=SAMPLE_BATCH_RESPONSE,
            request=httpx.Request("POST", "http://test:3100/v1/embeddings/batch"),
        )

        self.client.embed_batch(["text1"])

        call_args = mock_request.call_args
        body = call_args[1].get("json") or call_args.kwargs.get("json")
        assert body["module"] == "search"

    @patch.object(httpx.Client, "request")
    def test_embedding_info(self, mock_request):
        """embedding_info() sends GET to /v1/embeddings/info and returns EmbeddingInfoResponse."""
        mock_request.return_value = httpx.Response(
            200,
            json=SAMPLE_INFO_RESPONSE,
            request=httpx.Request("GET", "http://test:3100/v1/embeddings/info"),
        )

        result = self.client.embedding_info()

        assert isinstance(result, EmbeddingInfoResponse)
        assert result.available is True
        assert result.model == "text-embedding-004"
        assert result.dimensions == 768
        assert result.max_input_chars == 8000
        assert result.cache.size == 42
        assert result.cache.max_size == 1000
        call_args = mock_request.call_args
        assert call_args[0][0] == "GET"
        assert "/v1/embeddings/info" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_embed_error(self, mock_request):
        """embed() raises on server error."""
        from engram.errors import InternalError

        mock_request.return_value = httpx.Response(
            500,
            json={"code": "INTERNAL_ERROR", "message": "embedding service unavailable"},
            request=httpx.Request("POST", "http://test:3100/v1/embeddings"),
        )

        with pytest.raises(InternalError, match="embedding service unavailable"):
            self.client.embed("test")
