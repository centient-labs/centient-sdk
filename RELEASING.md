# Releasing @centient packages

This document describes the release process for packages in this monorepo.
It follows **standards/release-conventions.md** (Mechanism A — Changesets):
the release flow is **bump-in-PR → merge → `make publish`**, split across two
Makefile targets so nothing ever pushes a version commit directly to `main`.

## The happy path

```
1. Land feature PRs on main (each PR includes a .changeset/*.md file).
2. Open the release PR (the version bump):
     make release-pr
   Review it (it shows exactly the versions that will ship), then MERGE it.
3. From a clean checkout of the merged main:
     make publish
4. Done — packages are on npm, tags are on GitHub.
```

Two targets, two halves of the flow:

- **`make release-pr`** (the bump) — on a branch off `origin/main`, runs
  `pnpm run version-packages` (`changeset version` + CLAUDE.md table sync),
  commits `chore(release): version packages`, pushes the branch, and opens a
  PR. It never touches `main` directly and never publishes. The version bump
  passes through review like any other change.
- **`make publish`** (the ship) — runs only after the release PR merges. It
  publishes exactly what `main` already says and its **only** write to the
  repo is tags. It runs: `guards (clean tree, HEAD == origin/main,
  per-package not-already-published registry check) → build → check →
  fingerprint-stamp assertion → changeset publish → git push origin --tags`.
  It never runs `changeset version`, never commits, and never pushes `main`.

**Why the split (standards/release-conventions.md).** The pre-standard
`make publish` ran `changeset version` + commit + `changeset publish` +
`git push origin main --tags` atomically — pushing a version commit straight
to `main` without review, contradicting the PR-only-`main` rule. The split
puts the bump behind review and makes publishing a pure, re-runnable ship
step. `make publish` is **idempotent**: its per-package registry check
no-ops cleanly (only ensuring tags are pushed) when every on-`main` version
is already published, so it is the recovery tool for itself after a partial
failure.

## What gates a publish (post-CI-archival)

GitHub Actions CI was deliberately archived (commit `cef5ad7`; the old
workflows live in `docs/archive/`). There is no remote gate. Because the
version bump now rides its own reviewed PR, `make publish` publishes the
already-merged, already-reviewed `main` tree. The gates the `publish`
recipe enforces, **in order**, are:

1. **Clean-tree + on-main guards** — the recipe refuses to run if
   `git status --porcelain` is non-empty or if `HEAD` is not exactly
   `origin/main` (after a fresh fetch). Publish only ever ships the
   merged `main`.
2. **Not-already-published registry check (per package)** — for every
   publishable workspace package, `npm view <name>@<version>` is queried.
   A `404` (`E404`) means unpublished → that package will ship. **Any
   other failure (auth, network) aborts** — it is never treated as
   "unpublished". If **every** on-`main` version is already on the
   registry, publish is a clean no-op: it ensures tags are pushed and
   exits 0. This is what makes `make publish` idempotent and re-runnable
   after a partial failure (registry immutability + idempotent tag
   pushes).
3. **`build`** — compiles every package; a build failure aborts.
4. **`check`** (= `lint` + `test` + `python-test` + `claudemd-check`) —
   runs the full gate via a `$(MAKE) check` sub-make (immune to a
   `-o check` skip on the outer invocation). Any failure aborts.
5. **Tree-fingerprint stamp assertion** — `check` records a fingerprint
   of the exact tree it validated (`HEAD` + staged/unstaged changes) in
   `.logs/.check-stamp`; the recipe then asserts it matches the tree
   about to publish and **fails (not warns)** on mismatch. This is the
   tripwire against a stale or hand-faked stamp, or a tree that changed
   between check and publish.
6. **npm auth preflight** — `npm whoami` must succeed before publishing.

Because publish ships the already-merged tree (it never bumps), the
old pre-bump/post-bump double-check is gone: there is a single tree to
validate — `origin/main` — and steps 3–5 validate exactly it. The
CLAUDE.md table sync that the 2.0.0/0.7.0 release exposed as a gap now
happens in `make release-pr` (part of the reviewed bump), and
`claudemd-check` inside `check` fails the publish if the merged table is
ever stale.

To exercise the publish gates without touching npm or pushing tags, run
`make publish DRY_RUN=1` — it runs the guards, build, and check, then
stops (exit 0) before `changeset publish` and the tag push, and exits
non-zero at whichever gate fails.

`make publish` is the **only** documented publish path. Do **not** run
`pnpm changeset publish` directly — it bypasses every gate above. The
only sanctioned manual use is the recovery flow below, immediately
after a `make publish` invocation in which `check` already passed.
Likewise, version bumps go through
`pnpm run version-packages` (which `make release-pr` invokes), never
bare `pnpm changeset version` — the bare command skips the CLAUDE.md
table sync.

## Provenance

Packages published from a local machine carry **no npm provenance
attestation**, and this is an explicit, recorded choice — not an
accident:

- npm provenance requires a supported cloud CI OIDC provider (GitHub
  Actions or GitLab CI/CD). A local `npm publish` has no OIDC identity
  to attest, so provenance generation is **not possible** for local
  publishes, regardless of org npm settings.
- The archived Actions release workflow set `NPM_CONFIG_PROVENANCE=true`
  with `id-token: write` (see
  `docs/archive/2026-03-29-github-actions-release.yml`). That capability
  was lost when CI was archived in `cef5ad7`.
- `make publish` therefore sets `NPM_CONFIG_PROVENANCE=false` explicitly
  on the `changeset publish` step, so the declined attestation is
  recorded in the recipe rather than silently defaulted.

**Deferred:** when a CI publisher returns (e.g. a minimal
`workflow_dispatch` publish job that runs from a tag with
`id-token: write` while tests stay local), restore attestation by
setting `NPM_CONFIG_PROVENANCE=true` in that workflow and turning
`make publish` into tag+push. Until then, consumers should not expect
provenance badges on `@centient/*` packages.

## Rules

### Feature PRs include changesets, NOT version bumps

A feature PR should contain:

- The code changes
- A `.changeset/<name>.md` file describing the change and the bump level
- Tests

A feature PR should **NOT** contain:

- Manually edited `package.json` version fields
- `CHANGELOG.md` updates
- The output of `pnpm changeset version`

The `make release-pr` target owns the version bump — on its own reviewed
PR, not inside `make publish`. If a feature PR consumes its own changeset,
`make release-pr` simply has nothing to release (it refuses early with
"No changesets to release"); the version bump for that change already
landed. The correct flow is still: changesets in the feature PR, version
bump via `make release-pr`, ship via `make publish`.

### One release PR per release batch

All pending changesets are consumed together in a single `make release-pr`
run. This produces one version bump per affected package and one CHANGELOG
entry per package in a single reviewed PR. After it merges, one `make
publish` ships them. Do not open multiple overlapping release PRs for the
same set of changesets.

### npm 2FA

`make publish` will prompt for an OTP if the npm account has 2FA enabled
for publish operations (which it should). Have your authenticator ready.

If the OTP prompt fails or times out, run the remaining steps manually
— **only** immediately after a `make publish` invocation in which
`build` and `check` already passed (the manual command bypasses the
Makefile gates, so it is sanctioned solely as a resume of that run):

```bash
NPM_CONFIG_PROVENANCE=false pnpm changeset publish --otp=<code>
git push origin --tags
```

### Recovery from a failed publish

`make publish` is its own recovery tool — it is idempotent. After any
partial failure (published but tags not pushed, a network drop mid-run),
fix the environment and simply **rerun `make publish`** from a clean
`origin/main` checkout: the per-package registry check skips packages
already on the registry (registry immutability prevents double-publish),
publishes any that are missing, and pushes tags (tag pushes are
idempotent). No manual version-commit step is ever needed — the version
bump already merged as the release PR, so the tree is clean.

If you must resume by hand (these steps apply only to a run in which
`build` and `check` already passed — if the failure was in `build`/`check`
itself, fix the code and re-open the release PR):

1. Confirm the tree is clean and on `origin/main` (`git status`;
   `git rev-parse HEAD` == `git rev-parse origin/main`).
2. Check npm: `npm view @centient/<pkg> version` — did the publish succeed?
   - Yes → just push tags: `git push origin --tags`
   - No → re-run: `NPM_CONFIG_PROVENANCE=false pnpm changeset publish`
     (add `--otp=<code>` if prompted)
3. Push tags: `git push origin --tags`

### Pre-publish checklist

Before running `make publish`:

- [ ] You are on `main`, up to date with `origin/main` (enforced — the
      recipe refuses if HEAD is not `origin/main`)
- [ ] Working tree is clean (`git status` shows nothing) (enforced —
      the recipe refuses on a dirty tree)
- [ ] All pending changesets are the ones you want to release
- [ ] You are logged in to npm as the correct user (`npm whoami`)
- [ ] You have your 2FA authenticator available
- [ ] `pnpm build && pnpm test && pnpm lint` all pass (make publish does this, but catching failures early is faster)

## Versioning policy

- **0.x packages** (pre-1.0): minor bumps may include breaking changes.
  This is standard semver for 0.x — consumers should pin `^0.x.0` and
  read the CHANGELOG on each update.
- **1.x+ packages**: standard semver. Breaking changes require a major bump.

All version bumps go through changesets. Never edit `package.json`
version fields manually.

## CLAUDE.md package table

The **version column** of the `CLAUDE.md` package table is synced
mechanically by `scripts/sync-claudemd-versions.mjs`, which runs as
part of `pnpm run version-packages` inside `make release-pr`. The
version-bump commit in the release PR therefore carries the matching
CLAUDE.md update, and it passes through review — a release can no longer
leave the table stale (the 2.0.0/0.7.0 release did exactly that when
this sync was a manual convention; see `docs/hardening/STATE.md`
phase 7). `claudemd-check` inside `make check` is the backstop: `make
publish` fails if the merged table is ever out of sync.

The **description column** stays human-curated: when a release changes
a package's surface in a way the description should reflect, update the
text by hand in the feature PR. A package missing from the table
entirely fails the sync script (and `make claudemd-check`) — add the
row with a description by hand.
