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
- T7 (release pending changesets) remains the operator decision.

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
