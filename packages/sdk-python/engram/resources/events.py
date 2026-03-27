"""Events resource for the Engram SDK (SSE streaming)."""
from __future__ import annotations

import json
import logging
import threading
from typing import Callable, Iterator, List, Optional, TYPE_CHECKING

import httpx

from engram.errors import EngramError, EngramTimeoutError, NetworkError
from engram.types.events import EngramEventType, EngramStreamEvent

if TYPE_CHECKING:
    from engram.client import AsyncEngramClient, EngramClient

logger = logging.getLogger("engram")

__all__ = [
    "EventSubscription",
    "EventsResource",
    "SyncEventsResource",
]


class EventSubscription:
    """Handle for a running SSE subscription.

    Call :meth:`close` to stop receiving events and release the connection.
    """

    def __init__(self) -> None:
        self._closed = False
        self._response: Optional[httpx.Response] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def closed(self) -> bool:
        """Whether the subscription has been closed."""
        return self._closed

    def close(self) -> None:
        """Close the subscription and release resources."""
        self._closed = True
        if self._response is not None:
            self._response.close()


def _parse_sse_line(line: str, buffer: dict) -> Optional[EngramStreamEvent]:
    """Parse a single SSE line, updating *buffer* and returning an event when complete.

    SSE protocol:
    - ``data: {...}`` — JSON payload (may span multiple ``data:`` lines)
    - ``event: <type>`` — event type hint (ignored; type comes from JSON payload)
    - ``id: <value>`` — event ID (ignored; ID comes from JSON payload)
    - ``:comment`` — comment, ignored
    - empty line — signals end of an event block
    """
    if line.startswith(":"):
        # Comment — ignore
        return None

    if line.startswith("data:"):
        payload = line[len("data:"):].strip()
        buffer.setdefault("data_lines", []).append(payload)
        return None

    if line.startswith("event:"):
        # Informational; we parse type from the JSON data
        return None

    if line.startswith("id:"):
        # Informational; we parse id from the JSON data
        return None

    # Empty line — flush the buffer and emit an event
    if line.strip() == "" and "data_lines" in buffer:
        raw = "\n".join(buffer.pop("data_lines"))
        buffer.clear()
        if not raw:
            return None
        try:
            obj = json.loads(raw)
            return EngramStreamEvent.model_validate(obj)
        except (json.JSONDecodeError, Exception) as exc:
            logger.warning(f"failed to parse SSE event: {exc}")
            return None

    return None


def _build_events_url(
    types: Optional[List[EngramEventType]],
) -> tuple[str, Optional[dict[str, str]]]:
    """Return (path, params) for the events endpoint."""
    path = "/v1/events"
    params: Optional[dict[str, str]] = None
    if types:
        params = {"types": ",".join(t.value for t in types)}
    return path, params


# ============================================================================
# Sync Events Resource
# ============================================================================


class SyncEventsResource:
    """Sync resource for consuming the Engram SSE event stream."""

    def __init__(self, client: EngramClient) -> None:
        self._client = client

    def subscribe(
        self,
        types: Optional[List[EngramEventType]] = None,
        on_event: Optional[Callable[[EngramStreamEvent], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> EventSubscription:
        """Subscribe to server-sent events in a background thread.

        Args:
            types: Optional list of event types to filter on. When ``None``,
                all event types are received.
            on_event: Callback invoked for each received event.
            on_error: Callback invoked when a connection error occurs.

        Returns:
            An :class:`EventSubscription` whose :meth:`~EventSubscription.close`
            method stops the stream.
        """
        if on_event is None:
            raise ValueError("on_event callback is required for subscribe()")

        subscription = EventSubscription()
        path, params = _build_events_url(types)

        def _run() -> None:
            try:
                url = f"{self._client._base_url}{path}"
                headers: dict[str, str] = {"Accept": "text/event-stream"}
                if self._client._api_key:
                    headers["X-API-Key"] = self._client._api_key

                with httpx.Client(timeout=None) as http:
                    with http.stream(
                        "GET", url, headers=headers, params=params
                    ) as response:
                        subscription._response = response

                        if not response.is_success:
                            response.read()
                            err = EngramError(
                                response.text or f"HTTP {response.status_code}",
                                code="HTTP_ERROR",
                                status_code=response.status_code,
                            )
                            if on_error:
                                on_error(err)
                            return

                        buffer: dict = {}
                        for line in response.iter_lines():
                            if subscription._closed:
                                return
                            event = _parse_sse_line(line, buffer)
                            if event is not None:
                                on_event(event)

            except Exception as exc:
                if not subscription._closed:
                    if on_error:
                        on_error(exc)

        thread = threading.Thread(target=_run, daemon=True)
        subscription._thread = thread
        thread.start()
        return subscription

    def subscribe_iter(
        self,
        types: Optional[List[EngramEventType]] = None,
    ) -> Iterator[EngramStreamEvent]:
        """Subscribe to server-sent events as a blocking iterator.

        This is the recommended Pythonic approach::

            for event in client.events.subscribe_iter(
                types=[EngramEventType.CRYSTAL_CREATED]
            ):
                print(event.summary)

        Args:
            types: Optional list of event types to filter on.

        Yields:
            :class:`~engram.types.events.EngramStreamEvent` instances.
        """
        path, params = _build_events_url(types)
        url = f"{self._client._base_url}{path}"
        headers: dict[str, str] = {"Accept": "text/event-stream"}
        if self._client._api_key:
            headers["X-API-Key"] = self._client._api_key

        with httpx.Client(timeout=None) as http:
            with http.stream(
                "GET", url, headers=headers, params=params
            ) as response:
                if not response.is_success:
                    response.read()
                    raise EngramError(
                        response.text or f"HTTP {response.status_code}",
                        code="HTTP_ERROR",
                        status_code=response.status_code,
                    )

                buffer: dict = {}
                for line in response.iter_lines():
                    event = _parse_sse_line(line, buffer)
                    if event is not None:
                        yield event


# ============================================================================
# Async Events Resource
# ============================================================================


class EventsResource:
    """Async resource for consuming the Engram SSE event stream."""

    def __init__(self, client: AsyncEngramClient) -> None:
        self._client = client

    async def subscribe(
        self,
        types: Optional[List[EngramEventType]] = None,
        on_event: Optional[Callable[[EngramStreamEvent], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> EventSubscription:
        """Subscribe to server-sent events.

        Consumes the SSE stream, calling *on_event* for each parsed event.
        The stream is consumed in the current asyncio task; wrap in
        ``asyncio.create_task()`` if you need concurrent processing.

        Args:
            types: Optional list of event types to filter on. When ``None``,
                all event types are received.
            on_event: Callback invoked for each received event.
            on_error: Callback invoked when a connection error occurs.

        Returns:
            An :class:`EventSubscription` whose :meth:`~EventSubscription.close`
            method stops the stream.
        """
        if on_event is None:
            raise ValueError("on_event callback is required for subscribe()")

        subscription = EventSubscription()
        path, params = _build_events_url(types)

        try:
            url = f"{self._client._base_url}{path}"
            headers: dict[str, str] = {"Accept": "text/event-stream"}
            if self._client._api_key:
                headers["X-API-Key"] = self._client._api_key

            async with httpx.AsyncClient(timeout=None) as http:
                async with http.stream(
                    "GET", url, headers=headers, params=params
                ) as response:
                    subscription._response = response

                    if not response.is_success:
                        await response.aread()
                        err = EngramError(
                            response.text or f"HTTP {response.status_code}",
                            code="HTTP_ERROR",
                            status_code=response.status_code,
                        )
                        if on_error:
                            on_error(err)
                        return subscription

                    buffer: dict = {}
                    async for line in response.aiter_lines():
                        if subscription._closed:
                            return subscription
                        event = _parse_sse_line(line, buffer)
                        if event is not None:
                            on_event(event)

        except Exception as exc:
            if not subscription._closed:
                if on_error:
                    on_error(exc)

        return subscription

    async def subscribe_iter(
        self,
        types: Optional[List[EngramEventType]] = None,
    ):
        """Subscribe to server-sent events as an async iterator.

        This is the recommended Pythonic approach::

            async for event in client.events.subscribe_iter(
                types=[EngramEventType.CRYSTAL_CREATED]
            ):
                print(event.summary)

        Args:
            types: Optional list of event types to filter on.

        Yields:
            :class:`~engram.types.events.EngramStreamEvent` instances.
        """
        path, params = _build_events_url(types)
        url = f"{self._client._base_url}{path}"
        headers: dict[str, str] = {"Accept": "text/event-stream"}
        if self._client._api_key:
            headers["X-API-Key"] = self._client._api_key

        async with httpx.AsyncClient(timeout=None) as http:
            async with http.stream(
                "GET", url, headers=headers, params=params
            ) as response:
                if not response.is_success:
                    await response.aread()
                    raise EngramError(
                        response.text or f"HTTP {response.status_code}",
                        code="HTTP_ERROR",
                        status_code=response.status_code,
                    )

                buffer: dict = {}
                async for line in response.aiter_lines():
                    event = _parse_sse_line(line, buffer)
                    if event is not None:
                        yield event
