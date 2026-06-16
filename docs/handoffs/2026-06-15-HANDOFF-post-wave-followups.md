---
topic: post-wave-followups
date: 2026-06-15
author: claude (operator: owenjohnson)
engram_session: 2026-06-12-hardening-wave1-close
handoff_issue: null
predecessor: 2026-06-12-HANDOFF-next-stage-execution
---

# Handoff: Post-wave follow-ups — public-packages wave shipped (16/16), consumer-migration + roadmap tail

**Date:** 2026-06-15
**Predecessor:** `docs/handoffs/2026-06-12-HANDOFF-next-stage-execution.md` — **RETIRED** (its wave is complete; this handoff supersedes it).

## What shipped (the wave is DONE)

The public-packages + next-stage wave merged **16/16 PRs** to main:

- **6 new zero-dep `@centient` packages:** resilience, config-loader, path-security, cli-utils, dag, proc.
- **`@centient/wal` atomic-fs exports** — `atomicWrite` / `atomicAppendLine`.
- **Next-stage Initiatives 1–7:** release-gate hardening (#87), doc tradeoffs + node-20 floor (#95), sdk-python 0.34.0 Phase A+B (#105), runtime shape validation closing #62 (#106), ADR ledger (#104), logger injection (#108), `subscribeIter` (#107).
- **Crucible harvest staged → retired:** workspace **#99** (git-ops) merged; `harvest/crucible/` **removed from this repo in this PR** now the packages supersede the staging copies.
- **First consumer migration:** `@centient/sdk` adopts `@centient/resilience` backoff + exports `isRetryableError` — **PR #110**.

## Priority for next session (open follow-ups)

1. **Land PR #110** (sdk→resilience) if not yet merged.
2. **Consumer migrations in the OTHER repos** — adopt the new packages where each was hand-rolled (each is recorded in the originating package's PR follow-ups):
   - **resilience** → mbot, test-kit, membrane, engram-server, pipeline-sdk (breaker/limiter/cache + backoff; export `isRetryableError`).
   - **config-loader** → centient (`utils/config.ts`), engram-server (~1,192-line `utils/config.ts`), soma.
   - **path-security** → centient, soma.
   - **cli-utils** → support/cli, centient, mbot, soma.
   - **dag** → pipeline-sdk (drop its copy); future daemon/membrane.
   - **proc** → membrane DockerCLI re-base, test-kit container manager, soma-test-harness, daemon spawn helpers.
   - **wal atomic exports** → pipeline-sdk.
3. **sdk-python Phase C** — sync resource + the remaining 6 resources, 2.0.0-aligned version (Initiative 3 shipped Phase A+B only).
4. **ADR-002 1.0 pillars** — 6 open tracking issues **#98–#103** (factory+policy stack, audit sink+HMAC chaining, SecretsProvider rename+KeyProvider reconciliation, threat-model doc, op-argv visibility, perf-benchmark baselines).
5. **Scoped `/cl-adr-audit` on ADR-001** — passphrase-provider re-audit (deferred from Initiative 5; the amendment shipped, the security re-audit did not).

## Operational notes

- **mbot (centient-maintainer)** stalled 3× during the wave (multi-hour outages, recovered each time) — the sole throughput bottleneck. Verdict format: **APPROVE = `✅ Ready`** (NOT "Approve"); **ITERATE = `❌ Iterate`**. Harness auto-merges on `✅ Ready`, including merge-commits.
- **Shepherding tooling** (gitignored, under `.claude/`): `wave-remediation.mjs` (fix mbot findings), `wave-conflict-resolve.mjs` (merge-from-main keep-both for the CLAUDE.md/lockfile cascade).
- **Monitor lesson:** a backgrounded shell `while`-loop Monitor never delivered events in this environment (alive, correct jq, empty output) — verify a monitor emits a test event before trusting it; a `ScheduleWakeup` poll was the reliable driver.
- **CLAUDE.md package table** version column is synced by `scripts/sync-claudemd-versions.mjs` (Initiative 1, chained into `pnpm run version-packages`) — never hand-edit it.

## Hard guardrails (unchanged)

- **Never push to main / force-push / admin-merge from an implementing seat** — mbot is the gate; the coordinator merges. (Operator authorized specific one-off admin-merges: workspace #99, this harvest-removal.)
- **Zero EXTERNAL runtime deps** per `@centient` package; intra-monorepo `@centient`→`@centient` deps (e.g. sdk→resilience via `workspace:*`) are the intended composition, not a violation.
- **Never bump versions manually** — changesets + `pnpm run version-packages` only.

## References

- Plans: `docs/plans/2026-06-12-public-packages-plan.md`, `docs/plans/2026-06-12-next-stage.md`
- Retired predecessor: `docs/handoffs/2026-06-12-HANDOFF-next-stage-execution.md`
- ADR-002 1.0 tracking issues: #98–#103
