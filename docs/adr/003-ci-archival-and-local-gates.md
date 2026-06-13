# ADR-003: CI Archival and Local Makefile Gates

**Status:** Accepted
**Date:** 2026-06-12 (records a decision made 2026-03-30)
**Deciders:** Owen Johnson
**Principles:** P2 (No Silent Degradation), P3 (Transparent Evolution), P13 (Auditability as a First-Class Feature), P16 (Authority Outside the Sandbox)
**Supersedes:** none
**Related:** ADR-001, ADR-002; `docs/hardening/2026-06-10-dimensions.md` (F5, F6, Deferred line 59-60); `docs/hardening/BACKLOG.md` (T5)

## Context

On 2026-03-30, commit `cef5ad7` ("chore: standardize local CI with Makefiles, archive GitHub Actions") moved this monorepo off GitHub-Actions-hosted CI. The two workflows — build/test on PR and Changesets-driven publish — were moved to `docs/archive/` (`2026-03-29-github-actions-ci.yml`, `2026-03-29-github-actions-release.yml`) rather than deleted, and verification became a local `make check` (lint + full test suite + `claudemd-check`) plus a local `make publish`.

This was a deliberate org-level decision, not drift. It was never written down as an ADR. The hardening phase-3 dimensions audit (`2026-06-10-dimensions.md`) flagged the absence twice: as supply-chain findings F5/F6 (no automated release gate; npm provenance attestation lost with the archived workflow's `NPM_CONFIG_PROVENANCE=true`) and in the Deferred ledger lines 59-60 ("the CI-archival decision (cef5ad7) has no ADR; the local-CI-via-Makefiles standard should be written down"). Initiative 1 of `docs/plans/2026-06-12-next-stage.md` then demonstrated, concretely, that an undocumented local gate is a gate that can be sidestepped silently — making this ADR urgent rather than housekeeping.

### Why CI was archived

The hosted CI was providing little that the local gate did not, while adding a second source of truth for "is the repo green" that could disagree with `make check`, plus a hosted-runner attack surface for a repo whose privileged action (npm publish) is performed by a single maintainer on a trusted workstation. Consolidating to one local gate removes the divergence and shrinks the surface (P16: the publish authority stays on the maintainer's protected workstation, never on a hosted runner that executes PR-authored build scripts).

## Decision

1. **Local `make check` is the canonical gate.** `make check` (lint + full vitest suite across all packages + `claudemd-check`) is the single authoritative "is this green" signal. It must pass before any commit and before any publish. There is no hosted CI that can independently report green or red; the local gate is the source of truth.

2. **Local `make publish` is the only documented publish path.** Releases are cut from a trusted maintainer workstation via `make publish`, which runs build + check before `changeset publish`. Direct `pnpm changeset publish` is forbidden (it bypasses the gate). npm 2FA and an `npm whoami` preflight are the human-in-the-loop controls.

3. **Archived, not deleted.** The two workflow files stay in `docs/archive/` as the executable record of what hosted CI did — specifically the `NPM_CONFIG_PROVENANCE=true` and `id-token: write` settings that local publishing cannot reproduce. They are the template for restoring attestation if a CI publisher returns (see Consequences → Dormant condition).

4. **No re-introduction of hosted CI without a superseding ADR.** Re-adding a GitHub Actions publisher is a reversal of this decision and requires its own ADR (or an amendment here), not an incidental PR. The `2026-06-12-next-stage.md` non-goals reaffirm this.

## Consequences

### Positive

- **One source of truth for green/red** — no divergence between a hosted runner and `make check`.
- **Smaller privileged-action surface** (P16) — publish authority lives on the maintainer's protected workstation, not a hosted runner that executes untrusted PR build scripts.
- **The gate is in the repo** — `make check` is readable, runnable, and diffable by every contributor; there is no opaque hosted config.

### Negative

- **No automatic enforcement on PRs** — a contributor (or an agent) can open a PR whose `make check` they never ran. The gate is only as strong as the discipline (and, for releases, the `make publish` dependency wiring) that invokes it. This is the structural weakness that Initiative 1 exists to close.
- **Provenance attestation lost (F6).** The archived release workflow set `NPM_CONFIG_PROVENANCE=true`; local `make publish` cannot produce npm provenance because provenance requires a supported CI OIDC provider (`id-token: write`). Public `@centient/*` packages currently ship **unattested**. Per BACKLOG.md T5, this is documented and explicitly declined (`--provenance=false` recorded in the release flow) rather than silently dropped, with restoration tracked as the dormant condition below.

### Incident — the Initiative-1 gate-sequencing bypass (2026-06-11/12)

The sdk 2.0.0 / secrets 0.7.0 release reached npm with `make claudemd-check` failing on `main`. **Root cause** (recorded in `docs/hardening/STATE.md`, phase-7 entry): the Changesets "version" step bumps `package.json` versions *after* `make check` runs, and nothing in the version flow rewrote the `CLAUDE.md` package table — so the published commit left `main` red on the version-drift gate (sdk 1.7.1→2.0.0, secrets 0.6.0→0.7.0 undocumented in the table) while the packages still published. The local gate was either run pre-bump or bypassed via a direct `changeset publish`. This is the canonical demonstration of the Negative above: a local gate with no structural enforcement is a gate that can be sidestepped silently (P2, P13). **The fix is in flight as PR #87** (`feat/release-gate-integrity`, Initiative 1): mechanical `CLAUDE.md` version sync chained into the version step, and `make publish` re-running `make check` in the same invocation with a clean-tree / on-`origin/main` guard so a stale or skipped check cannot reach npm. This ADR records the incident as the motivating consequence; PR #87 carries the remediation.

### Dormant condition — restore attestation when a CI publisher returns

If a hosted (or otherwise OIDC-capable) **publish** step is ever reintroduced — even a minimal `workflow_dispatch` job that runs only the publish while tests stay local — npm provenance attestation **must** be restored at that time: set `NPM_CONFIG_PROVENANCE=true` and `id-token: write`, mirroring the archived `2026-03-29-github-actions-release.yml` template in `docs/archive/`. This is the dormant T5 follow-up (`BACKLOG.md` T5 item 1, "restore attestation when a CI publisher returns"). It stays dormant under this ADR; the trigger is the return of a CI publisher, and reintroducing one is itself gated on a superseding ADR per Decision 4.

## References

- Commit `cef5ad7` — "chore: standardize local CI with Makefiles, archive GitHub Actions" (2026-03-30)
- `docs/archive/2026-03-29-github-actions-ci.yml`, `docs/archive/2026-03-29-github-actions-release.yml`
- `docs/hardening/2026-06-10-dimensions.md` — F5, F6, Deferred lines 59-60
- `docs/hardening/BACKLOG.md` — T5 (`gap-none-publish-provenance`)
- `docs/plans/2026-06-12-next-stage.md` — Initiative 1 (release-gate integrity), non-goals (no CI re-introduction)
- PR #87 — `feat/release-gate-integrity` (Initiative-1 remediation, in flight)
- `.agent/procedures/commits.md` — release/publish flow
