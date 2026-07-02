<!-- cl-sync src=6d32428e -->
# Commit Procedures

## Commit Format

Use conventional commits:

```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Subject line is all lowercase.** Acronyms like UI/UX, API, ADR must be
written lowercase (`ui/ux`, `api`, `adr`). Commitlint rejects uppercase
subjects.

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes nor adds |
| `chore` | Build, CI, dependencies, configs |

### Scopes

Define them in `commits-local.md` (the repo-specific sibling loaded alongside
this file). Common patterns: monorepo package names, module names, or omit the
scope for single-package repos.

## Command Validator Hook Rules

If the project uses a command-validator hook (`.claude/hooks/command-validator.sh`):

- Commitlint enforces **all-lowercase subject lines** — the *entire* first line,
  type, scope, and description alike (`fix(auth): add feature`, never
  `Fix(auth): Add feature`). This is stricter than vanilla conventional commits,
  which only lowercases the type; see "Commit Format" above — the org-wide rule,
  the validator just front-runs it.
- The validator rejects any bash command containing the word "format" — the match
  is a context-blind substring check on the whole command string, so it trips on
  prose too, including commit-message text. **In message text**, use a synonym:
  "encoding", "shape", "structure", "layout". (The rule's original rationale is
  not recorded anywhere in the tree — the validator's implementation is currently
  missing, tracked in centient#446; until that resolves, treat the block as an
  observed behavior to route around, not a policy to reason from.)
- **In git flags**, synonyms don't apply — use the alternative flags instead:
  `git log --oneline` or `git log --pretty=` rather than `git log --format=`.

## Pre-commit Checklist

- [ ] Files staged (`git add <files>`)
- [ ] Lint passes (`make lint` or toolchain equivalent)
- [ ] Tests pass (`make test`)
- [ ] No secrets in diff (`git diff --staged | grep -iE "api_key|password|secret|token"`)
- [ ] Commit message follows format
- [ ] Co-Author line included

## Branch Workflow

1. Create feature branch from main:
   ```bash
   git checkout -b feat/description
   ```
2. Make atomic commits (one logical change per commit)
3. Push and open a PR:
   ```bash
   git push -u origin feat/description
   gh pr create --base main
   ```
4. The maintainer bot (or a human reviewer) approves and merges via squash.

**Never push directly to `main`.** Branch protection enforces PR-only workflow
on Tier A repos; even where it doesn't, treat direct-to-main as prohibited.

**Prefer independent PRs — do not stack.** Branch **every** PR off `main`. If a PR
references another unmerged PR, still branch off `main` and note the dependency in
the PR body — doc cross-references resolve once both land; do not branch one PR off
another. Stack **only** for a true *content* dependency (your code cannot build or
test without the other PR's code). When you must stack: the base merges first, then
**rebase the child onto `main`** before merging it, and **never squash-merge or
force-push a PR whose head is the base of an open child** — it rewrites the base's
SHAs and strands the child, which is how a "merged" stacked PR can land its content
on a dead branch instead of `main`.

## Anti-patterns

```bash
# BAD — vague message
git commit -m "updates"

# BAD — uppercase subject
git commit -m "Fix: resolve bug"

# BAD — mixed changes
git commit -m "feat: add feature and fix bug and update docs"

# GOOD — specific, lowercase, single concern
git commit -m "feat(search): add semantic ranking to query results"
```

## Attribution

When Claude assists with code:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

Never commit under a real person's identity for AI-assisted work.

Repo-specific additions: see `commits-local.md` (loaded alongside this file).
