# Hardening State — centient-sdk

Campaign: workspace docs/plans/2026-06-10-hardening-master-plan.md (Wave 1).

| Phase | Status | Artifact | Notes |
|-------|--------|----------|-------|
| 0 preflight | done 2026-06-10 | (this file) | Clean-repro green: tsc 0 errors, 1219 passed / 14 skipped. GitHub CI deliberately archived 2026-03-30 (commit cef5ad7) — gating is local `make check`. |
| 1 adr-soundness | done 2026-06-10 | 2026-06-10-dimensions.md | 2 ADRs, both affirm; folded into dimensions doc. |
| 2 adr-vs-code | done 2026-06-10 | 2026-06-10-dimensions.md | Spot-check level (2 ADRs); full cl-adr-audit deemed disproportionate. |
| 3 dimensions | done 2026-06-10 | 2026-06-10-dimensions.md | 8 dimensions, adversarially filtered. |
| 4 triage | done 2026-06-10 | BACKLOG.md | |
| 5 implement | done 2026-06-11 | PRs #71–#76 | All 6 tickets implemented in isolated worktrees, adversarially refute-verified (all survived round 1), one PR per ticket. T7 remains an operator decision. |
| 6 verification | done 2026-06-11 | (this file) | Post-merge clean-repro green on main @ dadfafe: fresh frozen-lockfile install, tsc 0 errors, 1257 passed / 14 skipped (logger 490, secrets 174, sdk 470, wal 63, events 60), claudemd-check OK. No ADR-anchored tickets, so no scoped cl-adr-audit re-run. |
| 7 next-stage plan | done 2026-06-12 | docs/plans/2026-06-12-next-stage.md | 7 ordered initiatives + deferred-again ledger. Status updates since phase 6: #67 merged (b171141); T7 resolved — sdk 2.0.0 + secrets 0.7.0 published 2026-06-11; the release exposed a structural gate gap (publish bumps versions AFTER check, leaving main red on claudemd-check) — fix-forward PR #82, structural fix is initiative 1. |

## Phase 7 notes (2026-06-12)

### Root cause: how the 2.0.0/0.7.0 publish left main red (Initiative 1 step 4)

Reconstructed from git reflog and npm registry timestamps:

- 21:38:44 ET 2026-06-11 — #67 merged to main (b171141); local main
  fast-forwarded at 21:40:06.
- ~21:44 — operator ran `make publish` from a clean main. The `check`
  prerequisite (incl. claudemd-check) ran against the **pre-bump** tree:
  CLAUDE.md said sdk 1.7.1 / secrets 0.6.0, matching the pre-bump
  package.json files, so the gate was green. The T5 fingerprint stamp
  asserted correctly against that same tree.
- 21:44:22 — `changeset version` produced 2f06d98 ("chore: version
  packages"): package.json 1.7.1→2.0.0 / 0.6.0→0.7.0 plus CHANGELOGs;
  CLAUDE.md untouched — the drift was created at this instant.
- 21:44:36 / 21:44:39 — sdk 2.0.0 and secrets 0.7.0 published (npm
  registry timestamps), 14 seconds after the bump commit: one
  uninterrupted `make publish` invocation. The push left main red on
  claudemd-check until fix-forward #82.

**Verdict: no operator bypass, no direct `pnpm changeset publish` — the
T5 stamp gate worked exactly as built.** The flaw was sequencing: every
gate validated the pre-bump tree, while the published/pushed tree is the
post-bump one, and RELEASING.md explicitly made the CLAUDE.md table sync
a manual post-release step. Every release reproduced the break by
construction.

Fix (Initiative 1 steps 2–3, same PR as this note): the version flow is
now `pnpm run version-packages` (`changeset version` chained with
`scripts/sync-claudemd-versions.mjs`); `make publish` refuses on a dirty
tree or HEAD != origin/main before mutating anything, and re-runs the
full `make check` live against the post-bump tree immediately before
`changeset publish` (`DRY_RUN=1` exercises the gates without npm).

Status sync: T7 resolved 2026-06-11 (operator chose release; sdk 2.0.0 +
secrets 0.7.0 on npm) and PR #67 merged (b171141) — the stale "still
open" mentions in the phase 5/6 notes below are annotated in place;
BACKLOG.md T7 and T5 carry matching status updates.

### Initiative 5 (ADR ledger reconciliation)

- Initiative 5 (ADR ledger reconciliation) merged: ADR-001 Amendment 1
  (passphrase provider), ADR-003 (CI archival + local gates), ADR-002 1.0
  roadmap tickets opened (#98 factory+policy stack, #99 audit sink+HMAC
  [folds #9], #100 SecretsProvider rename + KeyProvider reconciliation
  [folds #8], #101 threat-model doc [inputs #80, #11]; plus #102 op-argv
  key exposure, #103 perf-benchmark baselines). #8 and #9 are flagged for
  the coordinator to close as duplicates of #100/#99. **Scoped re-audit
  DONE (2026-06-23):** the `cl-adr-audit` run scoped to ADR-001 ran (audit →
  adversarial refutation). Both Amendment-1 security claims (the 64 KiB
  hidden-input cap and the deferred-one-tick signal handling) **survive
  refutation and are runtime-verified** — see ADR-001 Amendment 1 →
  "Security-relevant properties — RE-AUDITED (2026-06-23)". Status lifted
  from PENDING RE-AUDIT. One divergence found and deferred: `migrate --to
  passphrase` is unimplemented (#122). The sweep also surfaced two ADR-002
  P0 gaps (before-hook audit gap #120, libsecret D-Bus silent-revert #121).
  #67/T7 are resolved (see the phase-7 table entry).

## Phase 6 notes (2026-06-11)

- All 6 ticket PRs (#71–#76) and the ledger PR (#77) merged by the
  coordinator session. Acceptance criteria are encoded as tests (the
  unhandledRejection traps, the backoffDelay source-grep guard, the
  no-retry-on-parse-failure counts, the sanitization regex scans, the
  claudemd-check drift gate, the publish fingerprint stamp) and all run
  green in the post-merge clean-repro.
- Merge-train incident, found and fixed during shepherding: #71 (jitter
  test with json()-only inline mocks, merged first) and #76 (request()
  reads bodies via response.text(), forked before #71 landed) were each
  green alone but red together — main failed `make check` after f93ecdb.
  Fix-forward PR #78 was opened, then closed as redundant when the
  identical mock fix reached main inside #75's merge commit; #74/#75 were
  refreshed by merge-from-main (no force-push), with #71's source-grep
  guard rewritten on #75 to the equivalent two-part invariant so the
  logged delay is the actual jittered sleep.
- Out-of-pipeline PR #67 (passphrase provider) still open at phase-6
  close — review rounds being shepherded; not part of the backlog.
  *(Resolved: merged b171141, released in secrets 0.7.0 — phase 7 notes.)*
- T7 (release pending changesets) remains the operator decision.
  *(Resolved 2026-06-11: operator chose release — phase 7 notes.)*

## Phase 5 notes (2026-06-11)

- Ticket → PR map (branch `remediate/<ticket-id>`, all `make check` green,
  all survived an independent adversarial refutation before the PR opened):
  - T1 gap-none-sse-run-error-handling (HIGH) → PR #73
  - T2 gap-none-retry-jitter → PR #71
  - T3 gap-none-request-nonjson-2xx → PR #76
  - T4 gap-none-sdk-client-logging → PR #75
  - T5 gap-none-publish-provenance → PR #74
  - T6 gap-none-docs-drift → PR #72
- T7 (pending changesets vs compiled code) is an operator decision — not
  implemented by agents, still open.
  *(Resolved 2026-06-11: released as sdk 2.0.0 + secrets 0.7.0 — phase 7 notes.)*
- Merge policy: mbot is the review gate; the coordinator session merges.
  No PR was merged from the implementing session.
- Note for merge order: T2/T3/T4 all touch packages/sdk/src/client.ts on
  independent branches off main — expect rebases as they land; land T1 (#73)
  first (HIGH severity, touches only events.ts).
- Out-of-pipeline (same session): adopted orphaned PR #67 (passphrase
  key-provider) — empirically disproved the codex recursion claim, found and
  fixed the real swallowed-signal bug + added 64 KiB hidden-input cap
  (commit 895b88d).

## Preflight notes (2026-06-10)

- Baseline: `mv node_modules` aside + `pnpm install` + `make check` — green.
- Last GitHub Actions run on main 2026-03-29; workflows archived to
  `docs/archive/` by cef5ad7 (2026-03-30). Release gating is `make publish`
  (build + check + `npm whoami`), npm 2FA required.
- Incidental: `scripts/release-toolkit/lib/summary.sh:211` integer-expression
  error during `make check` (cosmetic; upstream release-toolkit bug —
  deferred ticket naming that repo).
- Sibling Wave-1 repos not auditable from this session at time of run:
  daemon (in-flight branch `chore/remove-github-ci` + dirty file),
  membrane/test-kit (parked on `claude/p16-agent-docs-sync`).
