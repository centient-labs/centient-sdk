---
topic: claudemd-drift-fix
date: 2026-07-22
author: owenjohnson
author_name: claude (centient-sdk seat, operator owenjohnson)
engram_session: 2026-07-22-claudemd-drift-fix
handoff_issue: 163
predecessor: docs/handoffs/2026-07-07-HANDOFF-claudemd-drift-fix.md
---

# Handoff: #122 `migrate --to passphrase` shipped to READY (PR #164, held on operator); ADR-004 still the gate on everything else

**Date:** 2026-07-22
**Predecessor:** `docs/handoffs/2026-07-07-HANDOFF-claudemd-drift-fix.md`, issue #152 (closed on pickup). Successor r0 issue: #163 (this baton reuses it).

## Priority for next session **(required)**

1. **Clear the merge-queue hold on PR #164** — https://github.com/centient-labs/centient-sdk/pull/164 is **READY**: mbot APPROVED at head `4e1e9f8`, round 3, zero findings. The only thing blocking merge is the `mbot/merge-queue` check sitting **PENDING** with `held for operator review (control-surface)`. **Operator action.** Nothing is left for a dev seat but to watch it merge — after which run `/cl-codify 164` (two legitimate HIGH rounds in one error-handling class is exactly the material the codifier exists for).
2. **ACCEPT or revise ADR-004** — `docs/adr/004-1password-credential-backend.md` is still **Status: Proposed** (dated 2026-06-24). Operator architectural decision; the mbot ✅ on PR #125 was doc-quality only, not acceptance. If accepted, flip the header to `Status: Accepted` + date in a quick doc PR. **This is the gate on priorities 3 and 5b** — it is the single highest-leverage decision outstanding in this repo.
3. **Implement `OnePasswordVault`** — scope per the 2026-06-27 handoff. **Gated on Priority 2.**
4. ~~**#122** `migrate --to passphrase`~~ — **DONE this session**, riding PR #164 (see Priority 1). No design work remains.
5. **The rest of the backlog — read this before picking anything up.** Verified 2026-07-22 by reading the ticket bodies, because prior batons carried these as a flat priority list and that is misleading:
   - **#98, #99, #100, #101 are NOT actionable by this seat.** Each carries the literal line *"Do not execute in the current seat — ADR-002 1.0 is an explicit non-goal of the next-stage spec."* They are backlog-presence tracking tickets opened by Initiative 5 of `docs/plans/2026-06-12-next-stage.md`, not work items. A seat that takes the old baton at face value starts a future-major-version effort it was explicitly told not to.
   - **#103** — perf baselines for the 14 `PERF_TESTS`-gated benchmarks. No execution gate. **This is the only unblocked engineering work left in this repo's backlog.**
   - **#102** — `op item create/edit` leaks the vault key hex to `ps` via argv. No execution gate of its own, but the fix *is* the ADR-004 stdin pattern, so it is effectively **gated on Priority 2**.

   Net: until ADR-004 is decided, **#103 is the only thing a dev seat can start.**

## What was accomplished **(required)**

### #122 — `migrate --to passphrase` implemented (PR #164, READY)

Closes the ADR-001 Amendment 1 deferral. The amendment committed that migration *to* passphrase must route through `setupKey()`, then deferred it because a `PassphraseProvider` derives its key from what the operator types and `storeKey()` returns `false` by contract — so the vault has to be re-encrypted, which the provider-only migrate step did not do.

- **`migrate` now branches on what the target provider can do:** *key move* for `keychain`/`1password` (same master key relocated, vault file untouched — unchanged behaviour) vs *rekey* for `passphrase`.
- **New public `rekeyVault()`** in `packages/secrets/src/vault/session-vault.ts`. The format knowledge stays with the vault module rather than being open-coded in the CLI, so the two entry points that must agree on what is on disk cannot drift.
- **The `commit` seam** — `rekeyVault` writes the new ciphertext atomically, runs the caller's commit (the CLI's `secrets.provider` write) while still holding the write lock and *before* publishing the sidecar bump, and restores the prior ciphertext byte-for-byte if it throws. "Config names a provider that cannot open the vault" is not a reachable state in either direction.
- **Rollback / missing-sidecar refusal added mid-implementation** after noticing the first draft was strictly *weaker* than `openVault()`: a rekey that accepted a rolled-back vault would re-publish stale secrets at a fresh version and launder the rollback past every later check. Now mirrors `openVault` with the same legacy carve-out, plus `acceptRollback` / `acceptMissingSidecar`.
- Legacy AAD-less vaults are upgraded to schema 1 in the same step.

### Two review rounds, both legitimate HIGHs in one error-handling class

Each was a genuinely distinct window — the bot was not looping. Both are the same failure shape: *a rekey that is actually committed gets reported as failed, and the CLI's cleanup then deletes the passphrase metadata — the salt the vault now depends on — bricking it.*

- **R1 (fixed in `1ab4b11`):** a `writeSidecar` failure **after** `commit` succeeded threw. Fix: the sidecar publish no longer throws; it returns `sidecarPublished: false` with a stderr warning (a lagging sidecar is the benign direction and self-heals on the next open — the same asymmetry `writeOp` already relies on). The CLI additionally records whether the config write landed and keeps the metadata if it did.
- **R2 (fixed in `4e1e9f8`):** `commit` throws **and** the rollback write also fails, so the new ciphertext may still be on disk while the CLI sees `configWritten=false`. Fix: new **`VaultRestoreError`** (`code: VAULT_RESTORE_FAILED`) carrying `commitCause` / `restoreCause` / `attemptedVersion`; the CLI special-cases it and keeps the metadata.
- The **post-commit guarantee** on `rekeyVault` is now documented *with* its one exception rather than being quietly untrue: a throw means nothing was committed, **except** `VaultRestoreError`.

### Verification

`257` tests pass in `packages/secrets` (up from 252) — 14 filesystem-level `rekeyVault` cases including **two fault injections** (a sidecar-write failure after commit, and a restore-rename failure), plus 13 CLI cases. `tsc --noEmit` clean, `pnpm build` 11/11, `pnpm test` 22/22, `./scripts/check-claudemd-versions.sh` green.

**Not verified:** no end-to-end run against a real interactive TTY passphrase prompt (the derive path itself is covered by the existing `passphrase-provider` suite). Cross-process behaviour — another process holding the vault open under the old key — is documented as an honest `VaultDecryptError` but is not covered by a test.

### Housekeeping

- `.agent/handoff-draft.md` added to `.gitignore` (rides PR #164). It is the local running handoff draft and must never be committed.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| PR #164 (#122) | **READY** — mbot APPROVED @ `4e1e9f8`, 0 findings | merger | `mbot/merge-queue` PENDING: "held for operator review (control-surface)" — https://github.com/centient-labs/centient-sdk/pull/164 |
| `/cl-codify 164` | not run | next seat | gated on #164 merging |
| ADR-004 accept/revise | open | **operator** | architectural decision is the operator's |
| `OnePasswordVault` | open | next seat | gated on ADR-004 |
| #102 `op` argv leak | open | next seat | gated on ADR-004 (its stdin pattern is the fix) |
| #103 perf baselines | open, **unblocked** | next seat | none — the only unblocked engineering work in the backlog |
| ADR-002 pillars #98 / #99 / #100 / #101 | open, **not for this seat** | future major-version effort | tickets say "Do not execute in the current seat" |

## Operational notes **(required)**

- **`CLAUDE.md` is a symlink to `AGENTS.md`.** Writes through `CLAUDE.md` land in `AGENTS.md`; diffs surface as `AGENTS.md`. Tooling that greps a diff for `CLAUDE.md` needs to accept both.
- Do **not** hand-edit the resource count in `CLAUDE.md` — `pnpm run version-packages` / `scripts/sync-claudemd-versions.mjs` owns it.
- **Shepherd wake mode is `poll` in this repo.** Both ADR-003 gates fail: no `review.landed`/`pr.merged` producers on `repo:centient-sdk` (G1=no) and `cl comms-watch` is not healthy on this machine (W=no). Expect `ScheduleWakeup` polling, not event injection.
- **No `.agent/procedures/pr-response.md` in this repo** — so the shepherd default applies: fix every flagged finding; there is no admin-merge carve-out to invoke.

```bash
./scripts/check-claudemd-versions.sh    # docs drift gate
node scripts/sync-claudemd-versions.mjs # repairs drift in place
./scripts/test-release-gates.sh         # release-gate self-test (clones committed HEAD — commit first)
cd packages/secrets && npx vitest run   # 257 tests
```

- engram status: **persisted, recall verified** — session `2026-07-22-claudemd-drift-fix`; 2 notes saved via MCP `save_session_note` (the #122 design decision, and the backlog-gating finding), both returned `saved: true` with `coherence: valid`.

## Hard guardrails **(required)**

- **Publish is operator-only** (agent-side hook blocks it). Nothing in this lane is publishable — #164 carries a changeset; the version bump happens at release time.
- **Never push `main`**; all changes ride PRs.
- **Do not merge #164 yourself.** The `mbot/merge-queue` hold is a deliberate control-surface gate, and this repo has no `pr-response.md` carve-out authorizing a developer admin-merge.
- **Do not start #98 / #99 / #100 / #101** — see Priority 5.

## Open questions **(optional)**

- What made #164 trip the merge-queue's **control-surface** classifier? Plausibly the `@centient/secrets` key-material surface, but the check gives no reason string. Worth knowing, because every future secrets-package PR will presumably hit the same hold.

## References **(optional)**

- PR: https://github.com/centient-labs/centient-sdk/pull/164 (closes https://github.com/centient-labs/centient-sdk/issues/122)
- Issues: https://github.com/centient-labs/centient-sdk/issues/102, https://github.com/centient-labs/centient-sdk/issues/103
- ADRs: `docs/adr/001-key-provider-abstraction.md` (Amendment 1, updated by #164), `docs/adr/004-1password-credential-backend.md` (still Proposed)
- Docs: `packages/secrets/docs/session-vault.md` (`rekeyVault` section added by #164)
- Prior handoff: `docs/handoffs/2026-07-07-HANDOFF-claudemd-drift-fix.md`
