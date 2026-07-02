<!-- .agent/procedures/commits.md repo-specific additions — curated from the pre-ADR-005 body (ADR-005) -->
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
4. On merge to main, CI creates a "Version Packages" PR
5. Merging that PR publishes to npm

**Never bump versions manually in package.json.**

**Never run `pnpm changeset publish` directly** — `make publish` is the
only publish path; it gates on a clean `origin/main` tree, runs the full
check both before and after the version bump, and syncs the CLAUDE.md
package table. The sole exception is the recovery flow in RELEASING.md,
immediately after a `make publish` run in which `check` already passed.
For the same reason, version bumps go through `pnpm run version-packages`
(invoked by `make publish`), never bare `pnpm changeset version` — the
bare command skips the CLAUDE.md sync.

## Pre-commit Checklist (additions)

- [ ] Changeset added if user-facing change
