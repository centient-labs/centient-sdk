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

> **These files are intentionally incomplete and do NOT compile or run as-is.**
> They are byte-for-byte archival copies (see *Provenance* below), deliberately
> kept verbatim so the `cmp`-verified provenance guarantee holds. Several modules
> reference companion files that were **not** harvested (the broad orchestrator
> type tree, `formatters.ts`), and the harvested test files import from their
> **original crucible relative paths** (`../../src/...`) that do not exist under
> `harvest/`. None of this is a defect: these copies are for reference and
> archival survival only. Every unresolved reference is enumerated in
> *Companion dependencies (not harvested)* below, and is resolved during the
> live port in the destination-package PR — not in this staging area. Because
> nothing here is in any build/test/lint/turbo/tsconfig scope, these dangling
> imports never reach `make check`.

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

## Companion dependencies (not harvested) — resolved during the live port

This section is the exhaustive list of references in the harvested files that do
**not** resolve within `harvest/`. Each is deliberate; the crucible commit hash
in *Provenance* pins the exact upstream source for the live port to consume.

**Source-module imports (`src/`):**

- `dag/dag.ts` imports `validateDAGDefinition` and the DAG types from
  `./types.js` → originally `packages/crucible/src/orchestrator/types.ts` (a
  barrel re-exporting `types/pipeline-state-model.ts`, `types/failure-model.ts`,
  etc., where `DAGDefinition` and `validateDAGDefinition` are defined). That
  broad orchestrator type tree is **not** part of "the DAG implementation," so
  it is deliberately not copied. The `@centient/dag` port re-declares or vendors
  the minimal `DAGDefinition` / validation surface it needs.
- `dag/dag-renderer.ts` imports `PipelineStatus` from `./types.js` (same type
  tree as above) and `statusBadge`, `truncate` from `./formatters.js`
  (originally `packages/crucible/src/orchestrator/formatters.ts`, a small
  presentation-helper module). Neither is harvested; the `@centient/dag` port
  vendors or re-implements the two helper functions the renderer uses.

**Test-file imports:** the harvested `*.test.ts` files are kept **verbatim** and
therefore still import from their original crucible tree layout
(`../../src/orchestrator/dag.js`, `../../src/state/circuit-breaker.js`,
`../../src/utils/atomic-io.js`, `../src/cli-utils.js`, etc.). Those relative
paths do not exist under `harvest/`, so the tests **will not run here** — they
are included for reference and to preserve the full test surface. The
destination-package PR re-points these imports at the ported module locations
and adds them to that package's test scope. They are intentionally outside every
`make check` scope here.

`git-ops.ts` (the fourth harvest target from this sweep) is a **private** target
and is staged in the `centient-labs/workspace` repo, not here — see workspace
PR `harvest/crucible-git-ops` and workspace issue #85.

## Destination subdirs in this staging

The destination packages below are **planned, not yet created**. Each is a named
extraction candidate in
`docs/plans/2026-06-12-centralization-candidates.md` (the same sweep that
authorized this harvest, section 0); the plan section is cited per row. The
`@centient/wal` package already exists (see the CLAUDE.md packages table) and
gains atomic-io as a new module. The other three (`@centient/resilience`,
`@centient/cli-utils`, `@centient/dag`) do not appear in the CLAUDE.md packages
table yet **by design** — they are created in their respective live-port PRs,
which add their CLAUDE.md table rows at that time. Their absence from CLAUDE.md
today is expected for archival-staging, not a discrepancy.

| Subdir | Destination package | Plan section | Status |
|---|---|---|---|
| `resilience/` | `@centient/resilience` | §2.1 | planned (not yet created) |
| `cli-utils/` | `@centient/cli-utils` | §2.10 | planned (not yet created) |
| `dag/` | `@centient/dag` | §2.11 | planned (not yet created) |
| `wal-atomic/` | `@centient/wal` (atomic-io module) | §2.12 | package exists; module to be added |
