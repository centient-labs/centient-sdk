# Releasing @centient packages

This document describes the release process for packages in this monorepo.
It exists to prevent a repeat of the 0.4.0 publish snag where the version
bump landed in a feature PR, causing `make publish` to fail mid-flow.

## The happy path

```
1. Land feature PRs on main (each PR includes a .changeset/*.md file)
2. From a clean main:
   make publish
3. Done — packages are on npm, tags are on GitHub.
```

`make publish` runs: `build → check → changeset version → commit (if needed) → changeset publish → push + tags`.

## What gates a publish (post-CI-archival)

GitHub Actions CI was deliberately archived (commit `cef5ad7`; the old
workflows live in `docs/archive/`). There is no remote gate. The gates
that stand between code and npm are, in order:

1. **`build`** — a Makefile prerequisite of `publish`; compiles every
   package. A build failure aborts the publish.
2. **`check`** (= `lint` + `test`) — also a Makefile prerequisite of
   `publish`; runs the full lint, typecheck, and test suite. Any failure
   aborts the publish.
3. **Tree-fingerprint stamp** — `check` records a fingerprint of the
   exact tree it validated (`HEAD` + staged/unstaged changes) in
   `.logs/.check-stamp`. The first thing the `publish` recipe does is
   recompute the fingerprint and **fail (not warn)** if it does not
   match the stamp. This means even an attempt to skip the prerequisite
   (`make -o check publish`, `make --touch`, a hand-edited invocation)
   cannot reach `changeset publish` unless `make check` has passed
   against the identical tree.
4. **npm auth preflight** — `npm whoami` must succeed before any
   version bump or publish step runs.

In the happy path (`make publish` from a clean main) gates 1–3 all run
in the same invocation; the stamp assertion exists so that there is no
path to npm where they did not.

Do **not** run `pnpm changeset publish` directly as a first resort — it
bypasses every gate above. The only sanctioned manual use is the
recovery flow below, immediately after a `make publish` invocation in
which `check` already passed.

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

The `make publish` target owns the version bump. If a feature PR consumes
its own changeset before `make publish` runs, the publish target's
`changeset version` step becomes a no-op and (prior to the idempotency
fix in PR #19) the subsequent `git commit` would fail, aborting the
entire release. The idempotency fix makes this survivable, but the
correct flow is still: changesets in the PR, version bump in `make publish`.

### One `make publish` per release batch

All pending changesets are consumed together in a single `make publish`
run. This produces one version bump per affected package, one CHANGELOG
entry per package, and one npm publish per package. Do not run `make
publish` multiple times for the same set of changesets.

### npm 2FA

`make publish` will prompt for an OTP if the npm account has 2FA enabled
for publish operations (which it should). Have your authenticator ready.

If the OTP prompt fails or times out, run the remaining steps manually
— **only** immediately after a `make publish` invocation in which
`build` and `check` already passed (the manual command bypasses the
Makefile gates, so it is sanctioned solely as a resume of that run):

```bash
NPM_CONFIG_PROVENANCE=false pnpm changeset publish --otp=<code>
git push origin main --tags
```

### Recovery from a failed publish

If `make publish` fails partway through (these steps apply only to a
run in which `build` and `check` already passed — if the failure was in
`build`/`check` itself, fix the code and start over with `make publish`):

1. Check `git status` — are there uncommitted version-bump changes?
   - Yes → commit them: `git add -A && git commit -m "chore: version packages"`
   - No → version bump either already committed or was a no-op
2. Check npm: `npm view @centient/<pkg> version` — did the publish succeed?
   - Yes → just push tags: `git push origin main --tags`
   - No → re-run: `NPM_CONFIG_PROVENANCE=false pnpm changeset publish`
     (add `--otp=<code>` if prompted)
3. Push: `git push origin main --tags`

### Pre-publish checklist

Before running `make publish`:

- [ ] You are on `main`, up to date with `origin/main`
- [ ] Working tree is clean (`git status` shows nothing)
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

After a release, the `CLAUDE.md` package table should be updated to
reflect the new version(s). Run `make claudemd-check` to detect drift.
If it reports a mismatch, update `CLAUDE.md` and open a small docs PR.

This is not automated in the release flow because `CLAUDE.md` is a
human-curated document with descriptions that may need updating alongside
the version number.
