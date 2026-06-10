# Hardening State — centient-sdk

Campaign: workspace docs/plans/2026-06-10-hardening-master-plan.md (Wave 1).

| Phase | Status | Artifact | Notes |
|-------|--------|----------|-------|
| 0 preflight | done 2026-06-10 | (this file) | Clean-repro green: tsc 0 errors, 1219 passed / 14 skipped. GitHub CI deliberately archived 2026-03-30 (commit cef5ad7) — gating is local `make check`. |
| 1 adr-soundness | done 2026-06-10 | 2026-06-10-dimensions.md | 2 ADRs, both affirm; folded into dimensions doc. |
| 2 adr-vs-code | done 2026-06-10 | 2026-06-10-dimensions.md | Spot-check level (2 ADRs); full cl-adr-audit deemed disproportionate. |
| 3 dimensions | done 2026-06-10 | 2026-06-10-dimensions.md | 8 dimensions, adversarially filtered. |
| 4 triage | done 2026-06-10 | BACKLOG.md | |
| 5 implement | not started | — | Wave-1 implementation window per master plan. |
| 6 verification | not started | — | |
| 7 next-stage plan | not started | — | |

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
