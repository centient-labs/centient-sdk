---
topic: post-wave-followups
date: 2026-06-27
author: claude (operator: owenjohnson)
engram_session: 2026-06-22-post-wave-followups
handoff_issue: 126
predecessor: docs/handoffs/2026-06-15-HANDOFF-post-wave-followups.md
---

# Handoff: Post-wave follow-ups — secrets ADR remediation + 1Password backend design

**Date:** 2026-06-27
**Predecessor:** `docs/handoffs/2026-06-15-HANDOFF-post-wave-followups.md` — its P1/P3 were already done at pickup; this handoff supersedes it and re-scopes the tail.

## Priority for next session **(required)**

1. **ACCEPT or revise ADR-004** — `docs/adr/004-1password-credential-backend.md` is **Status: Proposed** (merged via #125, mbot ✅ but that is doc-quality, NOT architectural acceptance — the decision is the operator's). If accepted, flip the header to `Status: Accepted` + date in a quick doc PR; that is the signal the `cl-adr-audit` chain treats as a real decision.
2. **Implement `OnePasswordVault`** from the now-merged ADR-004 — new `VaultBackend` for credential *values* (distinct from ADR-001's existing key provider). Scope: new backend + shared `op` helper factored from `OnePasswordProvider` (P6) + the cascade's first config seam (`secrets.backend` + `secrets.onePasswordBackend`, vault required/no-default/fail-closed) + secure stdin-JSON write + opt-in integration test. **Gated on Priority 1 acceptance.**
3. **#122** — `migrate --to passphrase` follow-up (deferred in the ADR-001 re-audit): route migrate through `setupKey()` + vault re-encryption, OR keep deferred. https://github.com/centient-labs/centient-sdk/issues/122
4. **ADR-002 1.0 pillars** — open tracking issues #98 (SecretsClient factory + policy stack), #99 (audit sink OTel+OCSF + HMAC chaining), #100 (SecretsProvider rename + KeyProvider reconciliation), #101 (threat-model doc), #103 (perf baselines). #102 (op argv hex leak) is directly addressed by the ADR-004 stdin-write pattern when implemented.
5. **Priority 2 (cross-repo consumer migrations)** — STILL untouched; lives in OTHER repos (mbot, centient, engram-server, soma, test-kit, membrane, pipeline-sdk, support/cli). Needs a working-dir switch per repo; not actionable from centient-sdk.

## What was accomplished **(required)**

### ADR-001 passphrase-provider re-audit (was Priority 5)
- **PR #123** (merged, `bb48ec0`): https://github.com/centient-labs/centient-sdk/pull/123 — scoped `cl-adr-audit` (audit → adversarial refutation, 8 agents). Both Amendment-1 security properties that were marked *PENDING RE-AUDIT* (64 KiB hidden-input cap; deferred-one-tick signal handling) **survive refutation and are runtime-verified**. Status lifted to *RE-AUDITED 2026-06-23*; STATE.md phase-7 note updated. One divergence found → filed #122.

### ADR-002 P0 audit-gap fixes (advances Priority 4)
- **PR #124** (merged, `dd1c8b6`): https://github.com/centient-labs/centient-sdk/pull/124 — closed **#120** (before-hook-rejected credential ops were silently un-audited; now fire `*_rejected` events through the entered policies via onion-model `runBeforeHooks`, wired through both the cascade vault and session-vault `withAudit`; new `rejectedEventType()` exported) and **#121** (libsecret `listKeys` D-Bus→secret-tool fallback now emits a one-time `warnOnDbusDegradation` warning when a session bus is advertised but D-Bus fails; quiet on bus-less hosts). `@centient/secrets` minor changeset. 233 secrets tests pass. Took one mbot Iterate round (4 findings) + Codex P2, all fixed in one push.

### ADR-004 1Password credential backend — DESIGN (new this session)
- **PR #125** (merged, `d480fb4`): https://github.com/centient-labs/centient-sdk/pull/125 — `docs/adr/004-1password-credential-backend.md`, **Status: Proposed**. Designs `OnePasswordVault implements VaultBackend` for credential VALUES. Three operator-steered decisions baked in: separate `onePasswordBackend` config block, vault-name required/no-default/fail-closed, list-cache-only (never cache secret values). Secure stdin-JSON write (no secrets in argv — fixes #102 leak class). Zero new runtime deps; opt-in integration test so it is not code-present-only.

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| Accept/revise ADR-004 | open — needs operator decision | owen | — |
| Implement `OnePasswordVault` | open | — | gated on ADR-004 acceptance |
| #122 migrate --to passphrase | open (deferred) | — | https://github.com/centient-labs/centient-sdk/issues/122 |
| ADR-002 1.0 pillars #98–#101, #103 | open | — | #99 partly; design work |
| #102 op argv hex leak (key provider) | open | — | folded into ADR-004 stdin pattern |
| Priority 2 cross-repo migrations | open — untouched | — | per-repo (other repos) |

## Operational notes **(required)**

### Commands
```bash
cd packages/secrets && npx vitest run         # 233 tests; npx tsc --noEmit = lint
# ADR audit gate: Skill cl-adr-audit / Workflow {name:"cl-adr-audit", args:"--adr NNN"}
```

### Paths and credentials
- `docs/adr/004-1password-credential-backend.md` — the proposed design (read before implementing).
- `docs/hardening/STATE.md` phase 7 — re-audit ledger; updated 2026-06-23.
- No secrets handled this session.

### engram status
- engram persist VERIFIED: 3 notes saved + journaled and **promoted to crystals by `finalize_session_coordination`** (autoPromotion 3/3; crystal ids `b4a2865e…`, `08dc7adf…`, `6be07d40…`). Notes: 1 finding (ADR-001 re-audit) + 2 decisions (ADR-002 fixes, ADR-004 design). NOTE the standalone `consolidate_session_memory` endpoint is unavailable in this engram version (`EXTERNAL_QDRANT_UNAVAILABLE`) — but finalize's own promotion path works, so recall is warm. Session id `2026-06-22-post-wave-followups`. (Recall was cold at *pickup* because the prior session never journaled.)

### Review-loop lessons (non-obvious)
- Background PR observer (`cl-pr-observer.sh`) dies with **exit 144 (SIGURG)** in this harness — unreliable. Use the `ScheduleWakeup` timer poll instead.
- Poll cadence: **270s** (cache-warm), not 900s — a 900s poll missed a review that landed inside the window.
- `Closes **#120**` (markdown-**bold** issue number) does **NOT** auto-close on merge — GitHub's keyword parser ignores the `**`. Use plain `Closes #120`. Had to close #120/#121 manually.
- mbot verdicts: `✅ Ready` = approve (harness auto-merges, incl. merge-commits); `❌ Iterate` = changes. Merger can lag ~10min+ after approval.

## Hard guardrails **(required)**

- **Never self-merge / push to main / admin-merge from this seat** — mbot is the gate, the coordinator merges. All three PRs this session went through that gate.
- **Never bump versions manually** — changesets + `pnpm run version-packages` only (it also syncs the CLAUDE.md table).
- **Zero EXTERNAL runtime deps** per `@centient` package — ADR-004 deliberately uses `op` CLI via `execFileSync`, not `@1password/sdk`, to honor this.
- **ADR-004 implementation MUST pass secret values via stdin, never argv** — that is the core security decision (and the #102 fix); do not regress to `op item create field=value`.

## Open questions **(optional)**

- Does the operator accept ADR-004 as designed (Status → Accepted), or want changes first? (Priority 1.)
- One implementation-time unknown in ADR-004: does the pinned `op` version support `op item edit -` (stdin) so update need not be delete-then-create?

## References **(optional)**

- ADRs: `docs/adr/001`, `002`, `003` (all Accepted); `004` (Proposed)
- PRs: #123, #124, #125 (all merged)
- Issues: #120 (closed), #121 (closed), #122 (open), #98–#103 (ADR-002 1.0 + #102)
- Prior handoff: `docs/handoffs/2026-06-15-HANDOFF-post-wave-followups.md`
