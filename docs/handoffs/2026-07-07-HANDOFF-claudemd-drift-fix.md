---
topic: claudemd-drift-fix
date: 2026-07-07
author: claude (operator: owenjohnson)
engram_session: null
handoff_issue: 152
predecessor: docs/handoffs/2026-07-06-HANDOFF-post-wave-followups.md
---

# Handoff: CLAUDE.md resource-count drift fixed + auto-synced; sdk 2.3.0 publish still PENDING (gate blocked it); post-wave priorities carried

**Date:** 2026-07-07
**Predecessor:** `docs/handoffs/2026-07-06-HANDOFF-post-wave-followups.md` — its baton was already resumed in an earlier session (no open handoff issue remained). This session was a short unrelated lane: the 2.3.0 publish aftermath. The predecessor's priorities were **not advanced** and carry forward verbatim below.

## Priority for next session **(required)**

1. **Ship `@centient/sdk@2.3.0` — it is NOT on the registry.** The 2026-07-07 publish run was blocked BEFORE `changeset publish` by the claudemd-check drift (`make check` gates the ship step; the `OK ... (2.3.0)` lines in the publish output were the docs-gate version table, not publish confirmations — verified 2026-07-07: `npm view @centient/sdk versions` tops out at 2.2.0). Path: merge https://github.com/centient-labs/centient-sdk/pull/151 (fix for #150, APPROVED/Ready round 1, handed to merger), pull `main`, then the **operator** re-runs `make publish` (agent hooks block publish, correctly). Downstream repos waiting on 2.3.0 are blocked until this lands.
2. **ACCEPT or revise ADR-004** (carried, untouched) — `docs/adr/004-1password-credential-backend.md` is still **Status: Proposed**. Operator decision; if accepted, flip the header to `Status: Accepted` + date in a quick doc PR.
3. **Implement `OnePasswordVault`** (carried, untouched) — scope per the 2026-06-27 handoff. **Gated on Priority 2.**
4. **#122** `migrate --to passphrase` (carried) — https://github.com/centient-labs/centient-sdk/issues/122
5. **ADR-002 1.0 pillars** (carried) — #98, #99, #100, #101, #103; #102's argv-leak class is addressed by the ADR-004 stdin pattern when implemented.

## What was accomplished **(required)**

### 2.3.0 publish + docs-gate drift (this session)

- `make publish` (operator-run) was **blocked before shipping anything**: the registry preflight found 10/11 packages already published and only `@centient/sdk@2.3.0` pending, then `make check`'s `claudemd-check` gate failed on resource-count drift (CLAUDE.md claimed 33 vs 34 actual — `InvitationsResource` from https://github.com/centient-labs/centient-sdk/pull/148 uncounted), so `changeset publish` never ran. **2.3.0 is still unpublished** (registry verified same day).
- Filed https://github.com/centient-labs/centient-sdk/issues/150 (symptom + root cause: the count was hand-maintained while the check guarded it).
- Fixed via https://github.com/centient-labs/centient-sdk/pull/151 — count bumped 33→34 (+ `invitations` mentioned in the sdk row), `scripts/sync-claudemd-versions.mjs` now derives the count from `packages/sdk/src/resources/` (same rule as the check script, fails loudly on missing claim or zero count), new release-gate self-test for count drift + repair, and fixes for the latent CLAUDE.md→AGENTS.md symlink bugs in `scripts/test-release-gates.sh` (restores and the version-flow diff assertion). Verified: `./scripts/test-release-gates.sh` **15/15 passed** (was 14/15 on main due to the symlink assertion).
- mbot verdict: **Ready, zero findings, round 1**; handed to the merger.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| PR #151 (closes #150) merge | in-review — APPROVED/Ready, awaiting merger | merger | — |
| Re-run `make publish` to ship `@centient/sdk@2.3.0` (NOT on registry) | blocked | operator | PR #151 must merge first |
| This handoff's own docs PR | in-review | merger | — |
| ADR-004 accept/revise + OnePasswordVault + #122 + ADR-002 pillars | open (carried from predecessor, untouched) | next seat | ADR-004 decision is the operator's |

## Operational notes **(required)**

### Commands

```bash
./scripts/check-claudemd-versions.sh   # docs drift gate (now covers resource count mechanically)
node scripts/sync-claudemd-versions.mjs # repairs version + resource-count drift in place
./scripts/test-release-gates.sh        # release-gate self-test (clones committed HEAD — commit first)
```

### Paths and gotchas

- **CLAUDE.md is a symlink to AGENTS.md** (since 2026-07-04). Writes through `CLAUDE.md` land in `AGENTS.md`; `git checkout -- CLAUDE.md` alone does NOT restore mutated content, and diffs surface as `AGENTS.md`. Any tooling that greps a diff for `CLAUDE.md` needs to accept both.
- engram status: **persisted, recall verified** — 2/2 notes saved via REST fallback (`POST /v1/crystals`, both 201) and the keyword probe on `claudemd-drift-fix` returns both. MCP session coordination was not started this session, hence `engram_session: null`. Deep recall for the carried priorities lives under topic `post-wave-followups` (5 notes).

## Hard guardrails **(required)**

- **Publish is operator-only** (agent-side hook blocks it, intentional post the persona-sdk incident). The re-run of `make publish` to ship 2.3.0 must happen from a clean checkout of `main` **after** PR #151 merges — the recipe refuses on dirty tree / HEAD != origin/main, and check must be green on that exact tree.
- Never push `main`; both in-flight changes ride PRs (branch `fix/claudemd-resource-count-sync`, branch `docs/handoff-claudemd-drift-fix`).
- Do not hand-edit the resource count in CLAUDE.md going forward — `pnpm run version-packages` / the sync script owns it now.

## References **(optional)**

- Issues: https://github.com/centient-labs/centient-sdk/issues/150, https://github.com/centient-labs/centient-sdk/issues/122
- PRs: https://github.com/centient-labs/centient-sdk/pull/151, https://github.com/centient-labs/centient-sdk/pull/148
- Prior handoffs: docs/handoffs/2026-07-06-HANDOFF-post-wave-followups.md
