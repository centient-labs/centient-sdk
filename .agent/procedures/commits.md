# Commit Procedures

## Commit Format

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code change that neither fixes nor adds
- `test`: Adding or updating tests
- `chore`: Build process, dependencies

### Scopes
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

## Branch Workflow

1. Create feature branch from main
   ```bash
   git checkout -b feat/description
   ```

2. Make atomic commits (one logical change per commit)

3. Push and create pull request
   ```bash
   git push -u origin feat/description
   ```

4. After review, merge via PR (squash or merge commit)

## Pre-commit Checklist

- [ ] Tests pass locally (`pnpm test`)
- [ ] Types check (`pnpm build` succeeds)
- [ ] No secrets in diff
- [ ] Commit message follows format
- [ ] Changeset added if user-facing change

## Attribution

When Claude assists with code:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```
