"""Engram Python SDK client."""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, AsyncIterator, Iterator, Optional
from urllib.parse import urlsplit

import warnings

import httpx

from engram.errors import (
    EngramError,
    EngramTimeoutError,
    NetworkError,
    parse_api_error,
)
from engram.resources.sessions import SessionsResource, SyncSessionsResource
from engram.resources.notes import NotesResource, SyncNotesResource
from engram.resources.edges import EdgesResource, SyncEdgesResource
from engram.resources.crystals import CrystalsResource, SyncCrystalsResource
from engram.resources.session_links import SessionLinksResource, SyncSessionLinksResource
from engram.resources.terrafirma import TerrafirmaResource, SyncTerrafirmaResource
from engram.resources.blobs import BlobsResource, SyncBlobsResource
from engram.resources.audit import AuditResource, SyncAuditResource
from engram.resources.events import EventsResource, SyncEventsResource
from engram.resources.export_import import ExportImportResource, SyncExportImportResource
from engram.resources.entities import EntitiesResource, SyncEntitiesResource
from engram.resources.extraction import ExtractionResource, SyncExtractionResource
from engram.resources.maintenance import MaintenanceResource, SyncMaintenanceResource
from engram.resources.sync import SyncResource, SyncSyncResource
from engram.resources.agents import AgentsResource, SyncAgentsResource
from engram.resources.ambient_context import (
    AmbientContextResource,
    SyncAmbientContextResource,
)
from engram.resources.facts import FactsResource, SyncFactsResource
from engram.resources.gc import GcResource, SyncGcResource
from engram.resources.memory_spaces import (
    MemorySpacesResource,
    SyncMemorySpacesResource,
)
from engram.resources.users import UsersResource, SyncUsersResource
from engram.resources.shimmers import ShimmersResource, SyncShimmersResource
from engram.types.embeddings import (
    EmbeddingInfoResponse,
    EmbeddingResponse,
    BatchEmbeddingResponse,
)

logger = logging.getLogger("engram")


def _sanitize_path(path: str) -> str:
    """Strip query parameters from a path for safe logging at WARNING/ERROR level."""
    parts = urlsplit(path)
    return parts.path or path

DEFAULT_BASE_URL = "http://localhost:3100"
DEFAULT_TIMEOUT = 30.0
DEFAULT_RETRIES = 3
DEFAULT_RETRY_DELAY = 1.0

# Minimum engram-server version required by this SDK. Use
# ``client.check_server_compatibility()`` to verify at runtime. Mirrors
# ``MIN_SERVER_VERSION`` in packages/sdk/src/client.ts:204.
#
# - 0.30.0 landed ``expectedVersion`` CAS support on ``PATCH /crystals/:id``.
# - 0.31.0 landed ``skipEmbedding`` support on ``PATCH /crystals/:id``.
#
# Older servers silently ignore both fields: correctness is preserved, but CAS
# is not enforced and the embedding-skip optimization is a no-op.
#
# Newer feature floors (the SDK still works against 0.31.x for everything else,
# so the gate stays at 0.31.0 — check these per-feature when used):
# - 0.34.0 added ``skipEmbedding`` on ``POST /crystals`` (engram-server#763),
#   ``POST /v1/maintenance/vacuum`` (engram-server#766), and migrated the
#   ``/v1/sync`` routes to the standard ``{success, data}`` envelopes. Against
#   older servers, ``skipEmbedding``-on-create is ignored, ``vacuum()`` 404s,
#   and the sync wire shapes differ.
MIN_SERVER_VERSION = "0.31.0"


def _is_version_gte(actual: str, required: str) -> bool:
    """Return ``True`` when ``actual`` >= ``required`` (semver major.minor.patch).

    Unknown / unparseable versions return ``False`` so the compatibility gate
    fails closed. Mirrors ``EngramClient.isVersionGte`` in
    packages/sdk/src/client.ts.
    """

    def parse(v: str) -> list[int]:
        parts: list[int] = []
        for segment in v.split("."):
            try:
                parts.append(int(segment))
            except ValueError:
                # A non-numeric segment (e.g. a pre-release/build suffix like
                # ``0.31.0-alpha`` or a stray ``0.31.x``) is unparseable here.
                # We deliberately fail closed (return []), but emit a warning so
                # the format issue is diagnosable rather than silently swallowed.
                logger.warning(
                    "unparseable version segment %r in %r; treating version as "
                    "incompatible (fail-closed)",
                    segment,
                    v,
                )
                return []
        return parts

    a = parse(actual)
    r = parse(required)
    if not a:
        return False
    a_major, a_minor, a_patch = (a + [0, 0, 0])[:3]
    r_major, r_minor, r_patch = (r + [0, 0, 0])[:3]
    if a_major != r_major:
        return a_major > r_major
    if a_minor != r_minor:
        return a_minor > r_minor
    return a_patch >= r_patch


class AsyncEngramClient:
    """Async client for the Engram Memory Server API.

    Usage:
        async with AsyncEngramClient(base_url="http://localhost:3100") as client:
            session = await client.sessions.create(
                CreateLocalSessionParams(project_path="/my/project")
            )
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        api_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
        allow_insecure: bool = False,
    ) -> None:
        """Initialize the async Engram client.

        Args:
            base_url: Base URL of the Engram server. Defaults to ``http://localhost:3100``.
            api_key: Optional API key sent via the ``X-API-Key`` header.
            timeout: Request timeout in seconds. Defaults to 30.
            retries: Maximum number of retry attempts for retriable errors. Defaults to 3.
            retry_delay: Base delay in seconds between retries (multiplied by attempt number
                for linear backoff). Defaults to 1.0.
            allow_insecure: When ``False`` (default), sending an API key over plain HTTP
                to a non-localhost host raises :class:`ValueError`.  Set to ``True`` to
                downgrade to a warning.
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._retries = retries
        self._retry_delay = retry_delay

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["X-API-Key"] = api_key

        if api_key and urlsplit(self._base_url).scheme == "http":
            host = urlsplit(self._base_url).hostname or ""
            if host not in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
                msg = (
                    f"API key will be sent in cleartext over HTTP to {host}. "
                    "Use HTTPS for non-localhost connections or pass "
                    "allow_insecure=True to override."
                )
                if allow_insecure:
                    warnings.warn(msg, stacklevel=2)
                else:
                    raise ValueError(msg)

        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            timeout=httpx.Timeout(timeout),
        )

        # Resource accessors
        self.sessions = SessionsResource(self)
        self.notes = NotesResource(self)
        self.edges = EdgesResource(self)
        self.crystals = CrystalsResource(self)
        self.session_links = SessionLinksResource(self)
        self.terrafirma = TerrafirmaResource(self)
        self.blobs = BlobsResource(self)
        self.audit = AuditResource(self)
        self.events = EventsResource(self)
        self.export_import = ExportImportResource(self)
        self.entities = EntitiesResource(self)
        self.extraction = ExtractionResource(self)
        self.maintenance = MaintenanceResource(self)
        self.sync = SyncResource(self)
        self.agents = AgentsResource(self)
        self.ambient_context = AmbientContextResource(self)
        self.facts = FactsResource(self)
        self.gc = GcResource(self)
        self.memory_spaces = MemorySpacesResource(self)
        self.users = UsersResource(self)
        self.shimmers = ShimmersResource(self)

    async def __aenter__(self) -> AsyncEngramClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client and release resources."""
        await self._http.aclose()

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(base_url={self._base_url!r}, api_key={'[REDACTED]' if self._api_key else None})"

    async def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> Any:
        """Send an HTTP request with automatic retry on retriable errors.

        Retries on 5xx server errors and network-level failures (e.g. connection
        refused, DNS resolution errors) using linear backoff (``retry_delay * attempt``).
        Client errors (4xx) are never retried and are raised immediately.

        Raises:
            EngramError: On API errors (parsed from the response body).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries are exhausted.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request {method} {path} [req={_request_id}]")

        try:
            kwargs: dict[str, Any] = {
                "headers": {"X-Request-ID": _request_id},
            }
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params

            response = await self._http.request(method, path, **kwargs)

            if response.status_code == 204:
                return None

            data = response.json()

            if not response.is_success:
                parse_api_error(response.status_code, data)

            return data

        except EngramError as exc:
            # Retry on server errors
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request(method, path, body, params=params, _attempt=_attempt + 1, _request_id=_request_id)
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request(method, path, body, params=params, _attempt=_attempt + 1, _request_id=_request_id)
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    async def _request_raw(
        self,
        method: str,
        path: str,
        content: bytes | None = None,
        content_type: str = "application/octet-stream",
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> httpx.Response:
        """Send an HTTP request with raw binary content.

        Sends raw bytes in the request body and returns the full ``httpx.Response``
        so callers can access ``.content`` (bytes) or ``.headers`` directly.

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (GET, POST, PUT, etc.).
            path: URL path relative to base_url.
            content: Raw bytes to send as the request body. ``None`` for GET requests.
            content_type: MIME type for the ``Content-Type`` header.
                Defaults to ``application/octet-stream``.
            params: Optional query parameters.

        Returns:
            The raw ``httpx.Response`` object.

        Raises:
            EngramError: On API errors (parsed from the response body when JSON).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_raw {method} {path} [req={_request_id}]")

        try:
            headers: dict[str, str] = {
                "X-Request-ID": _request_id,
                "Content-Type": content_type,
            }
            kwargs: dict[str, Any] = {"headers": headers}
            if content is not None:
                kwargs["content"] = content
            if params is not None:
                kwargs["params"] = params

            response = await self._http.request(method, path, **kwargs)

            if not response.is_success:
                # Try to parse JSON error body; fall back to status code
                try:
                    data = response.json()
                    parse_api_error(response.status_code, data)
                except ValueError:
                    raise EngramError(
                        response.text or f"HTTP {response.status_code}",
                        code="HTTP_ERROR",
                        status_code=response.status_code,
                    )

            return response

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request_raw(
                    method, path, content, content_type,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request_raw(
                    method, path, content, content_type,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    async def _request_stream(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> AsyncIterator[bytes]:
        """Send an HTTP request and return an async iterator of byte chunks.

        Streams the response body incrementally for memory-efficient handling
        of large payloads (e.g. export data).

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: URL path relative to base_url.
            body: Optional JSON-serializable request body.
            params: Optional query parameters.

        Yields:
            Byte chunks from the response body.

        Raises:
            EngramError: On API errors.
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_stream {method} {path} [req={_request_id}]")

        try:
            kwargs: dict[str, Any] = {
                "headers": {"X-Request-ID": _request_id},
            }
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params

            async with self._http.stream(method, path, **kwargs) as response:
                if not response.is_success:
                    # Read the full body for error parsing
                    await response.aread()
                    try:
                        data = response.json()
                        parse_api_error(response.status_code, data)
                    except ValueError:
                        raise EngramError(
                            response.text or f"HTTP {response.status_code}",
                            code="HTTP_ERROR",
                            status_code=response.status_code,
                        )

                async for chunk in response.aiter_bytes():
                    yield chunk

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                async for chunk in self._request_stream(
                    method, path, body,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                ):
                    yield chunk
                return
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                async for chunk in self._request_stream(
                    method, path, body,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                ):
                    yield chunk
                return
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    async def _request_multipart(
        self,
        method: str,
        path: str,
        files: dict[str, tuple[str, bytes, str]],
        data: dict[str, str] | None = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> Any:
        """Send a multipart form data request.

        Sends files and form fields as a ``multipart/form-data`` request.
        Non-file form fields are sent as strings; callers must ``json.dumps()``
        any dict values before passing them as form data fields.

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (POST, PUT, etc.).
            path: URL path relative to base_url.
            files: Mapping of field name to ``(filename, content_bytes, content_type)``
                tuples for file uploads.
            data: Optional mapping of non-file form field names to string values.
            params: Optional query parameters.

        Returns:
            Parsed JSON response body, or ``None`` for 204 responses.

        Raises:
            EngramError: On API errors (parsed from the response body).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_multipart {method} {path} [req={_request_id}]")

        try:
            # Build the multipart payload: httpx expects files as a dict of
            # name -> (filename, content, content_type).
            httpx_files: dict[str, tuple[str, bytes, str]] = files

            # Headers — do NOT set Content-Type manually; httpx sets it with boundary.
            headers: dict[str, str] = {"X-Request-ID": _request_id}

            kwargs: dict[str, Any] = {
                "headers": headers,
                "files": httpx_files,
            }
            if data is not None:
                kwargs["data"] = data
            if params is not None:
                kwargs["params"] = params

            response = await self._http.request(method, path, **kwargs)

            if response.status_code == 204:
                return None

            resp_data = response.json()

            if not response.is_success:
                parse_api_error(response.status_code, resp_data)

            return resp_data

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request_multipart(
                    method, path, files, data,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import asyncio
                await asyncio.sleep(self._retry_delay * _attempt)
                return await self._request_multipart(
                    method, path, files, data,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    async def health(self) -> dict[str, Any]:
        """Check the health status of the Engram server."""
        return await self._request("GET", "/v1/health")

    async def health_ready(self) -> dict[str, Any]:
        """Check if the Engram server is ready to serve requests."""
        return await self._request("GET", "/health/ready")

    async def health_detailed(self) -> dict[str, Any]:
        """Get detailed health information including dependency status."""
        return await self._request("GET", "/health/detailed")

    async def check_server_compatibility(self) -> dict[str, Any]:
        """Check whether the connected server meets the minimum version floor.

        Calls ``/health`` and compares the returned ``version`` against
        :data:`MIN_SERVER_VERSION`. Mirrors ``EngramClient.checkCompatibility``
        in packages/sdk/src/client.ts.

        Returns:
            ``{"compatible": bool, "server_version": str, "min_required": str}``.
            ``compatible`` is ``False`` when the server omits its version or
            reports one below the floor (fails closed).
        """
        health = await self._request("GET", "/health")
        server_version = (health or {}).get("version") or "unknown"
        compatible = server_version != "unknown" and _is_version_gte(
            server_version, MIN_SERVER_VERSION
        )
        return {
            "compatible": compatible,
            "server_version": server_version,
            "min_required": MIN_SERVER_VERSION,
        }

    async def embed(self, text: str, module: Optional[str] = None) -> EmbeddingResponse:
        """Generate a single embedding for text."""
        body: dict[str, Any] = {"text": text}
        if module is not None:
            body["module"] = module
        response = await self._request("POST", "/v1/embeddings", body)
        return EmbeddingResponse.model_validate(response)

    async def embed_batch(
        self,
        texts: list[str],
        module: str = "search",
    ) -> BatchEmbeddingResponse:
        """Generate embeddings for multiple texts (up to 100)."""
        response = await self._request(
            "POST", "/v1/embeddings/batch", {"texts": texts, "module": module}
        )
        return BatchEmbeddingResponse.model_validate(response)

    async def embedding_info(self) -> EmbeddingInfoResponse:
        """Get embedding service info (availability, dimensions, cache stats)."""
        response = await self._request("GET", "/v1/embeddings/info")
        return EmbeddingInfoResponse.model_validate(response)


class EngramClient:
    """Sync client for the Engram Memory Server API.

    Usage:
        with EngramClient(base_url="http://localhost:3100") as client:
            session = client.sessions.create(
                CreateLocalSessionParams(project_path="/my/project")
            )
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        api_key: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
        allow_insecure: bool = False,
    ) -> None:
        """Initialize the sync Engram client.

        Args:
            base_url: Base URL of the Engram server. Defaults to ``http://localhost:3100``.
            api_key: Optional API key sent via the ``X-API-Key`` header.
            timeout: Request timeout in seconds. Defaults to 30.
            retries: Maximum number of retry attempts for retriable errors. Defaults to 3.
            retry_delay: Base delay in seconds between retries (multiplied by attempt number
                for linear backoff). Defaults to 1.0.
            allow_insecure: When ``False`` (default), sending an API key over plain HTTP
                to a non-localhost host raises :class:`ValueError`.  Set to ``True`` to
                downgrade to a warning.
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._retries = retries
        self._retry_delay = retry_delay

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["X-API-Key"] = api_key

        if api_key and urlsplit(self._base_url).scheme == "http":
            host = urlsplit(self._base_url).hostname or ""
            if host not in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
                msg = (
                    f"API key will be sent in cleartext over HTTP to {host}. "
                    "Use HTTPS for non-localhost connections or pass "
                    "allow_insecure=True to override."
                )
                if allow_insecure:
                    warnings.warn(msg, stacklevel=2)
                else:
                    raise ValueError(msg)

        self._http = httpx.Client(
            base_url=self._base_url,
            headers=headers,
            timeout=httpx.Timeout(timeout),
        )

        # Resource accessors
        self.sessions = SyncSessionsResource(self)
        self.notes = SyncNotesResource(self)
        self.edges = SyncEdgesResource(self)
        self.crystals = SyncCrystalsResource(self)
        self.session_links = SyncSessionLinksResource(self)
        self.terrafirma = SyncTerrafirmaResource(self)
        self.blobs = SyncBlobsResource(self)
        self.audit = SyncAuditResource(self)
        self.events = SyncEventsResource(self)
        self.export_import = SyncExportImportResource(self)
        self.entities = SyncEntitiesResource(self)
        self.extraction = SyncExtractionResource(self)
        self.maintenance = SyncMaintenanceResource(self)
        self.sync = SyncSyncResource(self)
        self.agents = SyncAgentsResource(self)
        self.ambient_context = SyncAmbientContextResource(self)
        self.facts = SyncFactsResource(self)
        self.gc = SyncGcResource(self)
        self.memory_spaces = SyncMemorySpacesResource(self)
        self.users = SyncUsersResource(self)
        self.shimmers = SyncShimmersResource(self)

    def __enter__(self) -> EngramClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP client and release resources."""
        self._http.close()

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(base_url={self._base_url!r}, api_key={'[REDACTED]' if self._api_key else None})"

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> Any:
        """Send an HTTP request with automatic retry on retriable errors.

        Retries on 5xx server errors and network-level failures (e.g. connection
        refused, DNS resolution errors) using linear backoff (``retry_delay * attempt``).
        Client errors (4xx) are never retried and are raised immediately.

        Raises:
            EngramError: On API errors (parsed from the response body).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries are exhausted.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request {method} {path} [req={_request_id}]")

        try:
            kwargs: dict[str, Any] = {
                "headers": {"X-Request-ID": _request_id},
            }
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params

            response = self._http.request(method, path, **kwargs)

            if response.status_code == 204:
                return None

            data = response.json()

            if not response.is_success:
                parse_api_error(response.status_code, data)

            return data

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request(method, path, body, params=params, _attempt=_attempt + 1, _request_id=_request_id)
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request(method, path, body, params=params, _attempt=_attempt + 1, _request_id=_request_id)
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    def _request_raw(
        self,
        method: str,
        path: str,
        content: bytes | None = None,
        content_type: str = "application/octet-stream",
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> httpx.Response:
        """Send an HTTP request with raw binary content.

        Sends raw bytes in the request body and returns the full ``httpx.Response``
        so callers can access ``.content`` (bytes) or ``.headers`` directly.

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (GET, POST, PUT, etc.).
            path: URL path relative to base_url.
            content: Raw bytes to send as the request body. ``None`` for GET requests.
            content_type: MIME type for the ``Content-Type`` header.
                Defaults to ``application/octet-stream``.
            params: Optional query parameters.

        Returns:
            The raw ``httpx.Response`` object.

        Raises:
            EngramError: On API errors (parsed from the response body when JSON).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_raw {method} {path} [req={_request_id}]")

        try:
            headers: dict[str, str] = {
                "X-Request-ID": _request_id,
                "Content-Type": content_type,
            }
            kwargs: dict[str, Any] = {"headers": headers}
            if content is not None:
                kwargs["content"] = content
            if params is not None:
                kwargs["params"] = params

            response = self._http.request(method, path, **kwargs)

            if not response.is_success:
                try:
                    data = response.json()
                    parse_api_error(response.status_code, data)
                except ValueError:
                    raise EngramError(
                        response.text or f"HTTP {response.status_code}",
                        code="HTTP_ERROR",
                        status_code=response.status_code,
                    )

            return response

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request_raw(
                    method, path, content, content_type,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request_raw(
                    method, path, content, content_type,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    def _request_stream(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> Iterator[bytes]:
        """Send an HTTP request and return an iterator of byte chunks.

        Streams the response body incrementally for memory-efficient handling
        of large payloads (e.g. export data).

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: URL path relative to base_url.
            body: Optional JSON-serializable request body.
            params: Optional query parameters.

        Yields:
            Byte chunks from the response body.

        Raises:
            EngramError: On API errors.
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_stream {method} {path} [req={_request_id}]")

        try:
            kwargs: dict[str, Any] = {
                "headers": {"X-Request-ID": _request_id},
            }
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params

            with self._http.stream(method, path, **kwargs) as response:
                if not response.is_success:
                    response.read()
                    try:
                        data = response.json()
                        parse_api_error(response.status_code, data)
                    except ValueError:
                        raise EngramError(
                            response.text or f"HTTP {response.status_code}",
                            code="HTTP_ERROR",
                            status_code=response.status_code,
                        )

                yield from response.iter_bytes()

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                yield from self._request_stream(
                    method, path, body,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
                return
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                yield from self._request_stream(
                    method, path, body,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
                return
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    def _request_multipart(
        self,
        method: str,
        path: str,
        files: dict[str, tuple[str, bytes, str]],
        data: dict[str, str] | None = None,
        *,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        _attempt: int = 1,
        _request_id: Optional[str] = None,
    ) -> Any:
        """Send a multipart form data request.

        Sends files and form fields as a ``multipart/form-data`` request.
        Non-file form fields are sent as strings; callers must ``json.dumps()``
        any dict values before passing them as form data fields.

        Uses the same retry and error handling logic as :meth:`_request`.

        Args:
            method: HTTP method (POST, PUT, etc.).
            path: URL path relative to base_url.
            files: Mapping of field name to ``(filename, content_bytes, content_type)``
                tuples for file uploads.
            data: Optional mapping of non-file form field names to string values.
            params: Optional query parameters.

        Returns:
            Parsed JSON response body, or ``None`` for 204 responses.

        Raises:
            EngramError: On API errors (parsed from the response body).
            EngramTimeoutError: When the request exceeds the configured timeout.
            NetworkError: On non-retriable network failures after all retries.
        """
        if _request_id is None:
            _request_id = uuid.uuid4().hex[:8]

        safe_path = _sanitize_path(path)
        logger.debug(f"request_multipart {method} {path} [req={_request_id}]")

        try:
            httpx_files: dict[str, tuple[str, bytes, str]] = files

            headers: dict[str, str] = {"X-Request-ID": _request_id}

            kwargs: dict[str, Any] = {
                "headers": headers,
                "files": httpx_files,
            }
            if data is not None:
                kwargs["data"] = data
            if params is not None:
                kwargs["params"] = params

            response = self._http.request(method, path, **kwargs)

            if response.status_code == 204:
                return None

            resp_data = response.json()

            if not response.is_success:
                parse_api_error(response.status_code, resp_data)

            return resp_data

        except EngramError as exc:
            if (
                isinstance(exc, EngramError)
                and exc.status_code is not None
                and exc.status_code >= 500
                and getattr(exc, "retryable", True)
                and _attempt < self._retries
            ):
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"status={exc.status_code}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request_multipart(
                    method, path, files, data,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{exc.code} [req={_request_id}]"
            )
            raise

        except httpx.TimeoutException:
            logger.warning(
                f"timeout {method} {safe_path} after {self._timeout}s "
                f"[req={_request_id}]"
            )
            raise EngramTimeoutError(self._timeout * 1000)

        except httpx.HTTPError as exc:
            if _attempt < self._retries:
                logger.warning(
                    f"retrying {method} {safe_path} "
                    f"(attempt {_attempt}/{self._retries}, "
                    f"error={type(exc).__name__}) [req={_request_id}]"
                )
                import time
                time.sleep(self._retry_delay * _attempt)
                return self._request_multipart(
                    method, path, files, data,
                    params=params, _attempt=_attempt + 1, _request_id=_request_id,
                )
            logger.error(
                f"giving up {method} {safe_path} after {_attempt} attempt(s): "
                f"{type(exc).__name__} [req={_request_id}]"
            )
            raise NetworkError(
                f"request failed: {method} {safe_path}",
                original_error=exc,
            )

    def health(self) -> dict[str, Any]:
        """Check the health status of the Engram server."""
        return self._request("GET", "/v1/health")

    def health_ready(self) -> dict[str, Any]:
        """Check if the Engram server is ready to serve requests."""
        return self._request("GET", "/health/ready")

    def health_detailed(self) -> dict[str, Any]:
        """Get detailed health information including dependency status."""
        return self._request("GET", "/health/detailed")

    def check_server_compatibility(self) -> dict[str, Any]:
        """Check whether the connected server meets the minimum version floor.

        Calls ``/health`` and compares the returned ``version`` against
        :data:`MIN_SERVER_VERSION`. Mirrors ``EngramClient.checkCompatibility``
        in packages/sdk/src/client.ts.

        Returns:
            ``{"compatible": bool, "server_version": str, "min_required": str}``.
            ``compatible`` is ``False`` when the server omits its version or
            reports one below the floor (fails closed).
        """
        health = self._request("GET", "/health")
        server_version = (health or {}).get("version") or "unknown"
        compatible = server_version != "unknown" and _is_version_gte(
            server_version, MIN_SERVER_VERSION
        )
        return {
            "compatible": compatible,
            "server_version": server_version,
            "min_required": MIN_SERVER_VERSION,
        }

    def embed(self, text: str, module: Optional[str] = None) -> EmbeddingResponse:
        """Generate a single embedding for text."""
        body: dict[str, Any] = {"text": text}
        if module is not None:
            body["module"] = module
        response = self._request("POST", "/v1/embeddings", body)
        return EmbeddingResponse.model_validate(response)

    def embed_batch(
        self,
        texts: list[str],
        module: str = "search",
    ) -> BatchEmbeddingResponse:
        """Generate embeddings for multiple texts (up to 100)."""
        response = self._request(
            "POST", "/v1/embeddings/batch", {"texts": texts, "module": module}
        )
        return BatchEmbeddingResponse.model_validate(response)

    def embedding_info(self) -> EmbeddingInfoResponse:
        """Get embedding service info (availability, dimensions, cache stats)."""
        response = self._request("GET", "/v1/embeddings/info")
        return EmbeddingInfoResponse.model_validate(response)


def create_engram_client(**overrides: Any) -> EngramClient:
    """Create a sync EngramClient from environment variables.

    Uses ENGRAM_URL (default: http://localhost:3100) and ENGRAM_API_KEY.
    """
    base_url = overrides.pop("base_url", None) or os.environ.get("ENGRAM_URL", DEFAULT_BASE_URL)
    api_key = overrides.pop("api_key", None) or os.environ.get("ENGRAM_API_KEY")
    return EngramClient(base_url=base_url, api_key=api_key, **overrides)


def create_async_engram_client(**overrides: Any) -> AsyncEngramClient:
    """Create an async AsyncEngramClient from environment variables.

    Uses ENGRAM_URL (default: http://localhost:3100) and ENGRAM_API_KEY.
    """
    base_url = overrides.pop("base_url", None) or os.environ.get("ENGRAM_URL", DEFAULT_BASE_URL)
    api_key = overrides.pop("api_key", None) or os.environ.get("ENGRAM_API_KEY")
    return AsyncEngramClient(base_url=base_url, api_key=api_key, **overrides)
