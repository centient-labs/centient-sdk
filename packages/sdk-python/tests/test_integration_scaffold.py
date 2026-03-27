"""Integration smoke tests — requires a live engram server.

Set ENGRAM_TEST_URL to the server URL to run these tests.
Example: ENGRAM_TEST_URL=http://localhost:3100 pytest tests/test_integration_scaffold.py

These tests are excluded from CI. They are run locally by developers
with a live server. See CI configuration for --ignore flag.
"""
from __future__ import annotations

import os
import pytest

from engram.client import EngramClient
from engram.types.sessions import CreateLocalSessionParams, CreateLocalNoteParams
from engram.types.knowledge_crystal import CreateKnowledgeCrystalParams

ENGRAM_URL = os.environ.get("ENGRAM_TEST_URL")


@pytest.mark.integration
def test_health_check():
    """Verify the server is reachable via GET /health."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        result = client.health()
        assert result is not None
    finally:
        client.close()


@pytest.mark.integration
def test_health_ready():
    """Verify the server reports ready via GET /health/ready."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        result = client.health_ready()
        assert result is not None
    finally:
        client.close()


@pytest.mark.integration
def test_session_create_and_get():
    """Create a session and retrieve it by ID."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    session_id = None
    try:
        session = client.sessions.create(
            CreateLocalSessionParams(project_path="/integration-test")
        )
        session_id = session.id
        assert session_id is not None

        fetched = client.sessions.get(session_id)
        assert fetched.id == session_id
        assert fetched.project_path == "/integration-test"
    finally:
        if session_id is not None:
            try:
                client.sessions.delete(session_id)
            except Exception:
                pass
        client.close()


@pytest.mark.integration
def test_session_list():
    """List sessions and verify the response is iterable."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        result = client.sessions.list()
        assert result is not None
        assert hasattr(result, "data") or isinstance(result, (list, dict))
    finally:
        client.close()


@pytest.mark.integration
def test_note_create_in_session():
    """Create a note inside a session."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    session_id = None
    try:
        session = client.sessions.create(
            CreateLocalSessionParams(project_path="/integration-test-notes")
        )
        session_id = session.id

        note = client.sessions.notes(session_id).create(
            CreateLocalNoteParams(content="Integration test note")
        )
        assert note is not None
        assert note.id is not None
    finally:
        if session_id is not None:
            try:
                client.sessions.delete(session_id)
            except Exception:
                pass
        client.close()


@pytest.mark.integration
def test_note_list_in_session():
    """Create a session with a note and list the notes."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    session_id = None
    try:
        session = client.sessions.create(
            CreateLocalSessionParams(project_path="/integration-test-note-list")
        )
        session_id = session.id

        client.sessions.notes(session_id).create(
            CreateLocalNoteParams(content="Note for listing test")
        )

        notes = client.sessions.notes(session_id).list()
        assert notes is not None
        data = notes.data if hasattr(notes, "data") else notes
        assert len(data) >= 1
    finally:
        if session_id is not None:
            try:
                client.sessions.delete(session_id)
            except Exception:
                pass
        client.close()


@pytest.mark.integration
def test_crystal_list():
    """List crystals and verify a paginated response is returned."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        result = client.crystals.list()
        assert result is not None
        assert hasattr(result, "data") or isinstance(result, (list, dict))
    finally:
        client.close()


@pytest.mark.integration
def test_crystal_create_and_get():
    """Create a knowledge crystal and retrieve it by ID."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    crystal_id = None
    try:
        crystal = client.crystals.create(
            CreateKnowledgeCrystalParams(
                node_type="note",
                title="Integration Test Crystal",
                summary="Created by integration smoke test",
            )
        )
        crystal_id = crystal.id
        assert crystal_id is not None
        assert crystal.title == "Integration Test Crystal"

        fetched = client.crystals.get(crystal_id)
        assert fetched.id == crystal_id
        assert fetched.title == "Integration Test Crystal"
    finally:
        if crystal_id is not None:
            try:
                client.crystals.delete(crystal_id)
            except Exception:
                pass
        client.close()


@pytest.mark.integration
def test_crystal_delete():
    """Create a crystal and verify it can be deleted."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        crystal = client.crystals.create(
            CreateKnowledgeCrystalParams(
                node_type="note",
                title="Integration Delete Test Crystal",
            )
        )
        crystal_id = crystal.id
        assert crystal_id is not None

        # Delete should not raise
        client.crystals.delete(crystal_id)
    finally:
        client.close()


@pytest.mark.integration
def test_session_delete():
    """Create a session and verify it can be deleted."""
    if not ENGRAM_URL:
        pytest.skip("ENGRAM_TEST_URL not set")
    client = EngramClient(base_url=ENGRAM_URL)
    try:
        session = client.sessions.create(
            CreateLocalSessionParams(project_path="/integration-test-delete")
        )
        session_id = session.id
        assert session_id is not None

        # Delete should not raise
        client.sessions.delete(session_id)
    finally:
        client.close()
