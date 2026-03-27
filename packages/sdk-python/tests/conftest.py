"""Shared test fixtures for the Engram Python SDK."""
from __future__ import annotations

from typing import Any

import httpx
import pytest


def make_api_response(data: Any, total: int | None = None, has_more: bool = False) -> dict:
    """Build a standard API response envelope."""
    resp: dict[str, Any] = {"data": data}
    if total is not None:
        resp["meta"] = {
            "pagination": {
                "total": total,
                "limit": 20,
                "offset": 0,
                "hasMore": has_more,
            }
        }
    return resp


def make_httpx_response(
    status_code: int = 200,
    json_data: Any = None,
    method: str = "GET",
    url: str = "http://test",
) -> httpx.Response:
    """Create a mock httpx.Response."""
    response = httpx.Response(
        status_code=status_code,
        json=json_data,
        request=httpx.Request(method, url),
    )
    return response


# Sample data factories
SAMPLE_SESSION = {
    "id": "sess-123",
    "externalId": None,
    "projectPath": "/test/project",
    "status": "active",
    "startedAt": "2026-01-01T00:00:00Z",
    "endedAt": None,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_NOTE = {
    "id": "note-456",
    "sessionId": "sess-123",
    "type": "decision",
    "content": "Use PostgreSQL",
    "embeddingStatus": "pending",
    "embeddingUpdatedAt": None,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_KNOWLEDGE_CRYSTAL = {
    "id": "kc-789",
    "slug": None,
    "nodeType": "pattern",
    "title": "Auth Pattern",
    "summary": "JWT-based auth",
    "description": None,
    "tags": ["auth", "security"],
    "contentRef": {"type": "inline"},
    "contentInline": "Use JWT tokens",
    "embeddingStatus": "pending",
    "embeddingUpdatedAt": None,
    "confidence": 0.9,
    "verified": True,
    "visibility": "private",
    "license": None,
    "ownerIds": [],
    "version": 1,
    "forkCount": 0,
    "starCount": 0,
    "itemCount": 0,
    "versionCount": 1,
    "parentId": None,
    "parentVersion": None,
    "sourceType": "manual",
    "sourceSessionId": None,
    "sourceProject": "test-project",
    "typeMetadata": {},
    "path": None,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}
# Backward compat alias
SAMPLE_KNOWLEDGE_ITEM = SAMPLE_KNOWLEDGE_CRYSTAL

SAMPLE_EDGE = {
    "id": "edge-101",
    "sourceId": "kc-789",
    "targetId": "kc-790",
    "relationship": "related_to",
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "createdBy": None,
}

SAMPLE_EDGE_WITH_AUTHOR = {
    **SAMPLE_EDGE,
    "createdBy": "agent-1",
}

SAMPLE_CRYSTAL = {
    "id": "crystal-201",
    "slug": "test-crystal",
    "nodeType": "collection",
    "title": "Test Crystal",
    "summary": None,
    "description": "A test crystal",
    "tags": ["test"],
    "contentRef": None,
    "contentInline": None,
    "embeddingStatus": "pending",
    "embeddingUpdatedAt": None,
    "confidence": None,
    "verified": False,
    "visibility": "private",
    "license": None,
    "ownerIds": ["user-1"],
    "version": 1,
    "forkCount": 0,
    "starCount": 0,
    "itemCount": 0,
    "versionCount": 1,
    "parentId": None,
    "parentVersion": None,
    "sourceType": None,
    "sourceSessionId": None,
    "sourceProject": None,
    "typeMetadata": {},
    "path": None,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_SESSION_LINK = {
    "id": "sl-1",
    "sourceSessionId": "sess-123",
    "targetSessionId": "sess-456",
    "relationship": "builds_on",
    "evidence": "continued work",
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_CONSTRAINT = {
    "id": "con-1",
    "sessionId": "sess-123",
    "content": "No console.log",
    "keywords": ["console"],
    "scope": "session",
    "active": True,
    "detectedFrom": "explicit",
    "liftedAt": None,
    "liftReason": None,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_DECISION_POINT = {
    "id": "dp-1",
    "sessionId": "sess-123",
    "description": "Choose DB",
    "category": "architecture",
    "alternatives": ["postgres", "mysql"],
    "rationale": None,
    "surpriseScore": 0.5,
    "resolved": False,
    "resolvedAt": None,
    "chosenBranchId": None,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_BRANCH = {
    "id": "branch-1",
    "sessionId": "sess-123",
    "decisionPointId": "dp-1",
    "label": "Try Postgres",
    "status": "active",
    "reasonExplored": "Popular choice",
    "closedReason": None,
    "insights": [],
    "adoptedFully": False,
    "closedAt": None,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_NOTE_EDGE = {
    "id": "ne-1",
    "sessionId": "sess-123",
    "sourceNoteId": "note-456",
    "targetNoteId": "note-789",
    "relationship": "related_to",
    "evidence": "linked notes",
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
}

SAMPLE_STUCK_DETECTION = {
    "id": "stuck-1",
    "sessionId": "sess-123",
    "patternType": "repeated_blocker",
    "confidence": 0.85,
    "description": "Same error repeated",
    "evidence": ["error 1", "error 2"],
    "resolved": False,
    "resolvedAt": None,
    "resolutionNotes": None,
    "cooldownUntil": "2026-01-01T01:00:00Z",
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

SAMPLE_SCRATCH = {
    "id": "sc-1",
    "sessionId": "sess-123",
    "type": "observation",
    "content": "test scratch",
    "suggestedType": "learning",
    "promotionScore": 0.8,
    "metadata": {},
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}
