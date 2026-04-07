# engram-sdk

Quick reference for Claude. See `.agent/` for detailed documentation.

## Critical Rules

1. Never commit secrets - use .env files
2. Never push directly to main
3. Never execute cloud CLIs without permission
4. Always run tests before committing
5. Always read existing code before modifying
6. Never bump versions manually - use Changesets

## Design Philosophy

See `.agent/DESIGN-PHILOSOPHY.md` for the 14 principles (3 tiers) that guide all decisions. Key convictions: root cause over bandaid, no silent degradation, transparent evolution, observable architecture.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `@centient/sdk` | 1.3.0 | TypeScript SDK for Engram Memory Server REST API. 13 resource classes, 95+ types. Factory: `createEngramClient()` |
| `@centient/logger` | 0.16.0 | Structured logging with transport abstraction. 6 levels, Console/File/Null transports, audit events, data redaction. Factory: `createLogger()`, `createAuditWriter()` |
| `@centient/wal` | 0.2.0 | Write-ahead log for crash recovery. `appendEntry`, `confirmEntry`, `replayUnconfirmed`, `compactWal` |
| `sdk-python` | - | Python SDK client with Pydantic v2 (async + sync) |

## Tech Stack

- TypeScript 5.3 (strict mode, ES2022, NodeNext modules, ESM-only)
- pnpm 10.28.0 workspaces
- Turbo 2.8.20 for build orchestration
- Vitest 4.0.17 with @vitest/coverage-v8
- Changesets for semantic versioning
- Node >= 20.0.0
- GitHub Actions CI (build/test on PR) + release (changesets publish)
- MIT license, published under `@centient` npm scope

## Key Patterns

- **Resource-based API:** Each Engram concept (Sessions, Crystals, Entities) = Resource class
- **Factory functions:** `createEngramClient()`, `createLogger()`, `createAuditWriter()`
- **Child loggers** with inherited context
- **Transport abstraction** (pluggable output destinations)
- **WAL as primitive** for crash recovery
- **Result type pattern** (`ok`/`error`)
- **ESM-only** throughout

## Documentation

- `.agent/DESIGN-PHILOSOPHY.md` - Design principles and tension resolution
- `.agent/STANDARDS.md` - Code standards
- `.agent/constraints/security.md` - Security rules
- `.agent/constraints/observability.md` - Logging, audit, cost tracking
- `.agent/procedures/commits.md` - Commit workflow and changesets
- `.agent/patterns/error-handling.md` - Error handling patterns
- `.agent/patterns/api-design.md` - API design patterns
- `docs/adr/` - Architecture decisions

## Git Commit Rules

- See `.agent/procedures/commits.md` for full commit workflow.

## Session & Knowledge Management

This project participates in the centient knowledge management system. When `mcp__centient__*` tools are available, **always initialize a session at the start of every conversation** and use knowledge tools throughout:

1. **Always start a session** — Call `start_session_coordination` with `sessionId` (format: `YYYY-MM-DD-topic`) and `projectPath` before doing any work
2. **Search first** — Call `search_crystals` with your task topic to find prior work and decisions
3. **Check duplicates** — Call `check_duplicate_work` before implementing non-trivial changes
4. **Save knowledge** — Call `save_session_note` for important decisions, findings, and blockers
5. **End** — Call `finalize_session_coordination` to persist session artifacts

See `.agent/procedures/session-management.md` for tool parameters and additional tools.
## Common Commands

```bash
pnpm install          # install all workspace deps
pnpm build            # turbo run build (all packages)
pnpm test             # turbo run test
pnpm lint             # turbo run lint
pnpm clean            # turbo run clean

# Per-package:
cd packages/sdk && npm test
cd packages/logger && npm test
cd packages/wal && npm test

# Changesets:
pnpm changeset            # add a changeset
pnpm changeset version    # bump versions from changesets
```

## Configuration

Environment variables in `.env` (copy from `.env.example`).
