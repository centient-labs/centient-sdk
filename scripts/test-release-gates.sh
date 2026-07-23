#!/usr/bin/env bash
#
# Self-test for the release gates (next-stage Initiative 1).
#
# Everything runs in a throwaway clone under mktemp — the working repo
# is never mutated. The publish/release-pr guard tests fail fast at the
# guard (dirty tree / off-main / no changesets) so no build or test
# suite runs. The publish control-flow tests DO drive the whole recipe,
# but behind PATH shims for npm/pnpm/git, so build/lint/test collapse to
# no-ops and no registry or remote is ever contacted (see that section's
# header for why each pre-branch gate is handled the way it is). The one
# slow step is a single `pnpm install` in the clone for the version-flow
# test (~30-60s warm).
#
# The release-toolkit submodule IS initialized in the clone (mirrored
# from the parent's already-checked-out submodule, no network): the
# `release-pr` target's `ensure-deps` prerequisite sources common.sh
# from it, and the version-flow test's `pnpm install` needs it too.
#
# Usage: ./scripts/test-release-gates.sh   # from repo root
#   (run `git submodule update --init` in the source repo first)

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
clone="$tmp/clone"

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# expect_fail <desc> <expected-stderr/stdout-fragment> <cmd...>
expect_fail() {
  local desc="$1" frag="$2" out rc=0
  shift 2
  out=$("$@" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qF "$frag"; then
    ok "$desc"
  else
    bad "$desc (rc=$rc, expected non-zero + \"$frag\")"
    printf '%s\n' "$out" | tail -5
  fi
}

echo "Cloning into $clone ..."
git clone --quiet "$repo_root" "$clone"
# Mirror the already-checked-out release-toolkit submodule into the clone
# (no network): ensure-deps and pnpm install source common.sh from it.
# Drop the copied inner `.git` gitlink — it points at the PARENT repo's
# .git/modules path, which does not exist under the clone and would make
# every `git status` in the clone fatal (silently defeating the guards).
if [ -d "$repo_root/scripts/release-toolkit/lib" ]; then
  rm -rf "$clone/scripts/release-toolkit"
  cp -R "$repo_root/scripts/release-toolkit" "$clone/scripts/release-toolkit"
  rm -rf "$clone/scripts/release-toolkit/.git"
else
  echo "note: run 'git submodule update --init' in the source repo before this script" >&2
fi
cd "$clone"
# The clone tests the COMMITTED state of the source repo's HEAD —
# commit your changes before running this script. The clone's origin is
# replaced with a synthetic bare repo whose `main` is exactly the
# commit under test, so the on-main guard exercises the candidate
# Makefile even when the source repo is on a feature branch.
git init --bare --quiet "$tmp/origin.git"
git push --quiet "$tmp/origin.git" HEAD:refs/heads/main
git remote set-url origin "$tmp/origin.git"
git fetch --quiet origin main
git checkout --quiet -B selftest origin/main

# --- publish guards -----------------------------------------------------
#
# The clean-tree and on-main guards run first in the publish recipe,
# before the registry check or any build/check sub-make, so these fail
# fast at the guard and never reach a real build or npm.

echo dirty > dirty-file.txt
expect_fail "publish refuses a dirty tree" "Working tree is not clean" \
  make publish
rm dirty-file.txt

git commit --quiet --allow-empty -m "selftest: move HEAD off origin/main"
expect_fail "publish refuses HEAD != origin/main" "HEAD is not origin/main" \
  make publish
git reset --quiet --hard origin/main

# --- publish control flow: which branch is TAKEN ------------------------
#
# WHY THIS IS A RUNTIME TEST AND NOT A GREP. The assertions further down
# are static — they read the recipe text. Static text cannot distinguish
# "the branch exists" from "the branch is taken", and that is exactly the
# bug class fixed in #161: the "nothing to publish" no-op ended in an
# `exit 0` on its own recipe line, which (separate shells per line) ended
# only that line while the target ran on into `changeset publish`. The
# recipe text looked correct the whole time. So these two cases drive the
# real recipe and assert on what was actually INVOKED.
#
# HOW WE GET PAST THE PRE-BRANCH GATES. publish reaches the registry
# branch only after: fetch, clean-tree, HEAD==origin/main, `npm whoami`,
# `$(MAKE) build`, `$(MAKE) check`, and the tree-fingerprint stamp
# assertion. Each is handled deliberately:
#
#   * npm / pnpm / git are PATH shims that log every invocation. Absence
#     of an invocation is the property under test, so the assertions read
#     that log rather than an exit code.
#   * The git shim passes through to the real git for everything EXCEPT
#     `push`, which it logs and swallows. That is what lets us assert the
#     tag-push behaviour without a remote, and it keeps fetch/status/
#     rev-parse/diff real so the guards are genuinely exercised.
#   * The stamp needs no faking. publish runs `$(MAKE) check` itself, and
#     `check` writes $(CHECK_STAMP) from TREE_FINGERPRINT against this
#     clone's tree — so the stamp the assertion later demands is produced
#     the same way a real release produces it. Pre-writing one would have
#     tested our arithmetic instead of the recipe's.
#   * `check`'s lint/test steps go through the pnpm shim, so they are
#     instant. `claudemd-check` stays REAL (fast, and it passes).
#     `python-test` is the one step that is neither shimmable at the PATH
#     level nor fast (it builds a venv and runs pytest), so the clone's
#     copy of scripts/run-python-tests.sh is replaced with a stub and
#     COMMITTED — committed, not left dirty, because a dirty tree would
#     trip publish's own clean-tree guard and the test would then pass
#     for the wrong reason. The Makefile, which is the artifact under
#     test, is never modified.
#
# What this deliberately does NOT cover: that the python suite really
# runs. `make check` covers that; this file covers publish's control flow.
#
# VACUITY. Every "must NOT have been invoked" assertion is gated behind a
# positive one — the recipe completed, and the shims were actually
# reached — in the same spirit as recipe_cmds' empty-extraction abort. A
# run that died before the branch would otherwise report green.

shim_dir="$tmp/shim"
mkdir -p "$shim_dir"
export SHIM_REAL_GIT
SHIM_REAL_GIT=$(command -v git)

cat > "$shim_dir/npm" <<'SHIM'
#!/usr/bin/env bash
printf 'npm %s\n' "$*" >> "$SHIM_LOG"
case "${1:-}" in
  whoami) echo selftest-user ;;
  view)
    if [ "${SHIM_NPM_UNPUBLISHED:-0}" = 1 ]; then
      echo "npm ERR! code E404" >&2
      exit 1
    fi
    echo "0.0.0-selftest" ;;
esac
exit 0
SHIM

cat > "$shim_dir/pnpm" <<'SHIM'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$SHIM_LOG"
exit 0
SHIM

cat > "$shim_dir/git" <<'SHIM'
#!/usr/bin/env bash
printf 'git %s\n' "$*" >> "$SHIM_LOG"
# Pass through to the real git for everything except push, so the guards
# (fetch / status / rev-parse / diff / tag) run for real and no remote is
# ever written to.
if [ "${1:-}" = push ]; then exit 0; fi
exec "$SHIM_REAL_GIT" "$@"
SHIM

chmod +x "$shim_dir/npm" "$shim_dir/pnpm" "$shim_dir/git"

# Stub the python gate in the clone and advance the synthetic origin/main
# to the stub commit, so the tree stays clean and HEAD == origin/main.
cat > scripts/run-python-tests.sh <<'STUB'
#!/usr/bin/env bash
# Replaced by scripts/test-release-gates.sh inside the throwaway clone.
# The real runner builds a venv and runs pytest; this self-test is about
# the publish recipe's control flow, and `make check` covers the suite.
echo "selftest: python gate stubbed"
STUB
chmod +x scripts/run-python-tests.sh
git add scripts/run-python-tests.sh
git commit --quiet -m "selftest: stub the python gate for the publish control-flow tests"
git push --quiet "$tmp/origin.git" HEAD:refs/heads/main
git fetch --quiet origin main
git reset --quiet --hard origin/main

# ensure-deps' sentinel rule ends in `touch node_modules/.package-lock.json`,
# which needs the directory to exist — the shimmed pnpm install cannot
# create it. node_modules is gitignored, so this does not dirty the tree.
mkdir -p node_modules

# Give the tag-push path something to push. Tags do not affect
# TREE_FINGERPRINT (HEAD + status + diff), so the stamp still matches.
git tag -f selftest-release-tag > /dev/null

# run_publish <log-label> [extra make args...] -> sets rc, out, SHIM_LOG
run_publish() {
  local label="$1"
  shift
  SHIM_LOG="$tmp/shim-$label.log"
  export SHIM_LOG
  : > "$SHIM_LOG"
  rc=0
  out=$(PATH="$shim_dir:$PATH" make publish "$@" 2>&1) || rc=$?
}

# --- case 1: every version already published (needs_publish=0) ----------

SHIM_NPM_UNPUBLISHED=0 run_publish nopublish
if [ "$rc" -ne 0 ]; then
  bad "publish no-op branch: recipe did not complete (rc=$rc)"
  printf '%s\n' "$out" | tail -20
elif ! grep -q '^npm view' "$SHIM_LOG"; then
  bad "publish no-op branch: registry check never ran — absence assertions would be vacuous"
elif ! grep -q '^pnpm ' "$SHIM_LOG"; then
  bad "publish no-op branch: pnpm shim never reached — absence assertions would be vacuous"
else
  ok "publish no-op branch: recipe completed and the registry check ran"
  if grep -q 'changeset publish' "$SHIM_LOG"; then
    bad "publish must NOT invoke 'changeset publish' when every version is already published"
    grep -n 'changeset publish' "$SHIM_LOG" | head -3
  else
    ok "publish skips 'changeset publish' when every version is already published"
  fi
  if grep -qE '^git push .*refs/tags/' "$SHIM_LOG"; then
    ok "publish still pushes this release's tags on the no-op path"
  else
    bad "publish must still push this release's tags on the no-op path"
  fi
fi

# --- case 2: DRY_RUN=1 stops before every side effect -------------------

SHIM_NPM_UNPUBLISHED=0 run_publish dryrun DRY_RUN=1
if [ "$rc" -ne 0 ]; then
  bad "DRY_RUN=1: recipe did not complete (rc=$rc)"
  printf '%s\n' "$out" | tail -20
elif ! printf '%s' "$out" | grep -q 'DRY_RUN=1'; then
  bad "DRY_RUN=1: never reached the dry-run stop — absence assertions would be vacuous"
elif ! grep -q '^pnpm ' "$SHIM_LOG"; then
  bad "DRY_RUN=1: pnpm shim never reached — absence assertions would be vacuous"
else
  ok "DRY_RUN=1: gates ran and the recipe reached the dry-run stop"
  if grep -q '^npm view' "$SHIM_LOG"; then
    bad "DRY_RUN=1 must NOT run the registry check (found 'npm view')"
  else
    ok "DRY_RUN=1 does not run the registry check"
  fi
  if grep -q 'changeset publish' "$SHIM_LOG"; then
    bad "DRY_RUN=1 must NOT invoke 'changeset publish'"
  else
    ok "DRY_RUN=1 does not invoke 'changeset publish'"
  fi
  if grep -qE '^git push ' "$SHIM_LOG"; then
    bad "DRY_RUN=1 must NOT push anything (found a git push)"
    grep -nE '^git push ' "$SHIM_LOG" | head -3
  else
    ok "DRY_RUN=1 pushes nothing"
  fi
fi

# --- case 3: the discriminator — an unpublished version DOES ship -------
#
# Without this, cases 1 and 2 would also pass against a recipe that never
# publishes at all. Every `npm view` 404s, so needs_publish=1.

SHIM_NPM_UNPUBLISHED=1 run_publish needspublish
if [ "$rc" -ne 0 ]; then
  bad "publish ship branch: recipe did not complete (rc=$rc)"
  printf '%s\n' "$out" | tail -20
elif ! grep -q '^npm view' "$SHIM_LOG"; then
  bad "publish ship branch: registry check never ran"
else
  if grep -q 'changeset publish' "$SHIM_LOG"; then
    ok "publish DOES invoke 'changeset publish' when a version is unpublished"
  else
    bad "publish must invoke 'changeset publish' when a version is unpublished"
  fi
  if grep -qE '^git push .*refs/tags/' "$SHIM_LOG"; then
    ok "publish pushes this release's tags on the ship path"
  else
    bad "publish must push this release's tags on the ship path"
  fi
fi

unset SHIM_LOG SHIM_NPM_UNPUBLISHED
git tag -d selftest-release-tag > /dev/null
# Drop the shimmed-install sentinel so the version-flow test below does a
# real `pnpm install` into a pristine node_modules.
rm -rf node_modules

# --- publish is publish-only: never pushes content to main -------------
#
# The central invariant of standards/release-conventions.md: `publish`
# ships what main already says and its ONLY repo write is tags. It must
# never run `changeset version`, never commit, and never push main. These
# are static assertions on the recipe text — the runtime happy path can't
# be exercised without a real registry publish, so we pin the shape here.
# Extract the publish recipe's actual command lines (drop make's `#`
# annotations and the recipe's own `@#` / `#` comment lines) so the
# assertions match on executable text, not documentation prose.
#
# The extraction FAILS LOUDLY on empty output: a renamed target or a
# changed `make -pn` format would otherwise silently yield an empty
# recipe, and every "must NOT contain X" assertion below would pass
# vacuously — a false green. An empty extraction aborts the self-test.
recipe_cmds() {
  local out
  out=$(make -pn "$1" 2>/dev/null | sed -n "/^$1:/,/^[a-zA-Z].*:/p" \
    | grep -vE '^[[:space:]]*@?#')
  if [ -z "$out" ]; then
    bad "recipe_cmds '$1' extracted NO command lines (target renamed or make output format changed?)"
    return 1
  fi
  printf '%s' "$out"
}
publish_recipe=$(recipe_cmds publish) || publish_recipe=""
# Portability: match `git push ... origin main` with an explicit ERE. The
# doubled-bracket `[[:space:]]` class is POSIX and portable across BSD/GNU
# grep; `[^&|]*` keeps the match inside a single command (not across a
# `&&`/`|` into an unrelated one).
if printf '%s' "$publish_recipe" | grep -qE 'git[[:space:]]+push[^&|]*origin[[:space:]]+main'; then
  bad "publish must NOT push main (found a 'git push origin main' in the recipe)"
else
  ok "publish never pushes main (tags-only)"
fi
if printf '%s' "$publish_recipe" | grep -qE 'changeset version|version-packages'; then
  bad "publish must NOT bump versions (found changeset version / version-packages)"
else
  ok "publish does not bump versions (that is release-pr's job)"
fi
if printf '%s' "$publish_recipe" | grep -q 'npm view'; then
  ok "publish has a not-already-published registry check (npm view)"
else
  bad "publish is missing the not-already-published registry check"
fi

# release-pr is the bump half and must NOT publish.
releasepr_recipe=$(recipe_cmds release-pr) || releasepr_recipe=""
if printf '%s' "$releasepr_recipe" | grep -q 'changeset publish'; then
  bad "release-pr must NOT publish (found 'changeset publish')"
else
  ok "release-pr does not publish (bump half only)"
fi
if printf '%s' "$releasepr_recipe" | grep -q 'gh pr create'; then
  ok "release-pr opens a PR (gh pr create)"
else
  bad "release-pr must open a PR (gh pr create)"
fi
# Both the commit message and the PR title must carry the version suffix
# (standards/release-conventions.md Mechanism A). Two occurrences, one per
# site; a suffix-less "chore(release): version packages" is the drift this
# asserts against (centient-labs/centient-sdk#170). Matched on the em-dash
# prefix rather than on `$$V`/`$V` — which of the two recipe_cmds returns
# depends on make's -p output layout, and the sigil is not the point.
suffixed=$(printf '%s\n' "$releasepr_recipe" \
  | grep -cF 'chore(release): version packages — ' || true)
if [ "$suffixed" -ge 2 ]; then
  ok "release-pr stamps the version suffix on both the commit and the PR title"
else
  bad "release-pr must use 'chore(release): version packages — \$V' for BOTH the commit message and the PR title (found $suffixed of 2)"
fi
# The suffix is only correct if it is read AFTER the bump: assert the
# capture appears later in the recipe than the bump, so a future edit that
# hoists it above the bump (stamping the pre-bump versions) fails here
# instead of shipping a mislabelled release PR.
#
# Anchor on the bump COMMAND, not on the bare string `version-packages`:
# the recipe contains that substring in three other executable lines that
# survive recipe_cmds' comment strip — the branch name
# (`BR=release/version-packages-<sha>`), the empty-capture error message,
# and the PR body prose. A bare match takes the FIRST of them (the branch
# name, which precedes the bump), so the comparison would pass for a
# capture hoisted between the branch name and the actual bump — exactly
# the regression this is meant to catch. Anchoring at line start pins the
# command: the body-prose occurrence is mid-line and cannot match.
bump_line=$(printf '%s\n' "$releasepr_recipe" \
  | grep -n '^[[:space:]]*pnpm run version-packages' | head -1 | cut -d: -f1)
capture_line=$(printf '%s\n' "$releasepr_recipe" | grep -n '^[[:space:]]*V=' | head -1 | cut -d: -f1)
if [ -z "$bump_line" ]; then
  # Never let a renamed/reshaped bump step turn this into a vacuous pass —
  # same discipline as recipe_cmds aborting on an empty extraction.
  bad "release-pr ordering check could not find the bump command ('pnpm run version-packages') — anchor is stale, assertion would be vacuous"
elif [ -n "$capture_line" ] && [ "$capture_line" -gt "$bump_line" ]; then
  ok "release-pr captures the version AFTER version-packages runs"
else
  bad "release-pr must capture V after 'pnpm run version-packages' (bump=$bump_line, capture=${capture_line:-none})"
fi

# release-pr refuses with no changesets to release. The clean-tree guard
# runs first, so commit the changeset removal to isolate the
# no-changesets guard (README.md is not a bump file and must not count).
git rm --quiet .changeset/*.md 2>/dev/null || true
cat > .changeset/README.md <<'EOF'
# Changesets
EOF
git add .changeset/README.md
git commit --quiet -m "selftest: drain changesets to test the no-changesets guard"
expect_fail "release-pr refuses when there are no changesets" \
  "No changesets to release" \
  make release-pr
git reset --quiet --hard origin/main

# --- CLAUDE.md drift gate + mechanical sync ----------------------------

node -e '
  const fs = require("fs");
  let s = fs.readFileSync("CLAUDE.md", "utf8");
  s = s.replace(/^(\|\s*`@centient\/sdk`\s*\|\s*)([^|]*?)(\s*\|)/m, "$10.0.0-corrupt$3");
  fs.writeFileSync("CLAUDE.md", s);
'
expect_fail "claudemd-check catches table drift" "DRIFT" make claudemd-check
node scripts/sync-claudemd-versions.mjs > /dev/null
if make claudemd-check > /dev/null 2>&1; then
  ok "sync script repairs the drift"
else
  bad "sync script repairs the drift"
fi
# CLAUDE.md is a symlink to AGENTS.md: writes above land in AGENTS.md,
# so restore both (checking out only the symlink is a no-op).
git checkout --quiet -- CLAUDE.md AGENTS.md

# The "N resource classes" claim in the sdk row is derived state too:
# corrupt it, assert claudemd-check catches it and the sync repairs it.
node -e '
  const fs = require("fs");
  let s = fs.readFileSync("CLAUDE.md", "utf8");
  s = s.replace(/[0-9]+ resource classes/, "9999 resource classes");
  fs.writeFileSync("CLAUDE.md", s);
'
expect_fail "claudemd-check catches resource-count drift" "DRIFT" make claudemd-check
node scripts/sync-claudemd-versions.mjs > /dev/null
if make claudemd-check > /dev/null 2>&1; then
  ok "sync script repairs the resource-count drift"
else
  bad "sync script repairs the resource-count drift"
fi
git checkout --quiet -- CLAUDE.md AGENTS.md

# A package present in packages/ but with NO row in the CLAUDE.md table
# must be a hard failure, not a silent skip — the sync script cannot
# invent a human-written description, so it refuses (exit 1). Delete the
# @centient/wal row entirely and assert the script fails loudly.
node -e '
  const fs = require("fs");
  const s = fs.readFileSync("CLAUDE.md", "utf8")
    .split("\n")
    .filter((l) => !/^\|\s*`@centient\/wal`\s*\|/.test(l))
    .join("\n");
  fs.writeFileSync("CLAUDE.md", s);
'
expect_fail "sync script fails when a package is missing from the table" "MISSING" \
  node scripts/sync-claudemd-versions.mjs
git checkout --quiet -- CLAUDE.md AGENTS.md

# --- version flow: bump + CLAUDE.md sync in one step -------------------

echo "Installing deps in the clone for the version-flow test ..."
pnpm install --frozen-lockfile --prefer-offline --silent > /dev/null

cat > .changeset/selftest-logger-patch.md <<'EOF'
---
"@centient/logger": patch
---

Release-gate self-test changeset (never published).
EOF

pnpm run version-packages > /dev/null
changed=$(git diff --name-only)
if printf '%s\n' "$changed" | grep -qx 'packages/logger/package.json' \
  && printf '%s\n' "$changed" | grep -qxE 'CLAUDE\.md|AGENTS\.md'; then
  ok "version flow bumps package.json AND syncs CLAUDE.md in one step"
else
  bad "version flow output missing expected files; got:"
  printf '%s\n' "$changed"
fi
if make claudemd-check > /dev/null 2>&1; then
  ok "claudemd-check green immediately after the version flow"
else
  bad "claudemd-check green immediately after the version flow"
fi

# --- summary ------------------------------------------------------------

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
