<!-- Repo-specific additions to .agent/procedures/commits.md, split out of this repo's pre-ADR-005 body per ADR-005 (centient-labs/standards docs/adr/ADR-005-split-local-agent-docs.md) -->
# Commit Procedures — centient-sdk

Repo-specific additions to the canonical `commits.md` (loaded alongside it).

## Scopes

- `sdk`: @centient/sdk package
- `logger`: @centient/logger package
- `wal`: @centient/wal package
- `python`: sdk-python package
- `monorepo`: Root-level changes

### Examples

```
feat(sdk): add ambient context resource

fix(logger): handle null transport gracefully

docs(wal): update replay API documentation

chore(monorepo): upgrade turbo to 2.9.0
```

## Changesets Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for versioning:

1. After making changes, add a changeset:
   ```bash
   pnpm changeset
   ```
2. Select affected packages and semver bump type
3. Commit the changeset file with your changes
4. When ready to release, run `make release-pr` — it consumes the pending
   changesets on a branch off `origin/main` and opens a reviewed version-
   bump PR
5. Merge that release PR, then run `make publish` from a clean `origin/main`
   checkout to publish to npm and push tags

**Never bump versions manually in package.json.**

**Never run `pnpm changeset publish` directly** — `make publish` is the
only publish path (standards/release-conventions.md, Mechanism A). It
gates on a clean `origin/main` tree, runs a per-package
not-already-published registry check (making it idempotent), runs the full
`check`, and ships tags-only — it never bumps versions or pushes `main`.
The sole exception is the recovery flow in RELEASING.md, immediately after
a `make publish` run in which `check` already passed. Version bumps go
through `make release-pr` (which runs `pnpm run version-packages`), never
bare `pnpm changeset version` — the bare command skips the CLAUDE.md sync.

## Pre-commit Checklist (additions)

- [ ] Changeset added if user-facing change
