"""Error hierarchy for the Engram Python SDK."""
from __future__ import annotations

import warnings
from typing import Any, NoReturn, Optional


class EngramError(Exception):
    """Base error for all Engram SDK errors."""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN",
        status_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class NotFoundError(EngramError):
    """Resource not found (404)."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, code="NOT_FOUND", status_code=404)


class SessionExistsError(EngramError):
    """Session already exists (409)."""

    def __init__(self, message: str = "Session already exists") -> None:
        super().__init__(message, code="SESSION_EXISTS", status_code=409)


class CrystalVersionConflictError(EngramError):
    """Optimistic-concurrency (CAS) update conflict on a crystal (409).

    Raised when a ``crystals.update(...)`` call passes ``expected_version`` and
    the crystal's current server-side ``version`` does not match. The server
    responds with HTTP 409 + error code ``OPERATION_VERSION_CONFLICT`` and
    includes the current version in the error details (engram-server#60).

    The server-reported :attr:`current_version` is exposed so callers can
    re-fetch, merge, and retry without a second round trip::

        from engram.errors import CrystalVersionConflictError

        try:
            client.crystals.update(
                crystal_id,
                UpdateKnowledgeCrystalParams(title="...", expected_version=local.version),
            )
        except CrystalVersionConflictError as err:
            fresh = client.crystals.get(crystal_id)
            # merge local edits onto ``fresh``, then retry with
            # expected_version=err.current_version

    Mirrors the TypeScript SDK's ``CrystalVersionConflictError``
    (``packages/sdk/src/errors.ts``).
    """

    def __init__(
        self,
        message: str = "Crystal version conflict",
        current_version: Optional[int] = None,
        details: Optional[Any] = None,
    ) -> None:
        super().__init__(
            message, code="OPERATION_VERSION_CONFLICT", status_code=409
        )
        self.current_version = current_version
        self.details = details


class ValidationError(EngramError):
    """Request validation failed (400)."""

    def __init__(
        self,
        message: str = "Validation failed",
        issues: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        super().__init__(message, code="VALIDATION_ERROR", status_code=400)
        self.issues = issues or []


class UnauthorizedError(EngramError):
    """Authentication failed (401)."""

    def __init__(self, message: str = "Unauthorized - invalid or missing API key") -> None:
        super().__init__(message, code="UNAUTHORIZED", status_code=401)


class NetworkError(EngramError):
    """Network request failed."""

    def __init__(self, message: str, original_error: Optional[Exception] = None) -> None:
        super().__init__(message, code="NETWORK_ERROR")
        self.original_error = original_error


class EngramTimeoutError(EngramError):
    """Request timed out."""

    def __init__(self, timeout_ms: float) -> None:
        super().__init__(f"Request timed out after {timeout_ms}ms", code="TIMEOUT")
        self.timeout_ms = timeout_ms


# Deprecated: use EngramTimeoutError to avoid shadowing the builtin TimeoutError.
# Accessing ``engram.errors.TimeoutError`` or ``from engram.errors import TimeoutError``
# triggers a DeprecationWarning so callers can migrate.
def __getattr__(name: str) -> type:
    if name == "TimeoutError":
        warnings.warn(
            "engram.errors.TimeoutError is deprecated and shadows the Python "
            "builtin. Use engram.errors.EngramTimeoutError instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return EngramTimeoutError
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


class InternalError(EngramError):
    """Internal server error (500)."""

    def __init__(self, message: str = "Internal server error") -> None:
        super().__init__(message, code="INTERNAL_ERROR", status_code=500)


def _extract_current_version(body: Any, error_obj: Any) -> Optional[int]:
    """Pull the server-reported ``currentVersion`` from a CAS-conflict body.

    The 409 conflict body (engram-server#60) carries the current version. It may
    live at the top level (``{ currentVersion }``) or nested under the error
    object's ``details`` (``{ error: { details: { currentVersion } } }``).
    Returns ``None`` if absent so the error still surfaces, just without the hint.

    Crystal versions are monotonic non-negative integers, so a negative value
    is a malformed server response — treat it as absent (return ``None``) rather
    than handing back a nonsensical "current version" a retry would build on.
    """
    candidates: list[Any] = []
    if isinstance(error_obj, dict):
        candidates.append(error_obj.get("currentVersion"))
        details = error_obj.get("details")
        if isinstance(details, dict):
            candidates.append(details.get("currentVersion"))
    if isinstance(body, dict):
        candidates.append(body.get("currentVersion"))
        details = body.get("details")
        if isinstance(details, dict):
            candidates.append(details.get("currentVersion"))
    for value in candidates:
        # ``bool`` is an ``int`` subclass — exclude it so ``True``/``False`` from
        # a malformed body never masquerade as version 1/0.
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return None


def parse_api_error(status_code: int, body: Any) -> NoReturn:
    """Parse an API error response and raise the appropriate error."""
    # Shape 1 - Zod validation failure: { success: false, error: { name: "ZodError", issues: [...] } }
    # Returned by the API when request body fails Zod schema validation.
    if isinstance(body, dict) and body.get("success") is False and "error" in body:
        error_obj = body["error"]
        if isinstance(error_obj, dict) and error_obj.get("name") == "ZodError":
            issues = error_obj.get("issues", [])
            message = "; ".join(
                f"{'.'.join(i.get('path', []))}: {i.get('message', '')}"
                for i in issues
            )
            raise ValidationError(message, issues=issues)

    # Shape 2 - Nested error envelope: { error: { code, message, details? } }
    # Returned by route-level error handlers; may include Zod issues inside details.
    if isinstance(body, dict) and "error" in body:
        error_obj = body["error"]
        if isinstance(error_obj, dict) and "code" in error_obj and "message" in error_obj:
            message = error_obj["message"]
            # Route CAS mismatch to the typed error before the generic 409
            # handling, so callers can catch CrystalVersionConflictError
            # specifically (mirrors packages/sdk/src/errors.ts:201).
            if status_code == 409 and error_obj["code"] == "OPERATION_VERSION_CONFLICT":
                raise CrystalVersionConflictError(
                    message,
                    current_version=_extract_current_version(body, error_obj),
                    details=body,
                )
            details = error_obj.get("details")
            if isinstance(details, dict) and "issues" in details:
                issues = details["issues"]
                if isinstance(issues, list) and issues:
                    message = "; ".join(
                        f"{'.'.join(i.get('path', []))}: {i.get('message', '')}"
                        for i in issues
                    )
            raise EngramError(message, code=error_obj["code"], status_code=status_code)

    # Shape 3 - Flat error object: { code, message }
    # Returned by middleware and standard API error responses (404, 401, 409, 500, etc.).
    if isinstance(body, dict) and "code" in body and "message" in body:
        message = body["message"]
        if status_code == 401:
            raise UnauthorizedError(message)
        if status_code == 404:
            raise NotFoundError(message)
        if status_code == 409:
            # CAS mismatch is also a 409 — route it to the typed error before
            # the SessionExistsError fallback so the two 409 cases stay distinct.
            if body["code"] == "OPERATION_VERSION_CONFLICT":
                raise CrystalVersionConflictError(
                    message,
                    current_version=_extract_current_version(body, None),
                    details=body,
                )
            raise SessionExistsError(message)
        if status_code == 500:
            raise InternalError(message)
        raise EngramError(message, code=body["code"], status_code=status_code)

    # Fallback
    raise EngramError(
        body if isinstance(body, str) else "Unknown error",
        code="INTERNAL_ERROR",
        status_code=status_code,
    )
