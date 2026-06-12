# Centralization Candidates — centient-labs Workspace

**Date:** 2026-06-12
**Scope:** 23 repos swept, read-only (19 analyzed; 4 skipped: `private-packages/persona-sdk` (greenfield), `products/officemanager` (docs only), `support/crucible-test-harness` (synthetic output), `support/toolkit` (markdown plugin)).
**Method:** One sweep agent per repo produced a JSON report classifying candidates as `duplicates-existing-package`, `shared-utility`, or `extractable-subsystem`, each with file-level evidence and LOC estimates. This document cross-references those reports: a capability hand-rolled in 2+ repos is an extraction candidate; a hand-rolled duplicate of an existing `@centient`/`@centient-labs` package is a migration (adoption) task, not an extraction. Every claim below traces to an evidence path from a sweep report.

---

## 1. Adopt, don't extract

Places hand-rolling something an existing package already does. Several rows require a small upstream feature first — the sweep evidence documents the exact gap.

| Capability | Repos hand-rolling it | Duplicates | Key evidence | Effort |
|---|---|---|---|---|
| Eval harness (store/metrics/gates) | crucible | `@centient-labs/touchstone` | `crucible/packages/touchstone/src/store/run-store.ts`, `store/discovery.ts`, `metrics/baselines.ts` — file-for-file match with private touchstone layout; 23 import sites in crucible src | **L** — migrate crucible onto the private package (supply stage taxonomy via `TouchstoneConfig`); deletes ~4,400 LOC |
| Persona SDK (resolve/compose/promote) | soma | `@centient-labs/persona-sdk` | `soma/packages/persona/src/sdk/{resolve,compose,promote,createVersion,bootstrap}.ts` (~3,508 LOC) vs persona-sdk README charter | **L** — soma's implementation is the more complete one; decide direction (promote soma's into persona-sdk, or migrate soma onto it). Includes `orchestration/src/persona-store/engram-adapter.ts` (268 LOC) |
| Daemon lifecycle / PID & state files | centient, engram-server | `@centient-labs/daemon` | `centient/.../EngramLocalManager.ts` (708) + `InstanceRegistry.ts` (339); `engram/src/daemon/lifecycle.ts` + `control-files.ts` (520) — engram already calls `createDaemon`/`addLifecycleCommands`, both impls run side by side; centient's `update.ts:155` names daemon as canonical but doesn't depend on it | **L** (centient), **M** (engram-server). Upstream engram's hardened `O_NOFOLLOW`/byte-capped readers first, then delete local modules |
| Docker invocation | centient, crucible, mbot | `@centient-labs/membrane` | `centient/.../DockerSandbox.ts` (497) + rlvr per-language sandboxes; `crucible/src/container.ts` (440, while `orchestrator/runner.ts` already wraps membrane per ADR-021 D3); `mbot/src/docker.ts` (82) vs membrane `DockerCLI.isAvailable()` | **M** (centient), **S** (crucible, mbot) |
| HTTP retry policy | centient, mbot, test-kit | `@centient/sdk` | `centient/.../EngramClientManager.ts:135-300` (connection-class-only, method-aware retry — module says SDK retry is too coarse); `mbot/src/state/engram-retry.ts` (265, exists because SDK won't retry timeouts, classifies SDK errors by message-substring); `test-kit/src/http/retry.ts` + two more backoffs in `health/` and `ws/client.ts` — none with jitter | **M** — upstream a configurable retry policy (timeout opt-in, attempts/base/max/jitter) and exported `isRetryableError` into `@centient/sdk` first; then S per consumer |
| Exhaustive list pagination | crucible, pipeline-sdk | `@centient/sdk` | `crucible/packages/crucible/src/utils/paginated-list.ts` (79, fixes 50-result silent truncation per ADR-054 D4); `pipeline-sdk/packages/pipeline/src/util/paginated-list.ts` (66) | **S** — add `listAll()`/async-iterator helper to SDK resources, delete both |
| REST domain clients | engram-server (engram-web) | `@centient/sdk` | `apps/engram-web/src/api/{acl,agents,audit,facts,memory-spaces,merge,session-coordination,trash,users}-client.ts` (~1,500 LOC) running parallel to an SDK singleton in `api/client.ts` | **L** — add/align missing SDK resources, delete the `api/` layer |
| Logger shims & transports | mbot, membrane, pipeline-sdk, engram-server, daemon | `@centient/logger` | `mbot/src/types/logger.ts` (61, threaded through ~250 files); `membrane/src/logger.ts` (234 — logger is already a transitive dep per ADR-003); `pipeline-sdk/.../types/config.ts:17-36` (stderr-only for MCP); `engram/src/logger.ts` CompositeTransport (190); `daemon/src/lifecycle.ts:126-187` rotation (60) | **S–M** — upstream multi-transport fan-out, an MCP/stderr transport option, and an exported rotation utility; then each shim shrinks to config |
| Secret-redaction key lists | engram-server (×2), membrane, finance | `@centient/logger` (sanitize) | `engram/src/utils/redact.ts` vs `engram-web/src/utils/auditSecretRedact.ts` (divergent lists); `membrane/src/logger.ts` `SENSITIVE_LOG_KEYS`; `finance_core/pii_masking.py` `PIILogFilter` | **S** (TS) — export the recursive key-name redactor from logger; a key added once protects everyone. Finance's role-aware masking is an upstream contribution candidate |
| JSONL persistence/replay | touchstone, pipeline-sdk, crucible, soma | `@centient/events` | `touchstone/src/store/run-store.ts` + `gate-overrides.ts` (reader duplicated twice in-repo); `pipeline-sdk/packages/evaluation/src/store/jsonl-run-store.ts`; `crucible/src/wal/audit.ts` (zero uses of `createAuditWriter` despite logger dep); `soma/.../jsonl-sink.ts` (1,591 — documents WHY events' subscriber is unsuitable: envelope wrapping + 100ms batching breaks durability) | **M** — upstream bare-event line format, fdatasync-per-write mode, and a corrupt-line-tolerant typed reader into `@centient/events`; then migrate all four |
| Write-ahead log | pipeline-sdk | `@centient/wal` | `packages/pipeline/src/wal/wal.ts` (454) + `replay.ts` — richer than wal 0.3.1 (typed unions, tombstone auto-compaction, serialized queue, retry-budget replay) | **L** — upstream pipeline-sdk's features into `@centient/wal`, then consume; ends two divergent WAL formats |
| Vault internals, secrets CLI, agent-env detection | burnrate, centient, mbot | `@centient/secrets` | `burnrate/cli/src/bootstrap.ts` (AAD derivation copy; file flags exporting `bootstrapVault()` as upstream ask #2, ADR-001) + `commands.ts` (370 generic subcommand kit) + `main.ts` (missing `CLAUDECODE`/`CODEX_SANDBOX` markers); `centient/.../MetaKnowledgeEncryption.ts` (295, AES-GCM without AAD or rollback protection); `mbot/src/keychain-probe.ts` (205, exists because secrets returns null for both locked and not-found) | **S–M** — export `bootstrapVault()`, a reusable subcommand kit, a discriminated read result / `probeBackendState()`, and the extra agent-env markers |
| Test HTTP client / health wait / seed IDs / MCP client | engram-test-harness, centient-test-harness | `@centient-labs/test-kit` | `engram-test-harness/src/helpers/{client,wait-for-ready,seed}.ts` — wait-for-ready defaults byte-identical to `test-kit/dist/health`; test-kit declared in package.json but never imported; `centient-test-harness/src/centient-client.ts` (135) vs test-kit's `createMcpTestClient` | **S** — drop-in; upstream the centient `{success,data,error,metadata}` envelope parser into test-kit's mcp module while migrating |
| Python: logging, secrets, WAL | finance, fileum | (no Python ports exist) | `finance_core/logging.py` (834) + a second logger in `finance_retrieval/logging.py`; `finance_core/encryption.py` + `finance_retrieval/credentials.py` (450, with unimplemented `list_institutions()` placeholder); `fileum/engram_client.py` WAL (190, reaches into `_sdk._request()` internals) | **L** — workstream decision: port Tier-1 packages to Python (sdk-python sets the precedent), or accept divergence. The fileum offline WAL belongs inside `engram-py` either way |

---

## 2. Extract to package

Ranked by repo count, LOC at stake, and cleanliness of the seam. Public = generic with no org coupling; private = org conventions, credentials, or engram semantics baked in.

### 2.1 `@centient/resilience` — circuit breaker, rate limiter, backoff, caches, bounded concurrency

- **Visibility:** **Public.** Pure, zero-dependency primitives (state machines, token buckets, backoff math, LRU/TTL/SWR caches) with no org coupling — exactly the kind of package that benefits from external eyes.
- **Source of truth:** `platform/centient` `utils/CircuitBreaker.ts` (403) / `RateLimiter.ts` (508) / `CacheManager.ts` (355); take crucible's clock-injected pure breaker (`crucible/src/state/circuit-breaker.ts`, 340) as the breaker reference implementation.
- **Call sites to migrate:** crucible's *two* divergent breakers (`state/` + `orchestrator/circuit-breaker.ts`); engram-server `services/circuit-breaker.ts` (123) + `utils/cache.ts` LRU (100); pipeline-sdk `swr-cache.ts` (93) + `pool.ts` (81); crucible `utils/async.ts` `allSettledBounded`; engram-test-harness `concurrentBatch` (78); test-kit's three jitterless backoffs; membrane HealthChecker's backoff helper; finance `with_retry` (Python, port later).
- **LOC:** ~2,400 across repos.
- **Plan:** (1) Stand up the package with breaker (crucible's), token-bucket limiter + LRU/TTL/SWR caches (centient's/pipeline-sdk's), one backoff-with-jitter primitive, and a bounded-concurrency pool. (2) Have `@centient/sdk` re-export/consume the backoff primitive internally (closes the retry-policy adoption row's dependency). (3) Migrate call sites repo by repo, deleting duplicates. (4) Changeset + adoption tracking issue per repo.

### 2.2 `@centient/config-loader` — layered config resolution + app-home paths

- **Visibility:** **Public.** "env > project file > user file > defaults" with caching, warnings, and `~/.{app}` path helpers is fully product-agnostic; schemas stay in each repo.
- **Source of truth:** `platform/centient` `utils/config.ts` (1,485 — the most complete layering/caching/write-back engine); fold in touchstone's `store/discovery.ts` walk-up-to-marker root resolution (136) and soma's typed validate-at-edge env readers (`runtime/settings.ts`).
- **Call sites to migrate:** centient `config.ts`; engram-server `utils/config.ts` (1,192) + `paths.ts` + `web-config.ts` (generic skeleton ~400); soma `config.ts`/`settings.ts` (255); finance `finance_config` + `finance_ops/environment.py` (650, Python — pattern reference); fileum `config.py` helpers (80, Python).
- **LOC:** ~600 generic core; deletes 1,000+ across consumers.
- **Plan:** (1) Extract the resolution engine (layering, caching, `getConfigWarnings`, `resetConfigCache`) generic over a schema. (2) Add the path-helper family (`APP_HOME` env override, 0o700 dirs) and root-discovery walk-up. (3) Migrate centient, engram-server, soma; keep their schemas local. (4) Treat the Python copies as the port spec if/when Python Tier-1 ports happen.

### 2.3 `@centient-labs/test-kit` consolidation — harness scaffolding

- **Visibility:** **Private** (existing package; org test infra, org binary/env conventions).
- **Source of truth:** `platform/soma-test-harness` for the CLI scaffold; test-kit itself for everything it already ships.
- **Call sites to migrate:** soma-test-harness + engram-test-harness near-identical harness CLIs (`src/cli.ts` in both — soma's header says it "Mirrors engram-test-harness's shape", ~300 LOC) → `createHarnessCli({name, image, envPassthrough, dockerfile})`; `run-soma.ts` spawn/resolve-binary runner (110) → generic `runCli()`/`resolveBin()`; `live-gate.ts` two-gate paid-API opt-in (60); centient-test-harness `setup.ts` engram-spawn fixture (130, its `waitForHealth` duplicates test-kit health); engram-test-harness vitest matchers (`assertions.ts`, 217).
- **LOC:** ~800.
- **Plan:** (1) Add `createHarnessCli`, `runCli`/`resolveBin`, `liveGate`, and an engram-spawn fixture to test-kit. (2) Extend `assertions` with the expect.extend matchers (Levenshtein, `toBeHealthy`, `toBePaginated`). (3) Migrate the three harness repos; the third future harness gets it for free.

### 2.4 `@centient-labs/git-ops` — injection-safe git/GitHub automation

- **Visibility:** **Private.** Coupled to org workflows: `gh` PR creation, App-token auth, branch-isolation conventions, org branch-protection assumptions.
- **Source of truth:** `crucible/src/orchestrator/git-ops.ts` (516 — cleanest seam: execFile-only, validated branch names, Result-typed errors).
- **Call sites to migrate:** soma `orchestration/src/git/{worktree,salvage,sanitize}.ts` (597, worktree-per-agent + salvage-on-teardown; membrane-coupled half could land in membrane instead); mbot `workspace/git-utils.ts` (168, ssh→https `insteadOf` rewrite for token-auth submodules — 2026-06-11 incident blocked all reviews); `support/cli` `lib/git.ts` pure parsers + tidy exec pattern (520, itself a port of crucible's tidy); centient `GitIdentity.ts` (324).
- **LOC:** ~1,600.
- **Plan:** (1) Extract crucible's git-ops + the pure parsers from `support/cli/lib/git.ts`. (2) Fold in mbot's token-auth/submodule helpers and soma's arg sanitizer. (3) Migrate crucible, soma, mbot; resolve the tidy duplication by making crucible delegate to `cl tidy` (or both consume the shared parsers). (4) Leave product-specific PR copy/templates in each repo.

### 2.5 `@centient-labs/daemon` additions — restart watcher, PATH self-heal, NDJSON socket RPC, middleware subpath, readiness probes

- **Visibility:** **Private** (existing package; org daemon conventions).
- **Source of truth:** the contributing repos, upstreamed into daemon.
- **What moves:** engram-server `daemon/restartWatcher.ts` (285, npm/Homebrew postinstall restart flags) + the hardened control-file readers; mbot `runtime-path.ts` (84 — launchd PATH loss caused incidents #1244/#1248, platform-wide failure mode); soma `session-server/{transport,rpc-protocol,client}.ts` NDJSON-over-unix-socket RPC (532); daemon's own `rate-limiter.ts`/`request-id.ts`/`request-logger.ts` as a `hono` subpath export (370 — rate limiter header says "Extracted from engram-server", whose original copy can then be deleted); promote test-kit `poll-until-ready` (220) / membrane's docker-agnostic probe+monitor core (`HealthChecker.ts:230-690`) into one runtime-grade readiness module; export `fetch-tls.ts` from the barrel (currently internal-only).
- **LOC:** ~1,500.
- **Plan:** (1) Land the hono middleware subpath and readiness module (engram-server deletes its rate-limiter original; test-kit re-exports). (2) Add restart watcher + runtime-path + socket RPC as daemon modules. (3) Migrate engram-server, mbot, soma.

### 2.6 `@centient-labs/llm-cost` — pricing tables + usage→cost tracking

- **Visibility:** **Private.** Ties into the org observability constraint (`.agent/constraints/observability.md` cost-tracking mandate) and the engram `get_cost_dashboard` pipeline; pricing-table update cadence is an org operational concern.
- **Source of truth:** `soma/packages/orchestration/src/cost/` (1,707 — richer: cache_read/cache_write, operator overrides, staleness warnings, conservative fallback); merge centient's `CostTracker.ts` batched persistence + aggregation (446) and `costPricing.ts` (161).
- **Call sites to migrate:** soma `cost/`, centient `CostTracker`/`costPricing`; future consumers: mbot, crucible (every LLM-calling repo).
- **LOC:** ~2,300.
- **Plan:** (1) Extract soma's pricing+compute as the core. (2) Add centient's file persistence/aggregation/prune as an optional sink. (3) Migrate both; pricing tables now update in exactly one place.

### 2.7 `@centient-labs/credential-pool` — vault-backed rotating provider credentials

- **Visibility:** **Private.** Built on `@centient/secrets` with org vault prefixes and Anthropic credential-shape knowledge; alternatively upstream as a `@centient/secrets` companion module.
- **Source of truth:** `soma/packages/orchestration/src/credentials/store.ts` (1,033 — its own doc comment cites "crucible's three-mode pattern in crucible-integration.ts / cli-subcommands/shared.ts" as the existing duplicate).
- **Call sites to migrate:** soma `store.ts` + `runtime/credential-pool.ts`; crucible's three-mode credential selection; bring mbot's `claude-auth-env.ts` (92 — sk-ant-api03 vs sk-ant-oat01 → correct env var; its absence caused the 2026-05-24 maintainer outage) along as the credential-shape mapper.
- **LOC:** ~1,300.
- **Plan:** (1) Extract pool (enumeration, round-robin, Retry-After cooldowns, enable/disable, env fallback) parameterized on vault prefix. (2) Include the credential-shape→env-var mapper. (3) Migrate soma and crucible; mbot adopts the mapper.

### 2.8 `@centient-labs/crystal-kit` — schema-validated crystal I/O + distributed lease lock

- **Visibility:** **Private.** Semantics are engram-crystal-specific (CAS via `expectedVersion`, contentInline conventions); useless outside the org.
- **Source of truth:** `mbot/src/lock/crystal-lock.ts` (586) + `heartbeat.ts` (120) — carries hard-won correctness (per-acquisition epoch guards from the 0.25.0 lock-churn storm); `mbot/src/state/crystal-io.ts` (144) + `semver.ts` (84).
- **Call sites to migrate:** mbot's *second* lock (`periodic/task-lock.ts`, 584 — the in-repo duplication signal); soma `persona-store/engram-adapter.ts` (268) and pipeline-sdk `crystal-hierarchy.ts` as crystal-io consumers; any future multi-instance engram consumer.
- **LOC:** ~1,500.
- **Plan:** (1) Extract crystal-io (Zod-generic) + the lease lock with epochs. (2) Reimplement mbot's task-lock on the shared lock, deleting the second implementation. (3) Offer the lock to soma/crucible single-runner coordination.

### 2.9 `@centient/path-security` — traversal prevention + path/PII sanitization

- **Visibility:** **Public.** Generic security primitive; security-critical code benefits most from a single audited implementation.
- **Source of truth:** `centient/utils/pathValidation.ts` (311) + `path-guards.ts` (98); cross-check against `crucible/src/utils/sanitize-path.ts` (147) and `soma/orchestration/src/git/sanitize.ts` (143) and keep the strictest behavior.
- **Call sites to migrate:** centient, crucible, soma (path half); centient `sanitize.ts` home-dir/username redaction (327) folds into `@centient/logger`'s redaction instead.
- **LOC:** ~700.
- **Plan:** (1) Extract allowed-roots validation + component sanitizer with a Result-typed API. (2) Migrate the three repos. (3) Move the redaction half into logger sanitize (joins adopt-table row).

### 2.10 `@centient/cli-utils` — terminal capabilities, ANSI colors, minimal semver

- **Visibility:** **Public.** NO_COLOR/FORCE_COLOR/TERM precedence and 3-part semver compare are fully generic.
- **Source of truth:** `support/cli/src/lib/colors.ts` (84, header: "Ported from crucible's cli-utils.ts (ADR-004 D5)" — confirmed two-copy duplication, tests included); `soma/packages/persona/src/semver/{parse,filter}.ts` (228, has range satisfaction) as the semver reference.
- **Call sites to migrate:** support/cli, crucible's `cli-utils.ts`, centient `colors.ts` (131) + `semver.ts` (63 — its header says it already consolidated 4 copies *within* centient), mbot `state/semver.ts` (84); crucible's `token-estimator.ts` (47, a documented deliberate copy from centient per ADR-040 D8) rides along.
- **LOC:** ~650.
- **Plan:** (1) Package colors/capabilities + semver-lite (parse/compare/satisfies). (2) Migrate the five call sites. (3) Future centient CLIs depend on it from day one.

### 2.11 `@centient/dag` — generic DAG scheduling core

- **Visibility:** **Public.** `pipeline-sdk/packages/orchestrator/src/dag.ts` (463) header says "100% generic — extracted as-is from crucible": zero-dependency adjacency/cycle-detection/topo-sort/waves/cascade over `DAGNode<TId>`; already needed in two places by its own admission.
- **Source of truth:** pipeline-sdk `dag.ts` + `failure-classifier.ts` (75). (`pool.ts` goes to resilience, §2.1.)
- **Call sites to migrate:** pipeline-sdk orchestrator; crucible (the original); future daemon/membrane wave scheduling.
- **LOC:** ~540.
- **Plan:** (1) Lift as standalone package or a clearly exported subpath of `@centient-labs/orchestrator`. (2) Point pipeline-sdk at it. (3) Offer to crucible to retire its original.

### 2.12 Atomic fs primitives → export from `@centient/wal`

- **Visibility:** **Public** (within wal, which is already public). Not a new package — an export surface change.
- **Source of truth:** `crucible/src/utils/atomic-io.ts` (73 — its wal.ts compliance notes confirm `@centient/wal` already implements tmp-then-rename internally); `pipeline-sdk/packages/orchestrator/src/state.ts` `atomicWrite` (45, adds fsync).
- **Call sites to migrate:** crucible, pipeline-sdk; fileum's `lock.py` atomic temp+rename (Python, port reference).
- **Plan:** (1) Export `atomicWrite`/`atomicAppendLine` (with fsync option and PIPE_BUF documentation) from `@centient/wal`. (2) Delete both local copies.

### 2.13 `@centient/proc` — hardened subprocess runner

- **Visibility:** **Public.** Generic execFile/spawn wrapper: timeouts, SIGKILL races, buffer caps, settle-once, stdin streaming, unified error normalization.
- **Source of truth:** `membrane/src/DockerCLI.ts:81-245,332-404` (300 — everything but the hard-coded `docker` binary is generic).
- **Call sites to migrate:** membrane DockerCLI (re-based on it), test-kit `containers/manager.ts` exec paths, soma-test-harness `run-soma.ts` core, daemon spawn helpers.
- **LOC:** ~400.
- **Plan:** (1) Extract the runner + `_normalizeError` from membrane with injectable impls. (2) Re-base DockerCLI on it (behavioral no-op). (3) Adopt in test-kit and the harness runners.

---

## 3. Considered, rejected

One line each; "single-repo" means revisit when a second consumer materializes.

- **rlvr-verification-harness** (centient, ~3,900 LOC) — single-repo; overlaps touchstone's evaluation mission, revisit after the crucible→touchstone migration settles.
- **oauth-device-flow** (centient `auth/device-flow.ts`, 1,100) — clean subsystem but only one CLI authenticates against the platform today.
- **api-key-store + TLS cert generator** (engram-server `auth/key-store.ts`, 1,100) — excellent candidate for `@centient-labs/daemon` *when* a second networked daemon exposes an HTTP API; single consumer now.
- **ndjson-archive** (engram-server, 1,180) — versioned export container with migration framework; single consumer, format still co-evolving with engram entities.
- **events-ws-bridge** (daemon `events-ws.ts`, 490) — natural `@centient/events` adapter subpath, but only one service tails streams remotely today.
- **github-app-token-provider** (mbot, 738) — provider-grade, but mbot is the only GitHub App; extract on the second bot.
- **periodic-task-scheduler** (mbot, 1,700) — generic framework, single consumer; pairs with crystal-kit (§2.8) if a second daemon needs scheduled single-runner tasks.
- **prompt-injection-sanitizer** (mbot, 287) — pattern library worth one home eventually, but one implementation exists today, so there is nothing diverging yet.
- **agent-tool-harness** (soma, ~3,700) — the report itself flags it for deliberate design rather than quick lift; premature.
- **persisted-state-machine** (fileum, 253) — evidence a Python pipeline/state primitive is needed, but no Python package home exists.
- **multi-agent-file-claims** (finance, 574) / **playwright-retriever-framework** (finance, 1,200) — coherent, but Python with a single product; queue behind the Python-ports decision.
- **rich-cli-kit, document-content-extractor, macos-cloud-fs-helpers, launchd-scheduler, cli-json-envelope** (fileum) — all single-product Python; revisit if a second Python product ships.
- **fasttrack Swift candidates** (notification gateway, widget bridge, HealthKit kit) — no shared Swift package home exists and no second Apple-platform product; the reports themselves condition extraction on both.
- **stats-percentiles, node-error-guard, structured-error-base** (touchstone, 21–66 LOC each) — too small standalone; ride along inside whichever shared utils package ships (cli-utils or resilience).
- **token-estimator** (crucible, 47) — ADR-040 D8 deliberately chose duplication; only revisit as a cli-utils passenger (§2.10).
- **claude-guard-hook + workspace-governance-audits** (release-toolkit) — real findings, but the fix is *relocation* (to support/standards / the toolkit plugin), not package extraction.
- **shell-log-prompt-helpers** (release-toolkit) — the shared utility already exists (`lib/common.sh`); the fix is sourcing it, and bash cannot consume an npm package anyway.
- **git-tidy** (support/cli + crucible) — consolidation direction is delegation (crucible/skill call `cl tidy`) or sharing the parsers via git-ops (§2.4), not a new package.
- **insecure-local-fetch** (daemon, 37) — fix is exporting it from the daemon barrel (folded into §2.5), not a package.

---

## 4. Adoption matrix

From each report's `alreadyConsumes`. ● = consumes today; (·) = declared/partial with a caveat.

| Repo | events | logger | secrets | sdk | wal | daemon | membrane | pipeline | test-kit | touchstone | other |
|---|---|---|---|---|---|---|---|---|---|---|---|
| platform/centient | | ● | ● | ● | | | | | | | |
| platform/crucible | | ● | | ● | ● | | ● | ● | | (·) in-repo copy, not the private pkg | release-toolkit submodule |
| platform/engram-server | ● | ● | | ● | | ● | | | | | release-toolkit submodule |
| platform/mbot | ● | | ● | ● | | ● | ● | | | | |
| platform/soma | ● | ● | ● | (·) interface-only facade | ● | ● | ● | | | | |
| platform/soma-test-harness | | | | | | | ● | | | | |
| private-packages/daemon | ● | ● | | | | — | | | | | |
| private-packages/membrane | ● | | | | | | — | | | | logger only transitive (ADR-003) |
| private-packages/pipeline-sdk | | | | ● | | | | — | | | |
| private-packages/test-kit | | ● | | (·) declared, never imported | | | | | — | | |
| private-packages/touchstone | | ● | | | | | | | | — | |
| private-packages/persona-sdk | | | | | | | | | | | **consumes none** (greenfield) |
| products/burnrate | | | ● | | | | | | | | |
| products/fileum | | | | | | | | | | | vendored engram-py only |
| products/finance | | | | | | | | | | | **consumes none** (Python; see adopt-table Python row) |
| products/fasttrack | | | | | | | | | | | **consumes none** (Swift; no Apple package home exists) |
| support/cli | | | | | | | | | | | **consumes none** (zero-runtime-deps by design) |
| support/release-toolkit | | | | | | | | | | | **consumes none** (bash) |
| centient-test-harness | | | | | | | | | | | **consumes none** — should consume test-kit (§1) |
| testing/engram-test-harness | | | | ● | | | ● | | (·) declared, never imported | | |

**Highlights:**
- **Consuming nothing despite TS overlap:** `centient-test-harness` (every helper it hand-rolled exists in test-kit) and `support/cli` (deliberate zero-dep policy — a decision to revisit if `@centient/cli-utils` ships, since it duplicates crucible code today).
- **Declared-but-unused dependencies:** test-kit declares `@centient/sdk` (^1.3.0) but never imports it; engram-test-harness declares `@centient-labs/test-kit` but never imports it — the cheapest wins in this whole document are finishing those two adoptions.
- **Non-TS repos** (finance, fileum, fasttrack, release-toolkit) cannot consume the npm packages; finance + fileum together are the concrete case for Python ports of logger/secrets/wal (adopt-table, last row).