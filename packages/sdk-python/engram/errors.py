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
