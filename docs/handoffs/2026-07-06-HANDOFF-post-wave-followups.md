---
topic: post-wave-followups
date: 2026-07-06
author: claude (operator: owenjohnson)
engram_session: 2026-07-06-post-wave-followups
handoff_issue: 140
predecessor: docs/handoffs/2026-06-27-HANDOFF-post-wave-followups.md
---

# Handoff: Post-wave follow-ups — SDK↔engram alignment shipped (2.2.0); ADR-004/secrets chain still open

**Date:** 2026-07-06
**Predecessor:** `docs/handoffs/2026-06-27-HANDOFF-post-wave-followups.md` — its baton (#126) was resumed this session as "resume + do both": the operator made SDK↔engram-server alignment the active task; the predecessor's ADR-004/secrets priorities were adopted but **not advanced** — they carry forward verbatim below.

## Priority for next session **(required)**

1. **ACCEPT or revise ADR-004** (carried, untouched) — `docs/adr/004-1password-credential-backend.md` is still **Status: Proposed**. Operator decision; if accepted, flip the header to `Status: Accepted` + date in a quick doc PR.
2. **Implement `OnePasswordVault`** (carried, untouched) — scope per the 2026-06-27 handoff: new `VaultBackend` + shared `op` helper + `secrets.backend`/`secrets.onePasswordBackend` config seam (vault required/no-default/fail-closed) + stdin-JSON write + opt-in integration test. **Gated on Priority 1.**
3. **centient migration follow-through** — the SDK side of the alignment chain is DONE and signaled (https://github.com/centient-labs/centient/issues/458#issuecomment-4896038588). The centient-repo migration off `asInternal()` (bump to `^2.2.0`) is now unblocked; needs a centient-repo seat, not this one. Watch for questions coming back on the two re-map tools (`review_consolidation`, `promote_to_crystal` — no public equivalents by server design, engram #938).
4. **#122** `migrate --to passphrase` (carried) — https://github.com/centient-labs/centient-sdk/issues/122
5. **ADR-002 1.0 pillars** (carried) — #98, #99, #100, #101, #103; #102's argv-leak class is addressed by the ADR-004 stdin pattern when implemented.
6. **Optional compound step** — `/cl-codify 137` and `/cl-codify 138`: both PRs took exactly one mbot Iterate round; recurring finding classes were (a) nested-object response fields not shape-guarded before cast, (b) query params serialized without their semantic prerequisite, (c) runtime guards missing for TS-bypassing callers. Worth codifying into the repo's auto-loaded tier.

## What was accomplished **(required)**

All of this session's work is the **SDK↔engram-server alignment chain** (engram → centient-sdk → centient, gating centient 1.0.0):

- **Issue #135 reviewed + corrected** — verified the coverage audit, found its blocker stale: engram-server **0.41.0** (#938/#939) had already shipped the public `/v1` consolidation surface (server main 0.49.1). Findings comment: https://github.com/centient-labs/centient-sdk/issues/135#issuecomment-4895439219
- **PR #137 merged** (closes #135): https://github.com/centient-labs/centient-sdk/pull/137 — new `client.consolidationEvents` (`listBySession`/`listByStatus`/`get`/`consolidate` dry-run|live/`undo`; strict shape guards incl. nested `promotionAdvisory`; pagination `total`/`hasMore` validated as required contract fields per server source) + README engram-server compatibility table (floor 0.31.0; consolidationEvents >= 0.41.0; tested upper edge 0.47.0). 644 tests. One mbot round (4 findings fixed).
- **Issue #136 verified + PR #138 merged** (closes #136): https://github.com/centient-labs/centient-sdk/pull/138 — `CrystalVersionConflictError.currentVersion` now read from `error.details.currentVersion` (real 409 envelope; was top-level → always NaN) with top-level fallback; `crystals.list` gains `tagsMatch: 'any'|'all'` + `typeMetadata` containment (wire param `metadataContains`, JSON-stringified; **list-only** — search's body schema doesn't accept them); runtime plain-object guard on `typeMetadata` (throws `VALIDATION_INPUT_INVALID`); apiKey-omission doc note for no-auth daemons. One mbot round (3 findings fixed; one was already structurally satisfied, pinned by a dts-surface test).
- **Release PR #139 merged** + **published by operator**: `@centient/sdk` **2.2.0**, `@centient/secrets` **0.9.0** (the secrets bump carried the pending #124 changeset). Verified live on npm.
- **Readiness signal posted on centient#458** (operator-authorized): 10 endpoints migratable since 2.1.0, consolidation family in 2.2.0, the two re-map caveats, and the CAS/filter fixes.
- Implementation was done by two Opus subagents in isolated worktrees, both PRs shepherded through mbot by the session loop.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| Accept/revise ADR-004 | open — operator decision | owen | — |
| Implement `OnePasswordVault` | open | — | gated on ADR-004 acceptance |
| centient migration off `asInternal` (^2.2.0) | unblocked, signaled | centient-repo seat | https://github.com/centient-labs/centient/issues/458 |
| `review_consolidation`/`promote_to_crystal` re-mapping design | open (centient side) | — | server excludes old endpoints by design (engram #938) |
| #122 migrate --to passphrase | open (deferred) | — | https://github.com/centient-labs/centient-sdk/issues/122 |
| ADR-002 1.0 pillars #98–#101, #103 | open | — | design work |
| /cl-codify 137 + 138 | optional | — | — |

## Operational notes **(required)**

### Commands
```bash
cd packages/sdk && npx vitest run        # 644 tests; npx tsc --noEmit
make release-pr                          # needs scripts/release-toolkit submodule INITIALIZED
                                         # (git submodule update --init scripts/release-toolkit — it was uninitialized this session)
make publish                             # OPERATOR-ONLY (this session's standing rule); preflights npm whoami
```

### Paths
- `packages/sdk/src/resources/consolidation.ts` + `types/consolidation.ts` — the new resource.
- engram-server repo read-only at the workspace checkout at `<workspace-root>/00platform/engram-server` (remote: https://github.com/centient-labs/engram-server) (`git show origin/main:apps/engram/src/server/routes/consolidation.ts` for the wire contract).
- No secrets handled this session.

### engram status
- Session id `2026-07-06-post-wave-followups`. **engram persist VERIFIED by id, search-degraded**: `finalize_session_coordination` promoted 4/4 notes to crystals (ids `c8e92cd8…`, `b4c58a1d…`, `5c2a6e72…`, `ec2936fb…`; direct `get_crystal` reads succeed), **but every promoted crystal has `embeddingStatus: "failed"`** — semantic search cannot rank them and the keyword read-probe did not surface them either (it returned only mbot review-request crystals). Recall of this session's knowledge is therefore **id-reachable but search-cold**.
- **Recall was also COLD at pickup** this morning: `search_crystals` and `load_session` (project `centient-sdk`, session `2026-06-22-post-wave-followups`) returned empty despite the hook reporting 5 notes. Taken together with the embedding failures above, the likely root cause is the store's **embedding pipeline failing on crystal promotion** (not a project-scoping bug) — worth filing against engram-server if it reproduces next session.

### Review-loop lessons (non-obvious, this session)
- A background subagent can complete its Task "successfully" after ~10s with **zero tool calls** (dud launch) — check the result body, not the status; a SendMessage resume re-runs it.
- A **resumed** subagent may lose its worktree isolation and work in the shared checkout — after any resume, check `git status` at the repo root before assuming the tree is clean; instruct resumed agents to `git worktree add` explicitly.
- Squash-merged PR branches need `git branch -D` (not `-d`) locally; content is on main under different SHAs.
- mbot cadence this session: reviews landed ~3 min after push; 240s poll caught every verdict; both PRs went Iterate→fix→Ready in exactly one round.

## Hard guardrails **(required)**

- **Never self-merge / push main / admin-merge from this seat** — mbot gates, the coordinator merges (all 3 PRs this session went through that gate).
- **`make publish` is OPERATOR-ONLY** (explicit operator rule 2026-07-06); agent runs `make release-pr` at most.
- **Never bump versions manually** — changesets + `make release-pr` (it also syncs the CLAUDE.md table).
- **Zero EXTERNAL runtime deps** per `@centient` package.
- **ADR-004 implementation MUST pass secret values via stdin, never argv** (carried; the #102 fix class).
- **No stacked PRs org-wide** (operator rule 2026-07-05) — every PR branches from main; sequential lanes when order matters.

## Open questions **(optional)**

- Does the operator accept ADR-004 as designed? (Carried from 2026-06-27 — still the gate on priorities 1–2.)
- The engram recall-cold-at-pickup mismatch (hook says 5 notes; search/load return empty) — store defect, project-name scoping (`centient-sdk` vs path-derived), or hook overcounting?

## References **(optional)**

- Issues: #135 (closed by #137), #136 (closed by #138), centient#458 (signaled); carried: #122, #98–#103
- PRs: #137, #138, #139 (all merged); npm: @centient/sdk@2.2.0, @centient/secrets@0.9.0
- engram-server: 0.41.0 shipped #938/#939 (public consolidation surface); main at 0.49.1
- Prior handoff: `docs/handoffs/2026-06-27-HANDOFF-post-wave-followups.md`
