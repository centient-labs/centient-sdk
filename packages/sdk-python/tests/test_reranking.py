"""Tests for the Python SDK reranking feature.

Covers:
- Sync rerank() — valid request, returns RerankResponse
- Async rerank() — valid request with pytest-asyncio
- search() (sync) with reranking param — returns CrystalSearchWithRerankingResult
- search() (async) with reranking param
- Pydantic model validation — RerankingConfig, RerankResponse, etc.
- Error handling on 400 — raises correct error type
- HTTP delegation confirmed — POST /v1/crystals/rerank is called
"""
from __future__ import annotations

from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from engram.client import AsyncEngramClient, EngramClient
from engram.errors import EngramError, ValidationError
from engram.types.knowledge_crystal import SearchKnowledgeCrystalsParams
from engram.types.reranking import (
    CrystalSearchWithRerankingResult,
    DiagnosticRerankInfo,
    RankedCrystalSearchResult,
    RankedSearchResult,
    RerankCandidate,
    RerankRequest,
    RerankResponse,
    RerankingBoosts,
    RerankingBudgetUsage,
    RerankingConfig,
    RerankingContextBudget,
    RerankingMetadata,
)
from tests.conftest import make_api_response, SAMPLE_CRYSTAL


# ============================================================================
# Sample data for reranking tests
# ============================================================================

SAMPLE_RERANKING_METADATA: Dict[str, Any] = {
    "status": "reranked",
    "fallbackReason": None,
    "model": "mxbai-rerank-xsmall-v1",
    "latencyMs": 42.5,
    "candidatePoolSize": 15,
}

SAMPLE_RANKED_RESULT: Dict[str, Any] = {
    "id": "crystal-abc",
    "score": 0.97,
    "retrievalScore": 0.85,
    "diagnostics": None,
}

SAMPLE_RANKED_RESULT_WITH_DIAGNOSTICS: Dict[str, Any] = {
    "id": "crystal-abc",
    "score": 0.97,
    "retrievalScore": 0.85,
    "diagnostics": {
        "rawScore": 4.3,
        "retrievalScore": 0.85,
        "finalScore": 0.97,
        "boosts": {"tag_boost": 0.05},
    },
}

SAMPLE_RERANK_RESPONSE: Dict[str, Any] = {
    "results": [SAMPLE_RANKED_RESULT],
    "reranking": SAMPLE_RERANKING_METADATA,
    "budgetUsage": None,
    "diagnostics": None,
}

SAMPLE_RANKED_CRYSTAL_RESULT: Dict[str, Any] = {
    "item": SAMPLE_CRYSTAL,
    "score": 0.95,
    "retrievalScore": 0.80,
    "diagnostics": None,
}

SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING: Dict[str, Any] = {
    "results": [SAMPLE_RANKED_CRYSTAL_RESULT],
    "reranking": SAMPLE_RERANKING_METADATA,
    "diagnostics": None,
}


# ============================================================================
# Sync rerank() tests
# ============================================================================


class TestSyncRerank:
    """Tests for synchronous crystals.rerank()."""

    def setup_method(self) -> None:
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self) -> None:
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_rerank_valid_request_returns_rerank_response(self, mock_request: Any) -> None:
        """Sync rerank() with valid candidates returns a RerankResponse."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="authentication patterns",
            candidates=[
                RerankCandidate(id="abc", content="JWT auth pattern", retrieval_score=0.85),
                RerankCandidate(id="def", content="OAuth flow", retrieval_score=0.78),
            ],
            limit=5,
        )
        result = self.client.crystals.rerank(request)

        assert isinstance(result, RerankResponse)
        assert len(result.results) == 1
        assert isinstance(result.results[0], RankedSearchResult)
        assert result.results[0].id == "crystal-abc"
        assert result.results[0].score == 0.97
        assert result.results[0].retrieval_score == 0.85

    @patch.object(httpx.Client, "request")
    def test_rerank_returns_reranking_metadata(self, mock_request: Any) -> None:
        """Sync rerank() result includes RerankingMetadata with model and latency."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="authentication patterns",
            candidates=[
                RerankCandidate(id="abc", content="JWT auth", retrieval_score=0.85),
            ],
        )
        result = self.client.crystals.rerank(request)

        assert isinstance(result.reranking, RerankingMetadata)
        assert result.reranking.status == "reranked"
        assert result.reranking.model == "mxbai-rerank-xsmall-v1"
        assert result.reranking.latency_ms == 42.5
        assert result.reranking.candidate_pool_size == 15

    @patch.object(httpx.Client, "request")
    def test_rerank_posts_to_correct_endpoint(self, mock_request: Any) -> None:
        """Sync rerank() delegates to POST /v1/crystals/rerank."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test query",
            candidates=[
                RerankCandidate(id="abc", content="content", retrieval_score=0.9),
            ],
        )
        self.client.crystals.rerank(request)

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/rerank" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_rerank_sends_correct_body(self, mock_request: Any) -> None:
        """Sync rerank() serializes the request body with camelCase keys."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="auth patterns",
            candidates=[
                RerankCandidate(id="abc", content="JWT", retrieval_score=0.85),
            ],
            limit=3,
        )
        self.client.crystals.rerank(request)

        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert body["query"] == "auth patterns"
        assert body["limit"] == 3
        assert isinstance(body["candidates"], list)
        assert body["candidates"][0]["id"] == "abc"
        assert body["candidates"][0]["retrievalScore"] == 0.85

    @patch.object(httpx.Client, "request")
    def test_rerank_with_reranking_config(self, mock_request: Any) -> None:
        """Sync rerank() forwards RerankingConfig in the request body."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        config = RerankingConfig(
            strategy="cross_encoder",
            candidate_multiplier=4,
            timeout_ms=1000,
            include_diagnostics=True,
        )
        request = RerankRequest(
            query="patterns",
            candidates=[
                RerankCandidate(id="abc", content="content", retrieval_score=0.9),
            ],
            reranking=config,
        )
        self.client.crystals.rerank(request)

        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert "reranking" in body
        assert body["reranking"]["strategy"] == "cross_encoder"
        assert body["reranking"]["candidateMultiplier"] == 4
        assert body["reranking"]["timeoutMs"] == 1000
        assert body["reranking"]["includeDiagnostics"] is True

    @patch.object(httpx.Client, "request")
    def test_rerank_400_raises_validation_error(self, mock_request: Any) -> None:
        """Sync rerank() on 400 raises ValidationError (or EngramError with status 400)."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "candidates must not be empty"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[
                RerankCandidate(id="x", content="y", retrieval_score=0.5),
            ],
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.crystals.rerank(request)

        assert exc_info.value.status_code == 400

    @patch.object(httpx.Client, "request")
    def test_rerank_with_budget_usage_in_response(self, mock_request: Any) -> None:
        """Sync rerank() parses optional budgetUsage in the response."""
        response_with_budget = {
            **SAMPLE_RERANK_RESPONSE,
            "budgetUsage": {
                "tokensUsed": 1024,
                "tokenLimit": 4096,
                "truncated": False,
            },
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(response_with_budget),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[
                RerankCandidate(id="abc", content="content", retrieval_score=0.9),
            ],
            reranking=RerankingConfig(
                context_budget=RerankingContextBudget(max_tokens=4096, overflow_strategy="drop"),
            ),
        )
        result = self.client.crystals.rerank(request)

        assert isinstance(result.budget_usage, RerankingBudgetUsage)
        assert result.budget_usage.tokens_used == 1024
        assert result.budget_usage.token_limit == 4096
        assert result.budget_usage.truncated is False

    @patch.object(httpx.Client, "request")
    def test_rerank_with_diagnostics_in_results(self, mock_request: Any) -> None:
        """Sync rerank() parses per-result DiagnosticRerankInfo when present."""
        response_with_diag = {
            "results": [SAMPLE_RANKED_RESULT_WITH_DIAGNOSTICS],
            "reranking": SAMPLE_RERANKING_METADATA,
            "budgetUsage": None,
            "diagnostics": {"total_candidates": 10},
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(response_with_diag),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[
                RerankCandidate(id="abc", content="content", retrieval_score=0.85),
            ],
            reranking=RerankingConfig(include_diagnostics=True),
        )
        result = self.client.crystals.rerank(request)

        assert result.results[0].diagnostics is not None
        assert isinstance(result.results[0].diagnostics, DiagnosticRerankInfo)
        assert result.results[0].diagnostics.raw_score == 4.3
        assert result.results[0].diagnostics.final_score == 0.97
        assert result.diagnostics == {"total_candidates": 10}


# ============================================================================
# Async rerank() tests
# ============================================================================


class TestAsyncRerank:
    """Tests for asynchronous crystals.rerank()."""

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_valid_request_returns_rerank_response(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() with valid candidates returns a RerankResponse."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="authentication patterns",
                candidates=[
                    RerankCandidate(id="abc", content="JWT auth", retrieval_score=0.85),
                    RerankCandidate(id="def", content="OAuth", retrieval_score=0.78),
                ],
                limit=5,
            )
            result = await client.crystals.rerank(request)

        assert isinstance(result, RerankResponse)
        assert len(result.results) == 1
        assert result.results[0].id == "crystal-abc"
        assert result.results[0].score == 0.97

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_posts_to_correct_endpoint(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() delegates to POST /v1/crystals/rerank."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="test",
                candidates=[
                    RerankCandidate(id="abc", content="content", retrieval_score=0.9),
                ],
            )
            await client.crystals.rerank(request)

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/rerank" in call_args[0][1]

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_returns_reranking_metadata(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() result includes RerankingMetadata."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="test",
                candidates=[
                    RerankCandidate(id="abc", content="content", retrieval_score=0.9),
                ],
            )
            result = await client.crystals.rerank(request)

        assert isinstance(result.reranking, RerankingMetadata)
        assert result.reranking.status == "reranked"
        assert result.reranking.model == "mxbai-rerank-xsmall-v1"

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_400_raises_engram_error(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() on 400 raises EngramError with status 400."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid request"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="test",
                candidates=[
                    RerankCandidate(id="x", content="y", retrieval_score=0.5),
                ],
            )
            with pytest.raises(EngramError) as exc_info:
                await client.crystals.rerank(request)

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_heuristic_fallback_status(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() handles heuristic_fallback status in metadata."""
        fallback_response: Dict[str, Any] = {
            "results": [SAMPLE_RANKED_RESULT],
            "reranking": {
                "status": "heuristic_fallback",
                "fallbackReason": "model_unavailable",
                "model": None,
                "latencyMs": 2.1,
                "candidatePoolSize": 5,
            },
            "budgetUsage": None,
            "diagnostics": None,
        }
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(fallback_response),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="test",
                candidates=[
                    RerankCandidate(id="abc", content="content", retrieval_score=0.9),
                ],
            )
            result = await client.crystals.rerank(request)

        assert result.reranking.status == "heuristic_fallback"
        assert result.reranking.fallback_reason == "model_unavailable"
        assert result.reranking.model is None


# ============================================================================
# Sync search() with reranking param
# ============================================================================


class TestSyncSearchWithReranking:
    """Tests for synchronous crystals.search() with reranking enabled."""

    def setup_method(self) -> None:
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self) -> None:
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_returns_crystal_search_with_reranking_result(
        self, mock_request: Any
    ) -> None:
        """Sync search() with reranking=True returns CrystalSearchWithRerankingResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="auth patterns",
            limit=5,
            reranking=RerankingConfig(enabled=True, candidate_multiplier=3),
        )
        result = self.client.crystals.search(params)

        assert isinstance(result, CrystalSearchWithRerankingResult)
        assert len(result.results) == 1
        assert isinstance(result.results[0], RankedCrystalSearchResult)

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_result_contains_item_and_scores(
        self, mock_request: Any
    ) -> None:
        """Sync search() reranking result includes hydrated item and scores."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="auth patterns",
            reranking=RerankingConfig(enabled=True),
        )
        result = self.client.crystals.search(params)

        assert isinstance(result, CrystalSearchWithRerankingResult)
        first = result.results[0]
        assert first.score == 0.95
        assert first.retrieval_score == 0.80
        assert first.item is not None

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_posts_to_search_endpoint(
        self, mock_request: Any
    ) -> None:
        """Sync search() with reranking sends POST to /v1/crystals/search."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="auth patterns",
            reranking=RerankingConfig(enabled=True),
        )
        self.client.crystals.search(params)

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/search" in call_args[0][1]

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_sends_config_in_body(
        self, mock_request: Any
    ) -> None:
        """Sync search() serializes RerankingConfig into the request body."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="auth patterns",
            limit=5,
            reranking=RerankingConfig(
                enabled=True,
                candidate_multiplier=4,
                strategy="cross_encoder",
            ),
        )
        self.client.crystals.search(params)

        call_args = mock_request.call_args
        body = call_args[1].get("json", {})
        assert body.get("query") == "auth patterns"
        assert body.get("limit") == 5
        assert "reranking" in body
        assert body["reranking"]["enabled"] is True
        assert body["reranking"]["candidateMultiplier"] == 4
        assert body["reranking"]["strategy"] == "cross_encoder"

    @patch.object(httpx.Client, "request")
    def test_search_without_reranking_returns_list(self, mock_request: Any) -> None:
        """Sync search() without reranking still returns a plain list."""
        from engram.types.knowledge_crystal import KnowledgeCrystalSearchResult

        plain_result = {"item": SAMPLE_CRYSTAL, "score": 0.92}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([plain_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(query="auth patterns")
        result = self.client.crystals.search(params)

        assert isinstance(result, list)
        assert isinstance(result[0], KnowledgeCrystalSearchResult)

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_includes_reranking_metadata(
        self, mock_request: Any
    ) -> None:
        """Sync search() reranking result exposes RerankingMetadata."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="auth patterns",
            reranking=RerankingConfig(enabled=True),
        )
        result = self.client.crystals.search(params)

        assert isinstance(result, CrystalSearchWithRerankingResult)
        assert isinstance(result.reranking, RerankingMetadata)
        assert result.reranking.status == "reranked"


# ============================================================================
# Async search() with reranking param
# ============================================================================


class TestAsyncSearchWithReranking:
    """Tests for asynchronous crystals.search() with reranking enabled."""

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_search_with_reranking_returns_correct_type(
        self, mock_request: AsyncMock
    ) -> None:
        """Async search() with reranking=True returns CrystalSearchWithRerankingResult."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            params = SearchKnowledgeCrystalsParams(
                query="auth patterns",
                limit=5,
                reranking=RerankingConfig(enabled=True, candidate_multiplier=3),
            )
            result = await client.crystals.search(params)

        assert isinstance(result, CrystalSearchWithRerankingResult)
        assert len(result.results) == 1
        assert isinstance(result.results[0], RankedCrystalSearchResult)

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_search_with_reranking_has_scores(
        self, mock_request: AsyncMock
    ) -> None:
        """Async search() reranking result contains correct score fields."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            params = SearchKnowledgeCrystalsParams(
                query="auth patterns",
                reranking=RerankingConfig(enabled=True),
            )
            result = await client.crystals.search(params)

        assert isinstance(result, CrystalSearchWithRerankingResult)
        assert result.results[0].score == 0.95
        assert result.results[0].retrieval_score == 0.80

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_search_with_reranking_posts_to_correct_endpoint(
        self, mock_request: AsyncMock
    ) -> None:
        """Async search() with reranking still sends POST to /v1/crystals/search."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            params = SearchKnowledgeCrystalsParams(
                query="auth patterns",
                reranking=RerankingConfig(enabled=True),
            )
            await client.crystals.search(params)

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert "/v1/crystals/search" in call_args[0][1]

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_search_without_reranking_returns_list(
        self, mock_request: AsyncMock
    ) -> None:
        """Async search() without reranking returns a plain list."""
        from engram.types.knowledge_crystal import KnowledgeCrystalSearchResult

        plain_result = {"item": SAMPLE_CRYSTAL, "score": 0.88}
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response([plain_result]),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            params = SearchKnowledgeCrystalsParams(query="auth patterns")
            result = await client.crystals.search(params)

        assert isinstance(result, list)
        assert isinstance(result[0], KnowledgeCrystalSearchResult)


# ============================================================================
# Pydantic model validation tests
# ============================================================================


class TestRerankingPydanticModels:
    """Tests for Pydantic model validation of reranking types."""

    def test_reranking_config_defaults(self) -> None:
        """RerankingConfig can be created with no arguments."""
        config = RerankingConfig()
        assert config.enabled is None
        assert config.strategy is None
        assert config.candidate_multiplier is None
        assert config.timeout_ms is None
        assert config.include_diagnostics is None
        assert config.context_budget is None
        assert config.boosts is None

    def test_reranking_config_with_all_fields(self) -> None:
        """RerankingConfig accepts all valid fields."""
        config = RerankingConfig(
            enabled=True,
            strategy="cross_encoder",
            candidate_multiplier=3.0,
            timeout_ms=2000,
            include_diagnostics=False,
        )
        assert config.enabled is True
        assert config.strategy == "cross_encoder"
        assert config.candidate_multiplier == 3.0
        assert config.timeout_ms == 2000
        assert config.include_diagnostics is False

    def test_reranking_config_candidate_multiplier_range(self) -> None:
        """RerankingConfig candidate_multiplier must be between 1 and 10."""
        from pydantic import ValidationError as PydanticValidationError

        with pytest.raises(PydanticValidationError):
            RerankingConfig(candidate_multiplier=0.5)

        with pytest.raises(PydanticValidationError):
            RerankingConfig(candidate_multiplier=11)

        # boundary values should be valid
        assert RerankingConfig(candidate_multiplier=1).candidate_multiplier == 1
        assert RerankingConfig(candidate_multiplier=10).candidate_multiplier == 10

    def test_reranking_config_timeout_ms_range(self) -> None:
        """RerankingConfig timeout_ms must be between 50 and 5000."""
        from pydantic import ValidationError as PydanticValidationError

        with pytest.raises(PydanticValidationError):
            RerankingConfig(timeout_ms=49)

        with pytest.raises(PydanticValidationError):
            RerankingConfig(timeout_ms=5001)

        # boundary values should be valid
        assert RerankingConfig(timeout_ms=50).timeout_ms == 50
        assert RerankingConfig(timeout_ms=5000).timeout_ms == 5000

    def test_reranking_config_camelcase_serialization(self) -> None:
        """RerankingConfig serializes to camelCase via alias_generator."""
        config = RerankingConfig(
            enabled=True,
            candidate_multiplier=4,
            timeout_ms=1500,
            include_diagnostics=True,
        )
        dumped = config.model_dump(by_alias=True, exclude_none=True)
        assert "candidateMultiplier" in dumped
        assert "timeoutMs" in dumped
        assert "includeDiagnostics" in dumped
        assert "candidate_multiplier" not in dumped

    def test_reranking_context_budget_fields(self) -> None:
        """RerankingContextBudget holds max_tokens and overflow_strategy."""
        budget = RerankingContextBudget(max_tokens=2048, overflow_strategy="truncate")
        assert budget.max_tokens == 2048
        assert budget.overflow_strategy == "truncate"

    def test_reranking_boosts_fields(self) -> None:
        """RerankingBoosts holds tags, recency_days, recency_boost."""
        boosts = RerankingBoosts(
            tags={"auth": 0.1, "security": 0.2},
            recency_days=30,
            recency_boost=0.5,
        )
        assert boosts.tags == {"auth": 0.1, "security": 0.2}
        assert boosts.recency_days == 30
        assert boosts.recency_boost == 0.5

    def test_rerank_candidate_required_fields(self) -> None:
        """RerankCandidate requires id, content, retrieval_score."""
        from pydantic import ValidationError as PydanticValidationError

        with pytest.raises(PydanticValidationError):
            RerankCandidate(content="text", retrieval_score=0.9)  # type: ignore[call-arg]

        with pytest.raises(PydanticValidationError):
            RerankCandidate(id="abc", retrieval_score=0.9)  # type: ignore[call-arg]

        # valid
        candidate = RerankCandidate(id="abc", content="text", retrieval_score=0.9)
        assert candidate.id == "abc"
        assert candidate.content == "text"
        assert candidate.retrieval_score == 0.9

    def test_rerank_candidate_optional_fields(self) -> None:
        """RerankCandidate optional fields default to None."""
        candidate = RerankCandidate(id="abc", content="text", retrieval_score=0.9)
        assert candidate.created_at is None
        assert candidate.tags is None

    def test_rerank_candidate_camelcase_serialization(self) -> None:
        """RerankCandidate serializes retrievalScore in camelCase."""
        candidate = RerankCandidate(id="abc", content="text", retrieval_score=0.85)
        dumped = candidate.model_dump(by_alias=True, exclude_none=True)
        assert "retrievalScore" in dumped
        assert "retrieval_score" not in dumped

    def test_rerank_request_required_fields(self) -> None:
        """RerankRequest requires query and candidates."""
        from pydantic import ValidationError as PydanticValidationError

        with pytest.raises(PydanticValidationError):
            RerankRequest(query="test")  # type: ignore[call-arg]

        req = RerankRequest(
            query="test",
            candidates=[RerankCandidate(id="a", content="b", retrieval_score=0.5)],
        )
        assert req.query == "test"
        assert len(req.candidates) == 1

    def test_rerank_response_model_validate(self) -> None:
        """RerankResponse.model_validate parses a raw dict correctly."""
        raw = {
            "results": [
                {"id": "x", "score": 0.9, "retrievalScore": 0.8, "diagnostics": None}
            ],
            "reranking": {
                "status": "reranked",
                "fallbackReason": None,
                "model": "test-model",
                "latencyMs": 10.0,
                "candidatePoolSize": 5,
            },
            "budgetUsage": None,
            "diagnostics": None,
        }
        response = RerankResponse.model_validate(raw)
        assert isinstance(response, RerankResponse)
        assert response.results[0].id == "x"
        assert response.results[0].score == 0.9
        assert response.reranking.model == "test-model"

    def test_reranking_metadata_statuses(self) -> None:
        """RerankingMetadata accepts all three valid status values."""
        for status in ("reranked", "heuristic_fallback", "skipped"):
            meta = RerankingMetadata(status=status)  # type: ignore[arg-type]
            assert meta.status == status

    def test_reranking_metadata_invalid_status(self) -> None:
        """RerankingMetadata rejects unknown status values."""
        from pydantic import ValidationError as PydanticValidationError

        with pytest.raises(PydanticValidationError):
            RerankingMetadata(status="unknown_status")  # type: ignore[arg-type]

    def test_crystal_search_with_reranking_result_model_validate(self) -> None:
        """CrystalSearchWithRerankingResult.model_validate parses response correctly."""
        raw = {
            "results": [
                {
                    "item": SAMPLE_CRYSTAL,
                    "score": 0.95,
                    "retrievalScore": 0.80,
                    "diagnostics": None,
                }
            ],
            "reranking": {
                "status": "reranked",
                "fallbackReason": None,
                "model": "test-model",
                "latencyMs": 5.0,
                "candidatePoolSize": 3,
            },
            "diagnostics": None,
        }
        result = CrystalSearchWithRerankingResult.model_validate(raw)
        assert isinstance(result, CrystalSearchWithRerankingResult)
        assert len(result.results) == 1
        assert result.results[0].score == 0.95
        assert result.results[0].retrieval_score == 0.80

    def test_diagnostic_rerank_info_fields(self) -> None:
        """DiagnosticRerankInfo parses all diagnostic fields."""
        raw = {
            "rawScore": 3.7,
            "retrievalScore": 0.75,
            "finalScore": 0.88,
            "boosts": {"tag_boost": 0.03},
        }
        info = DiagnosticRerankInfo.model_validate(raw)
        assert info.raw_score == 3.7
        assert info.retrieval_score == 0.75
        assert info.final_score == 0.88
        assert info.boosts == {"tag_boost": 0.03}

    def test_reranking_budget_usage_fields(self) -> None:
        """RerankingBudgetUsage parses all fields correctly."""
        raw = {"tokensUsed": 512, "tokenLimit": 2048, "truncated": True}
        usage = RerankingBudgetUsage.model_validate(raw)
        assert usage.tokens_used == 512
        assert usage.token_limit == 2048
        assert usage.truncated is True


# ============================================================================
# Error handling tests
# ============================================================================


class TestRerankErrorHandling:
    """Tests for error handling in reranking operations."""

    def setup_method(self) -> None:
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self) -> None:
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_rerank_400_flat_error_raises_engram_error(
        self, mock_request: Any
    ) -> None:
        """Flat {code, message} 400 error raises EngramError with code and status."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "candidates must not be empty"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[RerankCandidate(id="x", content="y", retrieval_score=0.5)],
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.crystals.rerank(request)

        error = exc_info.value
        assert error.status_code == 400
        assert "candidates must not be empty" in str(error)

    @patch.object(httpx.Client, "request")
    def test_rerank_400_zod_error_raises_validation_error(
        self, mock_request: Any
    ) -> None:
        """Zod-shape 400 raises ValidationError with issues list."""
        zod_body = {
            "success": False,
            "error": {
                "name": "ZodError",
                "issues": [
                    {"path": ["candidates"], "message": "Required"},
                ],
            },
        }
        mock_request.return_value = httpx.Response(
            400,
            json=zod_body,
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[RerankCandidate(id="x", content="y", retrieval_score=0.5)],
        )
        with pytest.raises(ValidationError) as exc_info:
            self.client.crystals.rerank(request)

        error = exc_info.value
        assert error.status_code == 400
        assert len(error.issues) == 1

    @patch.object(httpx.Client, "request")
    def test_rerank_404_raises_not_found_error(self, mock_request: Any) -> None:
        """404 response raises NotFoundError."""
        from engram.errors import NotFoundError

        mock_request.return_value = httpx.Response(
            404,
            json={"code": "NOT_FOUND", "message": "endpoint not found"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        request = RerankRequest(
            query="test",
            candidates=[RerankCandidate(id="x", content="y", retrieval_score=0.5)],
        )
        with pytest.raises(NotFoundError):
            self.client.crystals.rerank(request)

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_400_raises_engram_error(
        self, mock_request: Any
    ) -> None:
        """search() with reranking 400 error raises EngramError."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid reranking config"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        params = SearchKnowledgeCrystalsParams(
            query="test",
            reranking=RerankingConfig(enabled=True),
        )
        with pytest.raises(EngramError) as exc_info:
            self.client.crystals.search(params)

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_rerank_400_raises_engram_error(
        self, mock_request: AsyncMock
    ) -> None:
        """Async rerank() 400 raises EngramError with correct status code."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "bad request"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            request = RerankRequest(
                query="test",
                candidates=[RerankCandidate(id="x", content="y", retrieval_score=0.5)],
            )
            with pytest.raises(EngramError) as exc_info:
                await client.crystals.rerank(request)

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    @patch.object(httpx.AsyncClient, "request", new_callable=AsyncMock)
    async def test_async_search_with_reranking_400_raises_engram_error(
        self, mock_request: AsyncMock
    ) -> None:
        """Async search() with reranking 400 raises EngramError."""
        mock_request.return_value = httpx.Response(
            400,
            json={"code": "VALIDATION_ERROR", "message": "invalid config"},
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )

        async with AsyncEngramClient(base_url="http://test:3100") as client:
            params = SearchKnowledgeCrystalsParams(
                query="test",
                reranking=RerankingConfig(enabled=True),
            )
            with pytest.raises(EngramError) as exc_info:
                await client.crystals.search(params)

        assert exc_info.value.status_code == 400


# ============================================================================
# HTTP delegation confirmation tests
# ============================================================================


class TestRerankHttpDelegation:
    """Confirms correct HTTP method + endpoint delegation for reranking calls."""

    def setup_method(self) -> None:
        self.client = EngramClient(base_url="http://test:3100")

    def teardown_method(self) -> None:
        self.client.close()

    @patch.object(httpx.Client, "request")
    def test_rerank_uses_post_method(self, mock_request: Any) -> None:
        """rerank() uses HTTP POST."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )
        self.client.crystals.rerank(
            RerankRequest(
                query="q",
                candidates=[RerankCandidate(id="a", content="b", retrieval_score=0.5)],
            )
        )
        assert mock_request.call_args[0][0] == "POST"

    @patch.object(httpx.Client, "request")
    def test_rerank_uses_v1_crystals_rerank_path(self, mock_request: Any) -> None:
        """rerank() targets exactly /v1/crystals/rerank."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_RERANK_RESPONSE),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/rerank"),
        )
        self.client.crystals.rerank(
            RerankRequest(
                query="q",
                candidates=[RerankCandidate(id="a", content="b", retrieval_score=0.5)],
            )
        )
        url = mock_request.call_args[0][1]
        assert url.endswith("/v1/crystals/rerank")

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_uses_post_method(self, mock_request: Any) -> None:
        """search() with reranking uses HTTP POST (not GET)."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )
        self.client.crystals.search(
            SearchKnowledgeCrystalsParams(
                query="test",
                reranking=RerankingConfig(enabled=True),
            )
        )
        assert mock_request.call_args[0][0] == "POST"

    @patch.object(httpx.Client, "request")
    def test_search_with_reranking_uses_v1_crystals_search_path(
        self, mock_request: Any
    ) -> None:
        """search() with reranking targets /v1/crystals/search."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )
        self.client.crystals.search(
            SearchKnowledgeCrystalsParams(
                query="test",
                reranking=RerankingConfig(enabled=True),
            )
        )
        url = mock_request.call_args[0][1]
        assert url.endswith("/v1/crystals/search")

    @patch.object(httpx.Client, "request")
    def test_rerank_not_called_on_search_endpoint(self, mock_request: Any) -> None:
        """Calling search() does NOT call /v1/crystals/rerank."""
        mock_request.return_value = httpx.Response(
            200,
            json=make_api_response(SAMPLE_CRYSTAL_SEARCH_WITH_RERANKING),
            request=httpx.Request("POST", "http://test:3100/v1/crystals/search"),
        )
        self.client.crystals.search(
            SearchKnowledgeCrystalsParams(
                query="test",
                reranking=RerankingConfig(enabled=True),
            )
        )
        url = mock_request.call_args[0][1]
        assert "/v1/crystals/rerank" not in url
        assert "/v1/crystals/search" in url
