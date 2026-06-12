# Public Packages Plan — centient-sdk monorepo

- **Date:** 2026-06-12
- **Source:** `docs/plans/2026-06-12-centralization-candidates.md` (23-repo sweep) + workspace decisions recorded in its §0.
- **Scope:** the six PUBLIC additions to this monorepo and the one export-surface change. Private-package work is tracked elsewhere: new private repos via a workspace-repo issue; daemon/test-kit upstreams via issues on those repos.
- **Monorepo impact:** 5 → 11 published `@centient/*` packages. Each new package inherits the existing gates (make check, claudemd-check, changesets, mbot review) — no new infrastructure.

## Ground rules

1. **One package per PR wave** — scaffold + seeded implementation + tests + README + changeset. No batch-landing six packages.
2. **Zero runtime dependencies** for every package in this plan (the sdk's existing convention). Anything needing a dep is mis-scoped — split or reject.
3. **Crucible harvest precedes archival.** Four sources live in crucible (breaker, cli-utils, the DAG original + tests, git-ops for the private track). Copy the source files + tests into a `harvest/` staging area in the relevant target (or land the package directly) before the repo is archived. Until harvested, crucible's archival is blocked on this plan.
4. **CLAUDE.md package table** gains a row per package in the same PR that creates it (claudemd-check enforces the version column; the resource-count guard is sdk-only).
5. Each package lands with its first consumer migration PR queued in the consuming repo, so nothing ships speculative.

## Order of execution

### 1. `@centient/resilience` (first — unblocks the sdk retry-policy upstream ask)

Circuit breaker, token-bucket rate limiter, backoff-with-jitter, LRU/TTL/SWR caches, bounded-concurrency pool.

- **Seed:** `platform/centient` `utils/CircuitBreaker.ts` (403) / `RateLimiter.ts` (508) / `CacheManager.ts` (355); breaker reference implementation is **crucible's clock-injected pure breaker** `crucible/packages/crucible/src/state/circuit-breaker.ts` (340) — HARVEST.
- **Day-one consumers:** `@centient/sdk` (backoff primitive replaces `backoffDelay` internals; enables the configurable retry policy + exported `isRetryableError` that centient/mbot/test-kit hand-rolled around), engram-server, pipeline-sdk, test-kit, membrane, engram-test-harness.
- **Acceptance:** clock injection throughout (no `Date.now()` in logic paths); property tests for backoff bounds mirroring the sdk's jitter tests; breaker state-machine tests ported from crucible.

### 2. `@centient/config-loader`

Layered resolution (env > project file > user file > defaults) with caching, warnings, write-back; `~/.{app}` path helpers (0o700); walk-up-to-marker root discovery. Schemas stay in consumers.

- **Seed:** centient `utils/config.ts` (1,485); fold in touchstone `store/discovery.ts` root resolution (136) and soma's validate-at-edge env readers (`runtime/settings.ts`).
- **Day-one consumers:** centient, engram-server (deletes ~1,192-line `utils/config.ts`), soma. finance/fileum Python copies become the port spec if Python Tier-1 ports happen.

### 3. `@centient/path-security`

Allowed-roots traversal validation + path-component sanitizer, Result-typed API.

- **Seed:** centient `utils/pathValidation.ts` (311) + `path-guards.ts` (98); cross-check crucible `sanitize-path.ts` (147) and soma `git/sanitize.ts` (143), keep strictest behavior per check.
- **Day-one consumers:** centient, soma. The home-dir/username *redaction* half of centient `sanitize.ts` goes to `@centient/logger`'s sanitize instead (adopt-table row).
- **Acceptance:** adversarial test vectors (encoded traversal, symlink-adjacent names, UNC/Windows forms) — this is the package where the public-eyes argument is strongest.

### 4. `@centient/cli-utils`

Terminal capability detection (NO_COLOR/FORCE_COLOR/TERM precedence), ANSI color helpers, semver-lite (parse/compare/satisfies).

- **Seed:** `support/cli` `lib/colors.ts` (84, with tests); **crucible `cli-utils.ts`** — HARVEST (the confirmed two-copy duplication); semver from soma `persona/src/semver/{parse,filter}.ts` (228).
- **Day-one consumers:** support/cli, centient (its `semver.ts` header says it already consolidated 4 in-repo copies), mbot, soma.

### 5. `@centient/dag`

Generic DAG scheduling core: adjacency, cycle detection, topo-sort, wave computation, failure cascade over `DAGNode<TId>`. Standalone package (not an orchestrator subpath) to keep the zero-dep property.

- **Seed:** pipeline-sdk `packages/orchestrator/src/dag.ts` (463, header: "100% generic — extracted as-is from crucible") + `failure-classifier.ts` (75); **harvest crucible's original + its test suite** for behavioral cross-checks.
- **Day-one consumers:** pipeline-sdk; future daemon/membrane wave scheduling.

### 6. `@centient/proc`

Hardened subprocess runner: execFile/spawn with timeouts, SIGKILL races, buffer caps, settle-once semantics, stdin streaming, unified error normalization.

- **Seed:** membrane `DockerCLI.ts:81-245,332-404` (~300 generic lines) with injectable binary/impl.
- **Day-one consumers:** membrane (DockerCLI re-based — behavioral no-op, assert via its existing suite), test-kit container manager, soma-test-harness runner, daemon spawn helpers.

### 7. Atomic fs exports on `@centient/wal` (surface change, not a new package)

Export `atomicWrite` / `atomicAppendLine` (fsync option, PIPE_BUF documentation) from wal, which already implements tmp-then-rename internally.

- **Seed/cross-check:** crucible `utils/atomic-io.ts` (73) and pipeline-sdk `state.ts` `atomicWrite` (45, adds fsync).
- **Day-one consumers:** pipeline-sdk (crucible row dropped — retirement). Minor changeset.

## Crucible harvest checklist (blocking its archival)

| Source in crucible | Destination |
|---|---|
| `packages/crucible/src/state/circuit-breaker.ts` + tests | `@centient/resilience` |
| `packages/crucible/src/utils/cli-utils.ts` (or current path) + tests | `@centient/cli-utils` |
| original DAG implementation + test suite | `@centient/dag` (cross-check vs pipeline-sdk copy) |
| `src/orchestrator/git-ops.ts` (516) | private `git-ops` (workspace issue — not this repo) |
| `packages/crucible/src/utils/atomic-io.ts` | `@centient/wal` exports cross-check |

## Out of scope here

- New private packages (`git-ops`, `llm-cost`, `credential-pool`, `crystal-kit`) — workspace repo issue.
- daemon / test-kit upstream additions — issues on those repos.
- Adopt-table migrations in consumer repos — tracked per-repo as each package lands.
