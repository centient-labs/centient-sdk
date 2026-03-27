# engram-py

[![PyPI version](https://img.shields.io/pypi/v/engram-py.svg)](https://pypi.org/project/engram-py/)
[![Python versions](https://img.shields.io/pypi/pyversions/engram-py.svg)](https://pypi.org/project/engram-py/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Python SDK for Engram Memory Server (v1.0.0 Stable). Provides both async and sync clients with full type coverage via Pydantic v2 models.

> **Unified Type Model:** Knowledge items and crystals use a single
> `KnowledgeCrystal` type backed by the `knowledge_crystals` table. The old
> deprecated types (`KnowledgeItem`, `Crystal`, `KnowledgeEdge`,
> `CreateKnowledgeParams`, `CreateCrystalParams`) have been removed.
> Use the unified types from `engram.types.knowledge_crystal`.

## Installation

```bash
pip install engram-py
```

## Quick Start

### Sync Client

```python
from engram import (
    create_engram_client,
    CreateLocalSessionParams,
    CreateLocalNoteParams,
    SearchLocalNotesParams,
    CreateKnowledgeCrystalParams,
)

client = create_engram_client()  # reads ENGRAM_URL and ENGRAM_API_KEY from env

# Sessions
session = client.sessions.create(CreateLocalSessionParams(
    project_path="/my/project",
    metadata={"tool": "claude-code"},
))

# Notes within a session
note = client.sessions.notes(session.id).create(CreateLocalNoteParams(
    type="observation",
    content="Found a bug in the auth module",
))

# Search notes
results = client.sessions.notes(session.id).search(SearchLocalNotesParams(
    query="auth bug",
    limit=5,
))

# Knowledge crystals (unified type)
item = client.crystals.create(CreateKnowledgeCrystalParams(
    node_type="learning",
    title="Auth module pattern",
    content_inline="Always validate tokens server-side",
    tags=["auth", "security"],
))

# Container crystal (also a KnowledgeCrystal with a container node_type)
crystal = client.crystals.create(CreateKnowledgeCrystalParams(
    node_type="collection",
    title="project-summary",
    description="Key learnings from the project",
))

client.close()
```

### Async Client

```python
import asyncio
from engram import create_async_engram_client, CreateLocalSessionParams

async def main():
    client = create_async_engram_client()

    session = await client.sessions.create(CreateLocalSessionParams(
        project_path="/my/project",
    ))

    sessions = await client.sessions.list()
    print(f"Active sessions: {len(sessions)}")

    await client.close()

asyncio.run(main())
```

Every method shown in this README has an identical async counterpart on
`AsyncEngramClient`. Prefix calls with `await` and use `async with` for
context managers.

### Context Manager

```python
from engram import EngramClient

with EngramClient(base_url="http://localhost:3100") as client:
    sessions = client.sessions.list()
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAM_URL` | `http://localhost:3100` | Engram server URL |
| `ENGRAM_API_KEY` | (none) | Optional API key |

## Migration Guide: v0.x → v1.0

This guide covers breaking changes when upgrading from v0.x to v1.0.0.

### Unified Crystal Type

In v0.17.0–v0.18.0, the separate `KnowledgeItem`/`Crystal` types were merged into
a single `KnowledgeCrystal` type. The old types have been removed in v1.0.0.

**Before (v0.16.x and earlier):**
```python
from engram.types import KnowledgeItem, Crystal

# KnowledgeItem had a 'type' field
item = client.knowledge.create(CreateKnowledgeParams(
    type="learning",
    name="Auth Pattern",
))

# Crystal had separate create API
crystal = client.crystals.create(CreateCrystalParams(
    name="My Crystal",
))
```

**After (v1.0.0):**
```python
from engram.types.knowledge_crystal import KnowledgeCrystal, CreateKnowledgeCrystalParams

# Unified type — use node_type instead of type, title instead of name
item = client.crystals.create(CreateKnowledgeCrystalParams(
    node_type="learning",
    title="Auth Pattern",
))
```

### Field Renames

| Old Field | New Field | Affected Types |
|-----------|-----------|----------------|
| `type` | `node_type` | `KnowledgeCrystal`, `CreateKnowledgeCrystalParams` |
| `name` | `title` | `KnowledgeCrystal`, `CreateKnowledgeCrystalParams` |
| `crystalType` | `node_type` | All crystal-related types |

### Removed Types

The following types were removed in v1.0.0. Use `KnowledgeCrystal` and `KnowledgeCrystalEdge` instead:

- `KnowledgeItem` → `KnowledgeCrystal`
- `Crystal` → `KnowledgeCrystal` (with `node_type="collection"`)
- `KnowledgeEdge` → `KnowledgeCrystalEdge`
- `CreateKnowledgeParams` → `CreateKnowledgeCrystalParams`
- `CreateCrystalParams` → `CreateKnowledgeCrystalParams`

### Import Path Changes

```python
# Before
from engram.types import KnowledgeItem, KnowledgeEdge

# After
from engram.types.knowledge_crystal import KnowledgeCrystal, KnowledgeCrystalEdge
# Or via the top-level package (if re-exported):
from engram import KnowledgeCrystal
```

## Stability & Guarantees

### Semantic Versioning

`engram-py` follows [Semantic Versioning](https://semver.org/) strictly from v1.0.0 onwards:

- **MAJOR** bump (e.g., 1.x → 2.0): breaking API changes
- **MINOR** bump (e.g., 1.0 → 1.1): new features, backward compatible
- **PATCH** bump (e.g., 1.0.0 → 1.0.1): bug fixes only

No breaking changes will be introduced without a major version bump after v1.0.0.

### Supported Python Versions

| Python Version | Support Status |
|----------------|----------------|
| 3.9 | ✅ Supported |
| 3.10 | ✅ Supported |
| 3.11 | ✅ Supported |
| 3.12 | ✅ Supported |
| 3.8 and below | ❌ Not supported |

### API Stability Scope

The following public APIs are covered by the stability guarantee:

- `EngramClient` — all public methods and resource accessors
- `AsyncEngramClient` — all public methods and resource accessors
- All types in `engram.types.*` — public fields and constructors
- All error types in `engram.errors` — class hierarchy and attributes
- `create_engram_client()` and `create_async_engram_client()` factory functions

Internal APIs (prefixed with `_`) are not covered and may change at any time.

## Performance Tips: Sync vs Async

### When to Use Each Client

Use `AsyncEngramClient` when:
- Your application is already async (FastAPI, aiohttp, asyncio-based agent frameworks)
- You need to make multiple concurrent requests (use `asyncio.gather`)
- You are building high-throughput pipelines where latency matters

Use `EngramClient` when:
- Your application is synchronous (scripts, Django views, CLI tools)
- Simplicity is preferred over throughput
- You are prototyping or writing tests

### Batch Operations with asyncio.gather

```python
import asyncio
from engram import create_async_engram_client

async def fetch_multiple_sessions(session_ids: list[str]):
    async with create_async_engram_client() as client:
        sessions = await asyncio.gather(
            *[client.sessions.get(sid) for sid in session_ids]
        )
    return sessions
```

### Timeout Configuration

```python
from engram import create_engram_client

# Set a custom timeout (seconds)
client = create_engram_client(timeout=10.0)

# Or use httpx.Timeout for granular control
import httpx
# Pass via the base client constructor
client = EngramClient(base_url="http://localhost:3100", timeout=5.0)
```

### Retry Configuration

By default the client retries up to 3 times on 5xx errors and network failures,
with a 1-second delay between attempts:

```python
client = EngramClient(
    retries=3,        # number of retry attempts (default: 3)
    retry_delay=1.0,  # seconds between retries (default: 1.0)
)
```

Set `retries=0` to disable retries entirely.

## Framework Integrations

The `examples/` directory contains ready-to-use integration patterns for popular
agent frameworks:

### LangChain Memory Backend

[`examples/langchain_memory.py`](examples/langchain_memory.py) — Custom `BaseMemory`
adapter that uses Engram session notes as a persistent conversation memory backend.

```python
from examples.langchain_memory import EngramMemory
from engram import create_engram_client

client = create_engram_client()
memory = EngramMemory(client=client, project_path="/my-project")

# Store a conversation turn
memory.save_context(
    inputs={"input": "What is the capital of France?"},
    outputs={"output": "Paris."}
)

# Load history
history = memory.load_memory_variables({})
print(history["history"])
```

### CrewAI Shared Memory

[`examples/crewai_shared_memory.py`](examples/crewai_shared_memory.py) — Shared memory
pool that enables multiple CrewAI agents to read from and write to the same Engram session.

```python
from examples.crewai_shared_memory import EngramSharedMemory
from engram import create_engram_client

client = create_engram_client()
shared_memory = EngramSharedMemory(client=client)

# Each agent gets a scoped view of the shared pool
researcher = shared_memory.for_agent("researcher")
writer = shared_memory.for_agent("writer")

researcher.store("finding", "Quantum entanglement enables faster-than-light signaling — FALSE")
writer.store("note", "Do not reference quantum teleportation claims without citation")

# Any agent can read everything
all_memories = shared_memory.retrieve_all()
```

### AutoGen Memory Plugin

[`examples/autogen_memory.py`](examples/autogen_memory.py) — Memory plugin for AutoGen
agents that stores and retrieves memories across sessions using Engram.

```python
from examples.autogen_memory import EngramMemoryPlugin
from engram import create_engram_client

client = create_engram_client()
plugin = EngramMemoryPlugin(client=client, agent_name="assistant")

# Store a memory
plugin.add("User prefers concise, bullet-point answers")

# Log a message exchange
plugin.log_message(role="user", content="Summarize our discussion")
plugin.log_message(role="assistant", content="Key points: ...")

# Retrieve relevant memories
relevant = plugin.get_relevant("user preferences", limit=5)
```

## Configuration

Both client classes accept the following parameters:

```python
from engram import EngramClient

client = EngramClient(
    base_url="http://localhost:3100",  # Engram server URL
    api_key="your-api-key",           # Optional API key
    timeout=30.0,                     # Request timeout in seconds
    retries=3,                        # Max retry attempts for 5xx/network errors
    retry_delay=1.0,                  # Base delay between retries (linear backoff)
)
```

Retries use linear backoff: the delay before attempt N is `retry_delay * N` seconds.
Only 5xx server errors and network failures are retried; 4xx client errors are raised immediately.

## More Usage Examples

### Session Scratch

```python
from engram import CreateScratchParams

scratch = client.sessions.scratch(session.id).create(CreateScratchParams(
    type="hypothesis",
    content="The auth module may need refactoring",
))
```

### Session Finalization

```python
from engram import FinalizeSessionOptions

result = client.sessions.finalize(session.id, FinalizeSessionOptions(
    crystal_name="session-learnings",
    tags=["auth", "refactor"],
))
print(f"Promoted {result.promoted_items} items into crystal {result.crystal.id}")
```

### Session Constraints

```python
from engram import CreateConstraintParams

constraint = client.sessions.constraints(session.id).create(CreateConstraintParams(
    content="Do not modify the public API surface",
    scope="session",
))
```

### Session Links

```python
from engram import CreateSessionLinkParams

link = client.session_links.create(CreateSessionLinkParams(
    source_session_id=new_session.id,
    target_session_id=previous_session.id,
    relationship="builds_on",
))
```

### Crystal Hierarchy

```python
from engram import AddChildCrystalParams

edge = client.crystals.hierarchy(parent_crystal.id).add_child(
    AddChildCrystalParams(child_id=child_crystal.id)
)
children = client.crystals.hierarchy(parent_crystal.id).get_children()
```

### Health Checks

```python
# Basic health check
health = client.health()
print(f"Status: {health}")

# Readiness probe (is the server ready to serve requests?)
ready = client.health_ready()

# Detailed health with component status
detailed = client.health_detailed()
```

Health methods return plain dictionaries. They are available directly on the
client, not on a resource object.

### Embeddings

```python
# Single text embedding
result = client.embed("Search query text")
print(f"Dimensions: {result.dimensions}, Model: {result.model}")

# Batch embedding (up to 100 texts)
batch = client.embed_batch(["text one", "text two", "text three"])
print(f"Embeddings: {batch.count}")

# Embedding model info
info = client.embedding_info()
print(f"Model: {info.model}, Dimensions: {info.dimensions}")
```

Like health checks, embedding methods live directly on the client. The `embed`
method accepts an optional `module` parameter (one of `"session"`, `"patterns"`,
`"memory-bank"`, `"search"`, `"retrieval"`).

### Terrafirma (Filesystem Sync)

```python
from engram import StartMigrationOptions, TriggerSyncOptions

# Get sync status overview
status = client.terrafirma.get_status()
print(f"Mode: {status.mode}")
print(f"Watcher: {status.watcher.status}, Reconciler: {status.reconciler.status}")
print(f"Synced files: {status.sync.synced} / {status.sync.total}")

# Check detailed sync state for a specific file
file_info = client.terrafirma.get_file_info("/path/to/file.md")
if file_info is not None:
    print(f"Status: {file_info.sync_status}, Version: {file_info.version}")

# Get current migration status
migration = client.terrafirma.get_migration_status()
print(f"Migration: {migration.status}, Progress: {migration.files_processed}/{migration.files_total}")

# Start a dry-run migration
result = client.terrafirma.start_migration(StartMigrationOptions(
    dry_run=True,
))

# Trigger a manual sync cycle
sync = client.terrafirma.trigger_sync(TriggerSyncOptions(
    dry_run=False,
    scope="errors",
))
```

`get_file_info` returns `None` when no bridge row exists for the path (404).

### Blobs

```python
# Upload binary data
response = client.blobs.upload(
    content=b"binary content here",
    mime_type="application/octet-stream",
)
print(f"Blob ID: {response.id}, Size: {response.size_bytes} bytes")

# Download blob content
data = client.blobs.download(response.id)

# Get metadata
metadata = client.blobs.get_metadata(response.id)
if metadata is not None:
    print(f"MIME type: {metadata.mime_type}, References: {metadata.reference_count}")

# Add a reference (increment reference count)
ref = client.blobs.add_reference(response.id)

# Delete a blob (decrement reference count)
client.blobs.delete(response.id)

# Run garbage collection to remove unreferenced blobs
gc_result = client.blobs.gc()
print(f"Cleaned: {gc_result.deleted} blobs")
```

`get_metadata` returns `None` when the blob is not found (404).

### Audit Events

```python
from engram import AuditIngestParams, AuditListParams, AuditPruneParams

# Ingest a single audit event
result = client.audit.ingest(AuditIngestParams(
    level="info",
    component="my-app",
    message="Session created",
    event_type="session_start",
    outcome="success",
    session_id=session.id,
))
print(f"Accepted: {result.accepted}")

# List events with filters
events = client.audit.list_events(AuditListParams(
    event_type="session_start",
    limit=10,
))
for event in events.data:
    print(f"{event.timestamp}: {event.message}")

# Get a single event by ID
event = client.audit.get_event(events.data[0].id)

# Get aggregate statistics
stats = client.audit.get_stats()
print(f"Total events: {stats.total}")

# Force flush the event buffer
client.audit.flush()

# Prune old events
pruned = client.audit.prune(AuditPruneParams(older_than_days=90))
print(f"Pruned: {pruned.deleted} events")
```

Audit ingest is asynchronous (HTTP 202). Events are buffered and flushed
periodically. Use `flush()` to force an immediate flush.

### Export/Import

```python
from engram import ExportParams, ImportOptions

# Export data as a byte stream
chunks = client.export_import.export_data(ExportParams(
    scopes=["knowledge", "crystals"],
    format="ndjson",
))
export_bytes = b"".join(chunks)

# Estimate export size before exporting
estimate = client.export_import.estimate_export(ExportParams(
    scopes=["knowledge", "crystals"],
    format="ndjson",
))
print(f"Estimated size: {estimate.estimated_size_bytes} bytes")
print(f"Total entities: {estimate.total_entities}")

# Import data from bytes
result = client.export_import.import_data(
    file=export_bytes,
    filename="backup.ndjson",
    content_type="application/x-ndjson",
    options=ImportOptions(on_conflict="newer"),
)
print(f"Success: {result.success}, Duration: {result.duration}s")
for entity_type, counts in result.counts.items():
    print(f"  {entity_type}: {counts.inserted} inserted, {counts.updated} updated")

# Preview an import without applying changes
preview = client.export_import.preview_import(
    file=export_bytes,
    filename="backup.ndjson",
    content_type="application/x-ndjson",
)
print(f"Preview success: {preview.success}")
if preview.counts:
    for entity_type, counts in preview.counts.items():
        print(f"  {entity_type}: {counts.new} new, {counts.updated} updated")
```

`export_data` returns an iterator of byte chunks (or an async iterator for the
async client). Collect them with `b"".join(chunks)` or write them to a file
incrementally.

### Crystal Advanced Operations

```python
from engram import BulkAddParams, ReorderParams, GrantPermissionParams, ForkCrystalParams

# Bulk add items to a crystal
result = client.crystals.bulk_add(crystal_id, BulkAddParams(item_ids=["id1", "id2", "id3"]))
print(f"Added: {result}")

# Reorder items within a crystal
client.crystals.reorder(crystal_id, ReorderParams(item_ids=["id2", "id1", "id3"]))

# Get the access control list
acl = client.crystals.get_acl(crystal_id)
for entry in acl:
    print(f"  {entry.grantee_id} ({entry.grantee_type}): {entry.permission}")

# Grant permission on a crystal
entry = client.crystals.grant_permission(crystal_id, GrantPermissionParams(
    grantee_type="user",
    grantee_id="user-456",
    permission="read",
))

# Revoke permission
from engram import RevokePermissionParams
client.crystals.revoke_permission(crystal_id, RevokePermissionParams(
    grantee_type="user",
    grantee_id="user-456",
    permission="read",
))

# Create a share link
from engram import CreateShareLinkParams
link = client.crystals.create_share_link(crystal_id, CreateShareLinkParams(
    permission="read",
))
print(f"Share URL token: {link.token}")

# Fork a crystal
forked = client.crystals.fork(crystal_id, ForkCrystalParams(
    new_owner_ids=["user-456"],
))
print(f"Forked crystal ID: {forked.id}")

# Generate or regenerate embedding for a crystal
client.crystals.generate_embedding(crystal_id)
```

### Note Lifecycle

```python
from engram import LifecycleStatus

# Update a note's lifecycle status
updated_note = client.notes.update_lifecycle(note_id, LifecycleStatus.FINALIZED)
print(f"Note lifecycle updated")

# Available lifecycle statuses:
#   LifecycleStatus.DRAFT
#   LifecycleStatus.ACTIVE
#   LifecycleStatus.FINALIZED
#   LifecycleStatus.ARCHIVED
#   LifecycleStatus.SUPERSEDED
```

### Session Lifecycle Stats

```python
# Get aggregate note counts by lifecycle status for a session
stats = client.sessions.get_lifecycle_stats(session.id)
print(f"Draft: {stats.draft}, Active: {stats.active}, Finalized: {stats.finalized}")
print(f"Archived: {stats.archived}, Superseded: {stats.superseded}")
```

## Resources

The SDK provides resource-based access to all Engram APIs:

| Resource | Access | Description |
|----------|--------|-------------|
| Sessions | `client.sessions` | Session lifecycle management |
| Session Notes | `client.sessions.notes(id)` | Notes scoped to a session |
| Session Scratch | `client.sessions.scratch(id)` | Scratch content within sessions |
| Notes (global) | `client.notes` | Global note operations, lifecycle updates |
| Edges | `client.edges` | Knowledge crystal edges |
| Crystals | `client.crystals` | Crystal CRUD, search, bulk ops, ACL, sharing, forking |
| Crystal Items | `client.crystals.items(id)` | Items within a crystal |
| Crystal Versions | `client.crystals.versions(id)` | Crystal version history |
| Crystal Hierarchy | `client.crystals.hierarchy(id)` | Parent/child crystal trees |
| Session Links | `client.session_links` | Links between sessions |
| Session Constraints | `client.sessions.constraints(id)` | Constraints within sessions |
| Session Decisions | `client.sessions.decision_points(id)` | Decision points |
| Session Branches | `client.sessions.branches(id)` | Exploration branches |
| Session Note Edges | `client.sessions.note_edges(id)` | Edges between notes |
| Stuck Detections | `client.sessions.stuck_detections(id)` | Stuck pattern detection |
| Terrafirma | `client.terrafirma` | Filesystem sync status, migrations, manual sync |
| Blobs | `client.blobs` | Binary blob upload, download, metadata, GC |
| Audit | `client.audit` | Audit event ingestion, querying, stats, pruning |
| Export/Import | `client.export_import` | Data export (streaming), import (multipart), preview |
| Health | `client.health()` / `client.health_ready()` / `client.health_detailed()` | Server health checks |
| Embeddings | `client.embed()` / `client.embed_batch()` / `client.embedding_info()` | Text embedding generation |

## Unified Types

Knowledge items and crystals use a single `KnowledgeCrystal` type (ADR-055).
All operations go through `client.crystals`.

### Import Path

```python
from engram.types.knowledge_crystal import (
    KnowledgeCrystal,
    KnowledgeCrystalEdge,
    CreateKnowledgeCrystalParams,
    UpdateKnowledgeCrystalParams,
    NodeType,
    NodeVisibility,
)
```

All unified types are also re-exported from `engram.types` and from the
top-level `engram` package, so `from engram import KnowledgeCrystal` works.

## Error Handling

All API errors are raised as typed exceptions:

```python
from engram import EngramClient, NotFoundError, ValidationError

client = EngramClient()

try:
    session = client.sessions.get("nonexistent-id")
except NotFoundError as e:
    print(f"Not found: {e.message}")
except ValidationError as e:
    print(f"Invalid input: {e.issues}")
```

| Exception | HTTP Status | Description |
|-----------|-------------|-------------|
| `NotFoundError` | 404 | Resource not found |
| `SessionExistsError` | 409 | Session already exists |
| `ValidationError` | 400 | Invalid request parameters |
| `UnauthorizedError` | 401 | Missing or invalid API key |
| `NetworkError` | - | Connection failure |
| `TimeoutError` | - | Request timed out |
| `InternalError` | 500 | Server error |

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v
```

## Requirements

- Python >= 3.9
- httpx >= 0.27.0
- pydantic >= 2.1.0
