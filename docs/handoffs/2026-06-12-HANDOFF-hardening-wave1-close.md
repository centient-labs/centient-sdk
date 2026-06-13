---
topic: hardening-wave1-close
date: 2026-06-12
author: claude (operator: owenjohnson)
engram_session: 2026-06-11-secrets-passphrase
handoff_issue: 85
predecessor: null
---

# Handoff: Hardening Wave-1 close-out — phases 5–7 shipped, 2.0.0/0.7.0 released, next-stage + centralization plans on main

**Date:** 2026-06-12
**Author:** claude (operator: owenjohnson)
**Predecessor:** none — first handoff in this repo

## Priority for next session **(required)**

1. **Execute Initiative 1 of `docs/plans/2026-06-12-next-stage.md` (release-gate integrity, P0), steps 2–4.** Step 1 (CLAUDE.md fix-forward) already landed as [#82](https://github.com/centient-labs/centient-sdk/pull/82). Remaining: mechanize the CLAUDE.md version-column sync inside the `changeset version` flow, make `make publish` re-run check in-invocation + refuse on dirty tree/non-main HEAD, and record the 2.0.0-publish bypass root cause in STATE.md. Every future release reproduces the red-main break until this lands.
2. **Crucible harvest — time-sensitive, blocks crucible's archival.** Checklist in `docs/plans/2026-06-12-public-packages-plan.md`: the clock-injected circuit breaker, `cli-utils.ts`, the original DAG implementation + tests (public targets here), and `git-ops.ts` (private target, see [workspace#85](https://github.com/centient-labs/workspace/issues/85)). Crucible is being retired; copy sources + tests out before the repo is archived.
3. **Start the public-package wave with `@centient/resilience`** (`docs/plans/2026-06-12-public-packages-plan.md` §1) — it unblocks the sdk configurable-retry upstream ask that three repos hand-rolled around. Then initiatives 2–7 of the next-stage spec in order.

## What was accomplished **(required)**

### Hardening pipeline phases 5–7 (Wave 1, campaign: workspace `docs/plans/2026-06-10-hardening-master-plan.md`)

- Phase 5: all 6 BACKLOG.md tickets implemented in isolated worktrees, each surviving an independent adversarial refutation round before its PR opened. Merged: [#71](https://github.com/centient-labs/centient-sdk/pull/71) (retry jitter), [#72](https://github.com/centient-labs/centient-sdk/pull/72) (docs drift), [#73](https://github.com/centient-labs/centient-sdk/pull/73) (SSE void-run error loss, HIGH), [#74](https://github.com/centient-labs/centient-sdk/pull/74) (publish provenance + fingerprint gate), [#75](https://github.com/centient-labs/centient-sdk/pull/75) (client logging), [#76](https://github.com/centient-labs/centient-sdk/pull/76) (non-JSON 2xx no-retry). Ledger: [#77](https://github.com/centient-labs/centient-sdk/pull/77).
- Phase 6: post-merge clean-repro green (fresh frozen-lockfile install; tsc 0 errors; 1257 passed / 14 skipped; claudemd-check OK). Recorded via [#79](https://github.com/centient-labs/centient-sdk/pull/79). Merge-train incident (#71×#76 semantic conflict made main red; fix-forward [#78](https://github.com/centient-labs/centient-sdk/pull/78) closed as redundant when #75's merge carried the fix) documented in STATE.md.
- Phase 7: next-stage spec ([#83](https://github.com/centient-labs/centient-sdk/pull/83), `docs/plans/2026-06-12-next-stage.md`) — 7 ordered initiatives + 12-item deferred-again ledger.

### PR #67 adoption (out-of-pipeline) and release

- Adopted the orphaned passphrase-provider PR [#67](https://github.com/centient-labs/centient-sdk/pull/67): empirically disproved codex's signal-recursion claim with a child-process probe, which exposed the real bug — the `finally` block removed signal listeners before libuv dispatched a queued signal, silently swallowing external SIGTERM during the prompt. Fixed (deferred one-tick removal + remove-all-before-re-raise + 64 KiB hidden-input cap, commit 895b88d), shepherded through ~4 more review rounds (rebuttals: process.once semantics, readSync-throws-not-returns-negative), merged b171141.
- **Released `@centient/sdk` 2.0.0** (engram-server 0.34.0 sync-contract realignment + the hardening fixes + optional injected logger) **and `@centient/secrets` 0.7.0** (passphrase provider). T7 from BACKLOG.md resolved. Release exposed the gate gap → Priority 1.
- Fix-forward [#82](https://github.com/centient-labs/centient-sdk/pull/82) (CLAUDE.md table sync) merged.

### Centralization analysis (workspace-wide)

- 23-repo read-only sweep → `docs/plans/2026-06-12-centralization-candidates.md` ([#84](https://github.com/centient-labs/centient-sdk/pull/84)): 14 adopt-don't-extract rows, 13 extraction candidates, adoption matrix. Operator decisions recorded in its §0 (crucible retired → harvest; persona-sdk on roadmap; test-kit committed; visibility/home matrix; sequencing).
- Public execution plan: `docs/plans/2026-06-12-public-packages-plan.md` (6 new `@centient/*` packages + wal atomic-fs exports, ordered, ground rules, harvest checklist).
- Issues filed: [workspace#85](https://github.com/centient-labs/workspace/issues/85) (4 new private packages: git-ops, llm-cost, credential-pool, crystal-kit), [daemon#40](https://github.com/centient-labs/daemon/issues/40) (5 upstream additions), [test-kit#20](https://github.com/centient-labs/test-kit/issues/20) (harness consolidation).

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| Next-stage Initiative 1 steps 2–4 (gate mechanization) | open | next seat | — |
| Crucible harvest (4 sources) | open — blocks crucible archival | next seat / coordinator | — |
| Next-stage Initiatives 2–7 (`docs/plans/2026-06-12-next-stage.md`) | open, ordered | next seat | — |
| Public packages wave (`docs/plans/2026-06-12-public-packages-plan.md`) | open, resilience first | next seat | — |
| New private packages | open | per-repo seats | [workspace#85](https://github.com/centient-labs/workspace/issues/85) |
| daemon upstreams | open | daemon seat | [daemon#40](https://github.com/centient-labs/daemon/issues/40) |
| test-kit consolidation | open | test-kit seat | [test-kit#20](https://github.com/centient-labs/test-kit/issues/20) |
| sdk-python 0.34.0 parity (Initiative 3) | open — python sdk claims parity it lost at 2.0.0 | next seat | — |
| ADR-001 amendment for passphrase provider (Initiative 5) | open — shipped provider absent from `KeyProviderType` (ADR line 70) | next seat | — |

## Operational notes **(required)**

### Commands

```bash
make check            # full gate: lint + test + claudemd-check (+ fingerprint stamp)
make publish          # hard-gated release; needs npm login + 2FA (interactive OTP)
git submodule update --init scripts/release-toolkit   # worktrees lack the submodule — make check fails without it
```

### Paths and gotchas

- `docs/hardening/STATE.md` — phase ledger, resume point for the pipeline; `docs/hardening/BACKLOG.md` — all 6 tickets merged-with-acceptance.
- ADR-006 secrets gate: literal `apiKey: "..."` strings in test diffs block the whole mbot review round even when the scanner demotes them — bind fixtures to a neutrally-named var (convention documented in `packages/sdk/tests/client.test.ts`; bit PRs #73 and #76).
- mbot review rounds trigger on **pushes**, not comments — a rebuttal-only response needs a branch refresh (merge-from-main) to get re-reviewed.
- The release flow runs `check` **before** `changeset version` mutates versions — until Initiative 1 lands, every publish leaves main red on claudemd-check; fix-forward immediately.
- Credential source: npm publish auth via operator `npm login` (2FA); no tokens in repo.
- Engram persist: session notes saved; `consolidate_session_memory` unavailable in this engram version (EXTERNAL_QDRANT_UNAVAILABLE) — durable recall persisted via the REST fallback instead (crystal `63e9da63-51cb-40ab-a722-9c46697d0204`, tags `handoff, centient-sdk, hardening-wave1-close`), keyword-probe verified.

## Hard guardrails **(required)**

- **Never push to main; never force-push; never merge from an implementing seat** — mbot is the review gate; the coordinator session merges (`.agent/procedures/` + hardening-pipeline rules).
- **Do not reintroduce GitHub Actions CI** — deliberate org decision (cef5ad7); only the publish/attestation step may ever move to CI, per the dormant T5 condition. The CI-archival ADR (Initiative 5) records the trigger.
- **Never bump versions manually** — changesets only; and don't run `pnpm changeset publish` directly (bypasses the Makefile gate — the very gap Initiative 1 closes).
- **Pipe exit codes:** run gates with `set -o pipefail` when tailing output — a swallowed `make check` failure caused one bad push this session (caught and fixed forward).
- Zero runtime dependencies for all `@centient/*` packages in this monorepo — anything needing a dep is mis-scoped.

## References **(optional)**

- Plans: `docs/plans/2026-06-12-next-stage.md`, `docs/plans/2026-06-12-public-packages-plan.md`, `docs/plans/2026-06-12-centralization-candidates.md`
- Ledger: `docs/hardening/STATE.md`, `docs/hardening/BACKLOG.md`
- ADRs: `docs/adr/001-key-provider-abstraction.md` (needs amendment), `docs/adr/002-secrets-long-term-architecture.md`
- Issues: [workspace#85](https://github.com/centient-labs/workspace/issues/85), [daemon#40](https://github.com/centient-labs/daemon/issues/40), [test-kit#20](https://github.com/centient-labs/test-kit/issues/20)
