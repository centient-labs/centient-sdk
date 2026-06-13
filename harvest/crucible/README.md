# Crucible Harvest — Archival-Safety Staging

These are **archival-safety copies** of source modules harvested from the
`crucible` repository ahead of its archival (operator decision, recorded in
`docs/plans/2026-06-12-centralization-candidates.md` section 0).

**These files are NOT wired into any build, test, lint, or turbo/tsconfig scope.**
They sit at the repo root under `harvest/`, outside the `packages/*` pnpm
workspace glob, so `make check` ignores them entirely. They exist only so the
code survives crucible's archival in a versioned location.

**The live ports happen in the destination package PRs** — not here. Each
destination package owns the work of adapting these modules (ESM exports,
zero-dependency rewrites, clock/randomness injection, `@centient` scaffold
conventions, changesets, CLAUDE.md table rows). This staging is the safety net,
not the port.

## Provenance

All copies taken **verbatim** (byte-for-byte; verified with `cmp`) from crucible
at commit `d2dbf92c8f1c3ba128e7faccc4e5458677dcec40`, copy date **2026-06-12**.

Crucible source root for the paths below:
`/Users/owenjohnson/centient-labs/platform/crucible`

| Source path @ crucible `d2dbf92` | Copy date | Destination package | Why harvested |
|---|---|---|---|
| `packages/crucible/src/state/circuit-breaker.ts` | 2026-06-12 | `@centient/resilience` | Pure CLOSED→OPEN→HALF_OPEN state machine (ADR-036). Reusable resilience primitive for any tiered persistence/fallback chain — no crucible-specific coupling. |
| `packages/crucible/tests/state/circuit-breaker.test.ts` | 2026-06-12 | `@centient/resilience` | Full test suite for the circuit-breaker state machine. |
| `packages/crucible/src/cli-utils.ts` | 2026-06-12 | `@centient/cli-utils` | Shared CLI helpers (`writeError` structured stderr, `detectTerminalCapabilities` for FORCE_COLOR/NO_COLOR/TERM=dumb — ADR-004 D4/D5). Generic terminal/CLI utility, no crucible domain logic. |
| `packages/crucible/tests/cli-utils.test.ts` | 2026-06-12 | `@centient/cli-utils` | Full test suite for the CLI utilities. |
| `packages/crucible/src/orchestrator/dag.ts` | 2026-06-12 | `@centient/dag` | Original DAG engine: cycle detection (DFS white/gray/black), topological sort (Kahn's algorithm), wave calculation, ready-queue resolution (ADR-021 D1/D10). Pure computation, no I/O. |
| `packages/crucible/tests/orchestrator/dag.test.ts` | 2026-06-12 | `@centient/dag` | Full DAG-engine test suite. |
| `packages/crucible/src/orchestrator/dag-renderer.ts` | 2026-06-12 | `@centient/dag` | Companion DAG presentation module (wave/graph rendering). Harvested alongside the engine so the DAG module surface survives intact. |
| `packages/crucible/tests/orchestrator/dag-renderer.test.ts` | 2026-06-12 | `@centient/dag` | Full DAG-renderer test suite. |
| `packages/crucible/src/utils/atomic-io.ts` | 2026-06-12 | `@centient/wal` (atomic-io) | `atomicWrite` (UUID `.tmp` sibling + rename-over) and `atomicAppendLine` (single-syscall POSIX append ≤ PIPE_BUF). Crash-safe file I/O primitive — companion to the WAL package. |
| `packages/crucible/tests/utils/atomic-io.test.ts` | 2026-06-12 | `@centient/wal` (atomic-io) | Full test suite for the atomic-io primitives. |

## Companion type dependencies (resolved during the live port, not copied here)

`dag.ts` imports `validateDAGDefinition` and DAG types from
`packages/crucible/src/orchestrator/types.ts` (a barrel re-exporting
`types/pipeline-state-model.ts`, `types/failure-model.ts`, etc., where
`DAGDefinition` and `validateDAGDefinition` are actually defined). Those type
modules are deliberately **not** copied — they are a broad orchestrator type
tree, not part of "the DAG implementation." The `@centient/dag` port will
re-declare or vendor the minimal `DAGDefinition` / validation surface it needs.
The crucible commit hash above pins the exact source for that work.

`git-ops.ts` (the fourth harvest target from this sweep) is a **private** target
and is staged in the `centient-labs/workspace` repo, not here — see workspace
PR `harvest/crucible-git-ops` and workspace issue #85.

## Destination subdirs in this staging

| Subdir | Destination package |
|---|---|
| `resilience/` | `@centient/resilience` |
| `cli-utils/` | `@centient/cli-utils` |
| `dag/` | `@centient/dag` |
| `wal-atomic/` | `@centient/wal` (atomic-io module) |
