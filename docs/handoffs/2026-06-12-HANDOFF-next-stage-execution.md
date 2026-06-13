---
topic: next-stage-execution
date: 2026-06-12
author: claude (operator: owenjohnson)
engram_session: 2026-06-12-hardening-wave1-close
handoff_issue: null
predecessor: 2026-06-12-HANDOFF-hardening-wave1-close
---

# Handoff: Next-stage execution — Initiative 1 shipped (PR #87), public-packages + harvest + Initiatives 2–7 fanned out

**Date:** 2026-06-12
**Author:** claude (operator: owenjohnson)
**Predecessor:** `docs/handoffs/2026-06-12-HANDOFF-hardening-wave1-close.md`

## Priority for next session **(required)**

1. **Land the in-flight PRs in dependency order once mbot is green.** Merge order matters: **#87 (release-gate) first** — it restructures the `Makefile` publish target, so every other branch that touches the Makefile (notably Initiative 3's `make python-test` wiring) rebases onto it. Then **#88 (plan rescue)**. Then the public-packages wave **resilience-first** (plan ground rule §1: one package per PR; resilience unblocks the sdk retry upstream). Coordinator/mbot merges — never from an implementing seat.
2. **Drive the public-packages + harvest + Initiatives 2–7 wave to merged PRs.** 14 worktree-isolated streams (specs below). As of this handoff the fan-out has been **blocked twice on infrastructure, zero code lost** (see Operational notes). The crucible harvest stream is **time-sensitive — it blocks crucible's archival** (operator decision in `docs/plans/2026-06-12-centralization-candidates.md` §0).
3. **After the wave, the remaining next-stage tail** lives in the Initiative 5 ADR/issue sweep (sdk-python Phase C, perf-benchmark baselines, ADR-002 1.0 pillars) — all ticketed, not executed this seat.

## What was accomplished **(required)**

### Initiative 1 — release-gate integrity (DONE, PR #87 open)

`docs/plans/2026-06-12-next-stage.md` Initiative 1 steps 2–4 (step 1 = #82, already merged). Branch `feat/release-gate-integrity` → **[#87](https://github.com/centient-labs/centient-sdk/pull/87)**, awaiting mbot.

- **Root cause (step 4):** reconstructed from git reflog + npm registry timestamps — the 2.0.0/0.7.0 publish was **one uninterrupted `make publish`** (sdk 2.0.0 hit npm 14 s after the `chore: version packages` commit). **No operator bypass, no direct `changeset publish`; the T5 stamp gate worked exactly as built.** The flaw was sequencing: every gate validated the *pre-bump* tree, then `changeset version` created the CLAUDE.md drift and nothing re-validated before publish+push. Recorded in `docs/hardening/STATE.md` phase 7; T7 + #67 marked resolved (were stale-open); BACKLOG.md T5 annotated.
- **Fix (steps 2–3):** `scripts/sync-claudemd-versions.mjs` (rewrites the CLAUDE.md version column from `packages/*/package.json`, fails loudly on a missing row), chained as `pnpm run version-packages`. `make publish` now refuses on a dirty tree or `HEAD != origin/main` before any mutation, and re-runs the **full `make check` live against the post-bump tree** before `changeset publish`; `DRY_RUN=1` exercises the gates without npm.
- **Verification:** `scripts/test-release-gates.sh` (throwaway clone, synthetic origin) — **8/8 pass**. Caught one real bug mid-build: a per-line `exit 0` doesn't stop a Make recipe — the DRY_RUN stop had to become a make-level `ifeq`. `make check` green: tsc 0 errors, 1296 passed / 14 skipped.

### Plan rescue (DONE, PR #88 open)

`docs/plans/2026-06-12-public-packages-plan.md` was committed on `docs/centralization-candidates` (fe9a81c) but **PR #84's squash never carried it to main** — the handoff referenced a file absent from main. Cherry-picked verbatim → **[#88](https://github.com/centient-labs/centient-sdk/pull/88)**.

### Public-packages + harvest + Initiatives 2–7 wave (IN FLIGHT — fanned out, not yet landed)

Operator asked to parallelize all new public-package design/development + crucible harvest + the handoff. Encoded as a **14-stream Workflow**, each stream = isolated git worktree off `origin/main`, delivering a branch + PR for the mbot gate. Stream specs are the source of truth in the workflow script (see References); summary:

| Stream | Branch | Deliverable |
|--------|--------|-------------|
| harvest-crucible | `chore/harvest-crucible` | Stage breaker/cli-utils/DAG/atomic-io + tests in `harvest/` with provenance @ crucible HEAD; `git-ops.ts` → **workspace repo** branch+PR (private, kept out of this public repo) + comment on workspace#85. **Blocks crucible archival.** |
| pkg-resilience | `feat/pkg-resilience` | **@centient/resilience** (lands first): breaker (port crucible's clock-injected one), token-bucket limiter, backoff+jitter (sdk-drop-in), LRU/TTL/SWR caches, bounded pool |
| pkg-config-loader | `feat/pkg-config-loader` | **@centient/config-loader**: layered env>project>user>default, write-back, 0o700 path helpers, walk-up root discovery |
| pkg-path-security | `feat/pkg-path-security` | **@centient/path-security**: allowed-roots traversal validation + sanitizer, adversarial vectors (strongest public-eyes case) |
| pkg-cli-utils | `feat/pkg-cli-utils` | **@centient/cli-utils**: NO_COLOR/FORCE_COLOR/TERM detection, ANSI helpers, semver-lite |
| pkg-dag | `feat/pkg-dag` | **@centient/dag**: generic DAG core (cycle/topo/wave/cascade), crucible original as behavioral baseline vs pipeline-sdk copy |
| pkg-proc | `feat/pkg-proc` | **@centient/proc**: hardened subprocess runner (timeouts, SIGKILL race, buffer caps, settle-once), membrane DockerCLI generic extraction |
| wal-atomic-exports | `feat/wal-atomic-exports` | wal exports `atomicWrite`/`atomicAppendLine` (plan item 7; surface change, minor changeset) |
| init2-doc-tradeoffs | `chore/init2-doc-tradeoffs` | Initiative 2: 5 deferred doc tradeoffs + sdk `engines.node>=20` |
| init3-python-parity | `feat/init3-python-parity` | Initiative 3: sdk-python Phase A (stop false-parity claim) + Phase B (0.34.0 core + pytest + `make python-test`); Phase C stretch |
| init4-shape-validation | `feat/init4-shape-validation` | Initiative 4: finish #62 — `src/validate.ts` envelope-family guards, non-retryable typed error, no public-surface change |
| init5-adr-ledger | `docs/init5-adr-ledger` | Initiative 5: ADR-001 passphrase amendment, CI-archival ADR, 5+ ADR-002 1.0 tracking issues |
| init6-logger-injection | `feat/init6-logger-injection` | Initiative 6: events+wal adopt sdk's injectable structural logger (default unchanged) |
| init7-sdk-subscribe | `feat/init7-sdk-subscribe-iter` | Initiative 7: deprecate broken `subscribe()` (throw without opt-in) + add `subscribeIter()` AsyncIterable |

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| PR #87 release-gate | open, awaiting mbot | coordinator | merge **first** (Makefile base for others) |
| PR #88 plan rescue | open, awaiting mbot | coordinator | — |
| 14-stream wave → PRs | in flight, infra-blocked ×2 | this/next seat | server rate-limit (transient) |
| Crucible harvest | not yet staged | this/next seat | **blocks crucible archival** |
| Cross-stream README/Makefile conflicts | expected at land time | coordinator | init 2/6/7 + wal touch shared READMEs; init3 touches Makefile #87 also edits |
| sdk-python Phase C | ticketed | future seat | Initiative 3 phased |
| ADR-002 1.0 pillars, perf baselines | ticketed in Initiative 5 sweep | future seat | — |

## Operational notes **(required)**

### Wave infra-failure history (both transient, ZERO code lost — agents died on first API call)

1. **Run `wf_931d91b4-eb3`:** all 14 failed — "issue with the selected model (claude-fable-5)... may not have access." Coincided with a concurrent `/login` interruption (auth broken for the window). Left 7 orphaned worktrees + 12 branches → **cleaned up** (`git worktree remove` + `git branch -D`).
2. **Run `wf_a19ace9e-3fa`:** all 14 failed — "Server is temporarily limiting requests (not your usage limit) · Rate limited." Firing 14 Opus agents (10 concurrent) tripped the server limiter; died in 23 s.

**Mitigation applied:** workflow script restructured to **sequential batches of 3** (peak concurrency 3, not 10) and agents pinned to `model: 'opus'`. Script path: see References. Relaunch via `Workflow({scriptPath})`.

### Commands

```bash
make check            # full gate: lint + test + claudemd-check
make publish          # now: clean-tree/on-main guards → version-packages → live post-bump check → publish. DRY_RUN=1 to test gates
make publish DRY_RUN=1 # exercise all gates, stop before version bump + npm
pnpm run version-packages   # changeset version + CLAUDE.md sync (never bare `pnpm changeset version`)
git submodule update --init scripts/release-toolkit   # worktrees lack it; make check fails without it
./scripts/test-release-gates.sh   # 8/8 self-test of the publish gates
```

### Paths and gotchas (carried from predecessor, still live)

- ADR-006 secrets gate: literal `apiKey: "..."` strings in test diffs block the whole mbot round — bind fixtures to a neutrally-named var (`packages/sdk/tests/client.test.ts`).
- mbot review rounds trigger on **pushes**, not comments — a rebuttal needs a branch refresh.
- Zero runtime dependencies for every `@centient/*` package — anything needing a dep is mis-scoped.
- Engram: `consolidate_session_memory` unavailable (EXTERNAL_QDRANT_UNAVAILABLE); durable recall via REST fallback (crystal `63e9da63-...`). This session's findings saved via `save_session_note`.

## Hard guardrails **(required)**

- **Never push to main; never force-push; never merge from an implementing seat** — mbot is the gate; coordinator merges.
- **Do not reintroduce GitHub Actions CI** (cef5ad7); only the publish/attestation step may ever move to CI (dormant T5). Initiative 5's CI-archival ADR records the trigger.
- **Never bump versions manually**; never run `pnpm changeset publish` / bare `pnpm changeset version` directly — `make publish` is the only publish path (now enforced, not just documented).
- **Pipe exit codes** with `set -o pipefail` when tailing gates.
- **Wave relaunch: keep batches small** (≤3 concurrent) to avoid re-tripping the server rate limit.

## References **(optional)**

- Workflow script (14 stream specs, batched): `/Users/owenjohnson/.claude/projects/-Users-owenjohnson-centient-labs-public-packages-centient-sdk/5713444b-efd8-42c2-94fc-4ee792fc039f/workflows/scripts/parallel-package-wave-wf_931d91b4-eb3.js`
- Plans: `docs/plans/2026-06-12-next-stage.md` (Initiatives 1–7), `docs/plans/2026-06-12-public-packages-plan.md` (6 pkgs + wal exports, harvest checklist), `docs/plans/2026-06-12-centralization-candidates.md`
- Ledger: `docs/hardening/STATE.md` (phase 7 root cause), `docs/hardening/BACKLOG.md`
- PRs: [#87](https://github.com/centient-labs/centient-sdk/pull/87), [#88](https://github.com/centient-labs/centient-sdk/pull/88)
- Issues: [workspace#85](https://github.com/centient-labs/workspace/issues/85), [daemon#40](https://github.com/centient-labs/daemon/issues/40), [test-kit#20](https://github.com/centient-labs/test-kit/issues/20)

---

## Overnight cycle log (appended live by the shepherd loop)

**Wave COMPLETE** — all 14 streams opened PRs (0 partial, 0 blocked; ~1.48M agent tokens). Full open-PR set (16):

| PR | Branch | Kind | mbot state (last check) |
|----|--------|------|--------------------------|
| #87 | feat/release-gate-integrity | Initiative 1 (mine) | R1 fixed+pushed (594917a) → awaiting R2 |
| #88 | docs/public-packages-plan | plan rescue (mine) | R1 rationale+note pushed (74cd5b2) → awaiting R2 |
| #89 | chore/harvest-crucible | harvest (blocks archival) | R1: 2 MED/4 LOW → remediation launched |
| #90 | feat/pkg-config-loader | @centient/config-loader | R1: 1 MED/4 LOW → remediation launched |
| #91 | feat/pkg-resilience | @centient/resilience (lands first) | no mbot review yet |
| #92 | feat/pkg-cli-utils | @centient/cli-utils | no mbot review yet |
| #93 | feat/pkg-dag | @centient/dag | no mbot review yet |
| #94 | feat/pkg-path-security | @centient/path-security | no mbot review yet |
| #95 | chore/init2-doc-tradeoffs | Initiative 2 | no mbot review yet |
| #96 | feat/pkg-proc | @centient/proc | no mbot review yet |
| #97 | feat/wal-atomic-exports | Initiative wal exports | no mbot review yet |
| #104 | docs/init5-adr-ledger | Initiative 5 | no mbot review yet |
| #105 | feat/init3-python-parity | Initiative 3 | no mbot review yet |
| #106 | feat/init4-shape-validation | Initiative 4 | no mbot review yet |
| #107 | feat/init7-sdk-subscribe-iter | Initiative 7 | no mbot review yet |
| #108 | feat/init6-logger-injection | Initiative 6 | no mbot review yet |

Also: workspace **PR #99** (centient-labs/workspace) stages crucible `git-ops.ts` privately, linked on workspace#85.

**Crucible harvest is STAGED** (PR #89): `harvest/crucible/` holds byte-verified verbatim copies (breaker, cli-utils, dag engine, atomic-io) + provenance README @ crucible HEAD d2dbf92. Crucible archival is unblocked once the live-port PRs land and `harvest/` is removed.

**Bottleneck:** mbot reviews ~1 PR per long interval — only 4 of 16 reviewed so far; my #87/#88 R2 pushes not yet re-reviewed. The shepherd loop remediates each PR as mbot flags it (batched ≤3, `.claude/wave-remediation.mjs`), drives to APPROVED, lets the harness merge. No admin-merge while operator away.

**Land order at merge time:** #87 (Makefile base) → #88 → #91 resilience → other packages → initiatives. Expect cross-PR conflicts: CLAUDE.md table rows (every new package adds one), and READMEs/Makefile touched by multiple initiatives — coordinator resolves at land time.
