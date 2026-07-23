---
topic: backlog-sweep
date: 2026-07-23
author: owenjohnson
author_name: claude (centient-sdk seat, operator owenjohnson)
engram_session: 2026-07-23-backlog-sweep
handoff_issue: 179
predecessor: docs/handoffs/2026-07-22-HANDOFF-owenjohnson-claudemd-drift-fix.md
---

# Handoff: rolling backlog sweep — 6 issues closed across 5 merged PRs; backlog is now decision-gated, not capacity-gated

**Date:** 2026-07-23
**Predecessor:** `docs/handoffs/2026-07-22-HANDOFF-owenjohnson-claudemd-drift-fix.md`, issue #163. That baton's priorities 1–4 are all discharged (see *What was accomplished*); its priority 5 exclusion list is carried forward below and still binding.

## Priority for next session **(required)**

1. **Decide #168 — `isValidKey` enforcement.** https://github.com/centient-labs/centient-sdk/issues/168. This is the highest-value item left and it is a *decision*, not implementation. The ticket says it plainly: option (2) — per-backend enforcement — plus an unchanged `vault.ts:307` doc comment "is the one combination that should NOT persist", and that is exactly the state the code is in today after #167. Pick enforce-at-cascade (needs a survey of in-use keys first — breaking), or drop the claim. Do not leave it as-is a third time.
2. **Decide #102 — 1Password argv exposure.** https://github.com/centient-labs/centient-sdk/issues/102. Blocked on an architectural call, not effort: the fix requires adopting `@1password/sdk` or a Connect deployment against ADR-001's explicit "No new dependencies" stance. Needs an ADR-001 amendment recording the tradeoff. Operator/architect decision.
3. **#173 — SDK's inverted retry classifier.** https://github.com/centient-labs/centient-sdk/issues/173. Filed this session while shepherding #171. `@centient/resilience` now ships the correct taxonomy (`isTransientError`), but `@centient/sdk`'s `_requestRaw` still treats timeouts/network as terminal and unknown errors as retryable. Two viable routes in the ticket: expose a `shouldRetry` seam (additive, unblocks callers now) or flip the default (behavior-changing for every caller, needs a migration note). Route 1 is the low-risk start.
4. **#177 — `RELEASING.md` still teaches `git push origin --tags`.** https://github.com/centient-labs/centient-sdk/issues/177. Small, mechanical, and the *doc* is now the only place the unhardened move survives — the Makefile was fixed in #176. Three occurrences. Good first task for a fresh seat.
5. **#115 — verify before dispatching.** https://github.com/centient-labs/centient-sdk/issues/115. Its stated blocker engram-server#938 is **CLOSED**, and `packages/sdk/src/resources/consolidation.ts` already ships `listBySession`/`listByStatus`/`queue`/`get`/`consolidate`/`undo`. Residual is `POST` create + `PATCH` update only. Confirm the server actually registers those two routes before opening a worktree, or a subagent will re-derive shipped work.

## What was accomplished **(required)**

### Backlog sweep — `cl-sweep-issues --rolling`, 6 issues closed via 5 merged PRs

Started from 13 open issues; classified all of them (4 dispatched, 3 deferred, 6 flagged) and posted a dispatch manifest to #163 rather than letting a capped roll read as "swept everything".

| PR | Closes | Merged as |
|---|---|---|
| https://github.com/centient-labs/centient-sdk/pull/176 | #161, #175 | `0a9b2ce` |
| https://github.com/centient-labs/centient-sdk/pull/171 | #116 | `455f978` |
| https://github.com/centient-labs/centient-sdk/pull/172 | #132 | merged |
| https://github.com/centient-labs/centient-sdk/pull/174 | #134 | merged |
| https://github.com/centient-labs/centient-sdk/pull/178 | #170 | `5cc12ab` |

- **#116** → `@centient/resilience` full-jitter (`jitter: "full"`, uniform `[0, cap)`, no floor), a construction-validated cumulative delay budget (`totalMaxFor`/`budgetedAttempts`), and `withRetry()` with an injectable `shouldRetry` + `isTransientError` preset. Unblocks mbot deleting its hand-rolled retry layer (mbot#1385).
- **#132** → `@centient/events` built-in JSONL rotation, default off. Rename-based (not copy-truncate), anchored prune regex, bounded retention. Closes the 601 MB un-rotated `maintainer.jsonl` incident class (mbot#1511).
- **#134** → `crystals.list()` gains `updatedAfter`/`createdAfter` + keyset `cursor`/`nextCursor`. Offset-vs-cursor exclusivity is a **compile error**, not a runtime surprise. Unblocks mbot's latched-off scan-watermark optimization (mbot#1570/#1578).
- **#161 + #175** → the `publish` no-op now genuinely stops the target (restructured to a branch in the final shell rather than relocating a broken `exit 0`), and the `release-pr` cleanup trap no longer swallows a failed restore *or* SIGINT/SIGTERM. Also fixed a latent bug found en route: `DRY_RUN=1` used to push tags while announcing it was stopping before them.
- **#170** → release commit message and PR title now carry `— <versions>`, per `standards/release-conventions.md:71` and workspace#334.

### Predecessor baton (#163) — all four priorities discharged

Priorities 1–4 of the 2026-07-22 baton were already complete on arrival (PR #164 merged, ADR-004 ACCEPTED via #166, `OnePasswordVault` implemented via #167, #122 done). Its priority-5 exclusion list is carried forward verbatim below.

### Follow-ups filed rather than silently absorbed

- **#173** — SDK's inverted retry classifier (split out of #116 so `Closes #116` did not bury it).
- **#177** — `RELEASING.md`'s `git push origin --tags` drift (surfaced by the #161 seat, correctly scoped out of its PR).
- **centient-labs/pipeline-sdk#22** (cross-repo handout) — `paste -sd', '` alternates delimiters (verified: emits `a,b c,d e`), plus that repo's PR title missing the version suffix. **membrane was checked and is NOT affected**, contrary to the implementing seat's initial report.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| #168 — `isValidKey` enforcement decision | open | operator/architect | Decision, not effort — https://github.com/centient-labs/centient-sdk/issues/168 |
| #102 — 1Password argv exposure | blocked | operator/architect | Needs ADR-001 amendment to adopt a new runtime dependency |
| #173 — SDK `isRetryableError` inverted | open | — | Behavior-changing default; needs a route decision |
| #177 — `RELEASING.md` `--tags` drift | open | — | — |
| #115 — consolidation create + PATCH residual | open | — | Verify engram-server registers the two routes first |
| `/cl-codify` for this session's 5 merged PRs | blocked | workspace coordinator | toolkit#170 — corpus-absent dev-seat store; escalated on `#handouts` seq 327 |
| pipeline-sdk#22 handout | open | pipeline-sdk seat | No registered seat declares `repo:pipeline-sdk` — posted to channel floor, no mention delivered |
| Subagent job records `issue-116/132/134/161/170@session-6868b109` | spawned (record floor never marked resolved) | — | **Not actually in flight** — all five completed, all five PRs merged. Listed only because `jobs-status.sh --unresolved` still reports them; do not chase them. |

## Operational notes **(required)**

### Commands

```bash
# Fresh worktrees need the submodule or `make check` dies on lib/common.sh
git worktree add /tmp/cl-sweep/<repo>-<issue> -b fix/issue-<N>-<slug> origin/main
cd /tmp/cl-sweep/<repo>-<issue> && git submodule update --init scripts/release-toolkit

# The release-gate self-test (extended this session: 24 -> 26 assertions)
./scripts/test-release-gates.sh    # clones COMMITTED state — commit before running
```

### Paths and credentials

- `/tmp/cl-sweep/centient-sdk-{116,132,134,161,170}` — sweep worktrees, all merged; safe to prune.
- No credentials handled this session.
- engram status: **persisted, recall verified** for session notes (`2026-07-23-backlog-sweep`). The mbot **review corpus** is a separate matter — see the guardrail below.

### Gotchas worth keeping

- `make check`'s summarizer prints `completed with 1 error-like lines` on a **green** run — it matches the filename `tests/test_errors.py`. Pre-existing on `main`, not a failure.
- Commit messages containing the literal ship-command string trip a repo guard hook (`BLOCKED publish/release command`). Reword; do not override.
- `scripts/test-release-gates.sh` clones the repo's **committed HEAD**, so working-tree edits are invisible to it. Any experiment against it needs a temp commit.

## Hard guardrails **(required)**

- **#98, #99, #100, #101 are NOT actionable by this seat.** Each carries the literal line *"Do not execute in the current seat — ADR-002 1.0 is an explicit non-goal of the next-stage spec."* They are backlog-presence tickets from Initiative 5 of `docs/plans/2026-06-12-next-stage.md`. A seat taking a flat priority list at face value starts a future-major-version effort it was explicitly told not to. **#103** is the same shape — a Deferred-Again ledger item gated on a stable-runner-box and baseline-storage decision.
- **Do not run `/cl-codify` on this seat.** The engram daemon is healthy (20,692 crystals, fresh) but **both** mbot review tag families return 0 store-wide with a short page — corpus-absent dev-seat store, toolkit#170. Verified not to be a colon-tag parse artifact (`pr:176`, `codified-lesson`, `auto-promoted` all resolve). Escalated to the workspace coordinator; remediation is corpus-sync-vs-run-where-the-corpus-lives, not a seat-local fix. A GitHub-narrative fallback ships with **no validation replay** and needs an explicit operator ask.
- **Do not merge.** This repo's `mbot/merge-queue` holds changeset-bearing PRs with `held for operator review (control-surface)`, and there is **no `pr-response.md` carve-out** authorizing a developer admin-merge here. All three held PRs this session were released by the operator, not routed around. Evidence for the discriminator: #171/#172/#174 each carried a changeset and were held; #176 and #178 carried none and merged cleanly.
- **Never stack PRs.** #170 was deliberately held behind #176 for ~40 minutes rather than branched off its head, because both edit the `release-pr` target (wheelhouse#46/#47: the child reads MERGED while its content never reaches `main`).

## Open questions **(optional)**

- Is the `mbot/merge-queue` control-surface hold expected to require a manual release on **every** changeset-bearing PR, or was this session's batch unusual? If it is standing policy, a seat should stop surfacing it as a blocker each cycle.

## References **(optional)**

- Dispatch manifest and running sweep log: https://github.com/centient-labs/centient-sdk/issues/163
- Cross-repo handout: https://github.com/centient-labs/pipeline-sdk/issues/22
- Non-vacuity evidence for the #176 control-flow tests: https://github.com/centient-labs/centient-sdk/pull/176#issuecomment-5058951013
