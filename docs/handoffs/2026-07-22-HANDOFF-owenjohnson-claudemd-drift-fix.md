---
topic: claudemd-drift-fix
date: 2026-07-22
author: owenjohnson
author_name: claude (centient-sdk seat, operator owenjohnson)
engram_session: 2026-07-22-claudemd-drift-fix-r2
handoff_issue: 163
predecessor: docs/handoffs/2026-07-07-HANDOFF-claudemd-drift-fix.md
---

# Handoff: ADR-004 accepted and implemented; #122 + OnePasswordVault shipped. Next: #102 (the seam now exists), then the #168 decision

**Date:** 2026-07-22 (final update — four PRs merged this session)
**Predecessor:** `docs/handoffs/2026-07-07-HANDOFF-claudemd-drift-fix.md`, issue #152. Successor r0 issue: #163, reused throughout — never a second issue.

## Priority for next session **(required)**

1. **#102 — retrofit `OnePasswordProvider` to stdin.** https://github.com/centient-labs/centient-sdk/issues/102 — `createItem`/`updateItem` still pass the vault key hex in **argv**, so it is visible in `ps` for the life of the call. This was gated on ADR-004 and is now **fully unblocked**: the ADR is Accepted, and #167 built the exact seam the fix needs — `runOp(args, { input })` in `key-providers/op-cli.ts`, already proven by `OnePasswordVault.store`. Copy that pattern: build the item JSON in-process, pipe to `op item create -`, model update as delete-then-create so both writes share the one argv-safe path. **Highest-value unblocked work in the repo** — it closes a real key leak and the design question is already settled.
2. **#168 — decide the `isValidKey` enforcement question.** https://github.com/centient-labs/centient-sdk/issues/168 (filed this session). `vault.ts:307` documents that credential keys must match `isValidKey`; the write path never calls it. #167 enforced it at the `OnePasswordVault` boundary only. The issue lays out three options; the one combination that must **not** persist is the current state — per-backend enforcement plus a `vault.ts` comment still promising cascade-wide enforcement, which is exactly how the gap survived unnoticed. Cascade-wide enforcement needs a survey of what real consumers store first, so this is a decision with a migration attached.
3. **#103 — perf baselines** for the 14 `PERF_TESTS`-gated benchmarks. No execution gate, no dependencies. https://github.com/centient-labs/centient-sdk/issues/103
4. **Codify debt — blocked on infrastructure, not on this repo.** `/cl-codify` could not run for **#164, #166, or #167**: this dev seat's engram store holds **zero** mbot review crystals (toolkit#170 — the corpus is Studio-localhost-only). Diagnosed, not assumed: the daemon is healthy (20,686 crystals, minutes fresh) while both review tag families return `total: 0` store-wide, uniformly across all eras. #164's two HIGH rounds and #167's api-contracts MEDIUM are exactly the material a standing rule should capture, and that capture is unavailable here. Remediation is coordinator-owned (corpus sync vs. running codify where the corpus lives).
5. **ADR-002 pillars #98 / #99 / #100 / #101 — NOT for this seat.** Each carries the literal line *"Do not execute in the current seat — ADR-002 1.0 is an explicit non-goal of the next-stage spec."* They are backlog-presence trackers, not work items. Earlier batons listed them as a flat priority without that qualifier, which is how a seat ends up starting a future-major-version effort it was told not to.

## What was accomplished **(required)**

Four PRs merged: **#164** (#122), **#165** (baton), **#166** (ADR-004 accepted), **#167** (OnePasswordVault).

### #122 — `migrate --to passphrase` (PR #164)

Closed the ADR-001 Amendment 1 deferral. `migrate` now branches on what the target provider can do: **key move** for `keychain`/`1password` (unchanged) vs **rekey** for `passphrase` — a `PassphraseProvider` derives its key and `storeKey()` returns `false` by contract, so the ciphertext must be rewritten. New public **`rekeyVault()`** in `vault/session-vault.ts` with a **`commit` seam**: it writes the new ciphertext atomically, runs the caller's commitment (the CLI's `secrets.provider` write) while still holding the write lock, and restores the prior ciphertext byte-for-byte if that throws.

**Two review rounds, both legitimate HIGHs in one class** — a committed rekey being *reported* as failed, which lets the caller's cleanup destroy key material the vault now depends on:

- *R1:* `writeSidecar` failing **after** `commit` succeeded threw → the CLI deleted the passphrase metadata (the salt). Fix: the sidecar publish no longer throws; it returns `sidecarPublished: false` with a warning. A lagging sidecar self-heals on the next open.
- *R2:* `commit` throws **and** the rollback write also fails → the new ciphertext may still be on disk. Fix: `VaultRestoreError` (`code: VAULT_RESTORE_FAILED`) carrying both causes; the CLI special-cases it on `err.code` — not `instanceof`, which would not survive module mocking or re-wrapping, and a false negative here destroys key material — and keeps the metadata.

### ADR-004 accepted + implemented (PRs #166, #167)

`docs/adr/004-1password-credential-backend.md` is **Accepted** (operator, 2026-07-22), recorded as a separate `**Accepted:**` field so the proposed-to-accepted gap stays visible rather than being erased.

**`OnePasswordVault`** stores credential *values* in 1Password — a distinct layer from ADR-001's `OnePasswordProvider` (the encryption *key*), with independent config blocks. Two properties, each pinned by tests that assert the mechanism rather than just the outcome:

- **Never auto-selected** — outside the auto-cascade entirely; `detect(optedIn)` refuses without opt-in and does not even probe. An explicit choice **fails closed**: a missing vault name, an unavailable `op`, or an unknown backend name all throw rather than substituting.
- **Values never touch argv** — item JSON built in-process and piped to `op item create -`; update is delete-then-create so both writes share one argv-safe path. The test asserts the value is absent from *every* argv element and present in stdin.

Plus: shared `op-cli.ts` helper (`detectOpCli`/`runOp`/`OpCliError`), `"1password"` in `VaultType`, and a names-only list cache — values are never cached, since that would both hold plaintext in the heap for the TTL and serve a rotated credential until expiry.

**Three review rounds on #167.** R1 was not a review at all: the ADR-006 deterministic secret gate blocked the diff before it reached the model (synthetic `sk-`-prefixed test fixtures). Fixed rather than argued — "it's only a fixture" is the argument that eventually trains a scanner to be ignored. R2 was the first substantive pass: one MEDIUM, keys containing `/` stored but unreadable through the path-structured `op://` reference. Fixed by **enforcing** the constraint ADR-004 §3 already assumed rather than encoding around it, because encoding would make the stored title differ from the key and break `listKeys`. R3: ✅ Ready, zero findings.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| This baton's own PR | open | next seat | none — nothing depends on it |
| #102 `op` argv leak | open, **unblocked** | next seat | none — ADR-004 accepted and the `runOp` stdin seam exists |
| #168 `isValidKey` enforcement | open, needs a decision | architect/operator | needs a consumer-key survey before cascade-wide enforcement |
| #103 perf baselines | open, **unblocked** | next seat | none |
| Codify of #164 / #166 / #167 | blocked | coordinator | toolkit#170 — no mbot review corpus on this seat |
| ADR-002 pillars #98–#101 | open, **not for this seat** | future major version | tickets say "Do not execute in the current seat" |

## Operational notes **(required)**

- **`CLAUDE.md` is a symlink to `AGENTS.md`.** Writes through `CLAUDE.md` land in `AGENTS.md`; diffs surface as `AGENTS.md`.
- Do **not** hand-edit the resource count in `CLAUDE.md` — `scripts/sync-claudemd-versions.mjs` owns it.
- **Shepherd wake mode is `poll` here.** Both ADR-003 gates fail: no `review.landed`/`pr.merged` producers on `repo:centient-sdk`, and `cl comms-watch` is not healthy on this machine. Expect `ScheduleWakeup` polling, not event injection.
- **No `.agent/procedures/pr-response.md`** in this repo — the shepherd default applies (fix every flagged finding; there is no admin-merge carve-out to invoke).
- **The merge-queue holds are routine here, and they cleared in a batch.** #164/#166/#167 each sat PENDING on `mbot/merge-queue` — `held for operator review`, reason `control-surface` for the code PRs and `docs-only` for the ADR flip — then all merged within seconds of each other. Budget for an operator gate on every `@centient/secrets` PR rather than treating a hold as a problem.
- engram: session `2026-07-22-claudemd-drift-fix-r2`. The `-r1` slug was finalized earlier in the same session, so the `-rN` suffix is the documented same-day collision guard, not a typo.

```bash
./scripts/check-claudemd-versions.sh          # docs drift gate
node scripts/sync-claudemd-versions.mjs       # repairs drift in place
cd packages/secrets && npx vitest run         # 290 tests
```

## Hard guardrails **(required)**

- **Publish is operator-only** (an agent-side hook blocks it). Two changesets are staged and unreleased — one for the rekey work, one for `OnePasswordVault`; the version bump happens at release time, never by hand.
- **Never push `main`**; all changes ride PRs.
- **Do not start #98 / #99 / #100 / #101** — see Priority 5.
- **Nothing in this repo runs against a real `op` binary.** `runOp`/`detectOpCli` are mocked at that seam, so the JSON shape `op item create -` accepts, and the stderr wording the `isNotFound` classifier matches, are taken from the ADR rather than a live CLI. Verify both against the pinned `op` version before relying on them — especially while doing #102, which touches the same surface.

## Open questions **(optional)**

- Does every `@centient/secrets` PR trip the merge-queue's **control-surface** classifier? Three of four this session were held and the check surfaces no reason string. If it keys on the package path, that is a permanent operator gate on this package and worth knowing in advance rather than rediscovering per PR.

## References **(optional)**

- Merged: [#164](https://github.com/centient-labs/centient-sdk/pull/164), [#165](https://github.com/centient-labs/centient-sdk/pull/165), [#166](https://github.com/centient-labs/centient-sdk/pull/166), [#167](https://github.com/centient-labs/centient-sdk/pull/167)
- Open: [#102](https://github.com/centient-labs/centient-sdk/issues/102), [#103](https://github.com/centient-labs/centient-sdk/issues/103), [#168](https://github.com/centient-labs/centient-sdk/issues/168)
- ADRs: `docs/adr/001-key-provider-abstraction.md` (Amendment 1, fulfilled by #164), `docs/adr/004-1password-credential-backend.md` (Accepted, implemented by #167)
- Docs: `packages/secrets/README.md` (credential backends), `packages/secrets/docs/session-vault.md` (`rekeyVault`)
