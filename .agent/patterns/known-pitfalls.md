# Known Pitfalls

Org-wide ecosystem traps that have bitten multiple repos and are worth
keeping warm. Repos extend with `## Repo-specific` for their own gotchas.

Each entry follows: **Symptom → Root cause → Diagnostic → Remedy.**

## pnpm `Packages: -N` (net-negative install)

**Symptom:** `pnpm install` reports `Packages: -N` for some N.

**Root cause:** Existing `node_modules` is stale and `--frozen-lockfile`
is pruning packages without restoring missing ones.

**Diagnostic:** Compare `pnpm-lock.yaml` against `node_modules/.modules.yaml`.
If the lockfile is ahead, prune-without-restore is the cause.

**Remedy** depends on environment.

**For local development:**

```bash
rm -rf node_modules
pnpm install
```

**For CI** (where `--frozen-lockfile` is enforced): the underlying cause
is lockfile drift versus the manifest, and `rm -rf node_modules` will not
fix it — `--frozen-lockfile` will still fail. Instead, run `pnpm install`
locally to update `pnpm-lock.yaml`, verify the diff (no unintended version
bumps), and commit the updated lockfile. Re-running CI then succeeds.

Applies to any pnpm-managed repo in the workspace.

## octokit auth-cache stale-token

**Symptom:** A GitHub adapter starts returning `AUTH_FAILED` on every call
after roughly one hour of healthy operation. The App Installation is healthy
and the PEM private key is intact.

**Root cause:** `@octokit/auth-app` caches installation tokens internally.
After the 1-hour TTL, there is a window where the cached token is expired
but the cache hasn't refreshed; GitHub returns 401.

**Diagnostic:** If the failure window aligns with the 1-hour TTL boundary
and the PEM/App Installation are verified healthy, this is the cause.

**Remedy:** Restart the process so the TokenProvider rebuilds its cache.
Substitute the actual daemon/process name for `YOUR_SERVICE` below
(document the concrete name under `## Repo-specific` when copying this
template):

- For daemons: `YOUR_SERVICE stop && YOUR_SERVICE start` (replace `YOUR_SERVICE` with the actual command name; angle-bracket syntax avoided here because `<word>` is valid POSIX shell input redirection)
- For stateless workers: redeploy

The next request after restart succeeds.

**Structural fix candidate:** Wrap `@octokit/auth-app` in a thin layer that
forces a token refresh on 401 before bubbling the error.

Applies to any centient-labs repo using `@octokit/auth-app` for installation
tokens.

## Stacked-PR merge trap

**Symptom:** `gh pr view PR_NUMBER` reports `state: MERGED` for a PR, but
the change is missing from `main`.

**Root cause:** The PR's head was merged into its **parent stacked branch**,
not into `main`. A naive check that assumes "MERGED ⇒ on main" lands a
stacked PR's child while its parent has been squash-merged out from under
it, leaving orphan commits.

**Diagnostic:** Always verify `baseRefName=main` in addition to
`state: MERGED`. Replace `PR_NUMBER` with the actual number; angle-bracket
`<num>` syntax is avoided because `<word>` is valid POSIX shell input
redirection:

```bash
gh pr view PR_NUMBER --json state,baseRefName
# Want: {"state":"MERGED","baseRefName":"main"}
```

**Remedy:** When automating PR-state checks, never assert `state: MERGED`
alone. Always conjoin with `baseRefName == "main"` (or the relevant target
branch).

Applies to any monorepo or any repo that uses stacked PRs.

## Auto-mode classifier blocks fabricated authorization claims

_Behavioral details below are accurate as of 2026-05-10; classifier
behavior can change between Claude versions. If you observe drift,
update this entry rather than working around it._

**Symptom:** A merge attempt fails with a classifier-rejection signal
(messages mentioning `auto-mode`, `unauthorized`, or `fabricated
authorization`). Naive retries with rephrased authorization claims also
fail.

**Root cause:** The auto-mode classifier on Claude's side blocks merges
where the claimed authorization is not backed by an in-context operator
grant. Common triggers:

- Docs-only (`*.md`-only) PR merge attempts without per-PR operator
  authorization
- Claims of "session-wide" or "extended" authorization not backed by a
  verifiable operator grant
- Developer-agent merge attempts under a claimed-but-unverified
  `## Repo-specific (transitional)` carve-out

**Diagnostic:** If the agent is attempting an admin-merge and the operator
has not explicitly authorized it for this specific PR in this specific
session, the classifier will block.

**Remedy:** Escalate to the operator with the PR number and the carve-out
being claimed. **Do not** retry with rephrased authorization claims — the
classifier treats fabrication-pattern retries as a malfunction signal.

This is the load-bearing defense in the future-state governance model
where developer agents have no merge rights. `.agent/procedures/pr-response.md`
(when a repo has it) and the user-level `pr-shepherd` skill must be
consistent with this behavior; if there's a conflict, the classifier wins.

## Repo-specific

<!-- Append repo-specific pitfalls here. Examples:
     - Daemon process gotchas (port conflicts, log file paths)
     - Domain-specific data quirks (timezone artifacts, encoding edge cases)
     - Build-system traps (cache invalidation conditions, lockfile drift)
     - Project-specific CLI footguns -->
