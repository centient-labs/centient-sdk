#!/usr/bin/env bash
#
# Self-test for the release gates (next-stage Initiative 1).
#
# Everything runs in a throwaway clone under mktemp — the working repo
# is never mutated. The publish/release-pr guard tests fail fast at the
# guard (dirty tree / off-main / no changesets) so no build or test
# suite runs; the one slow step is a single `pnpm install` in the clone
# for the version-flow test (~30-60s warm).
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
recipe_cmds() {
  make -pn "$1" 2>/dev/null | sed -n "/^$1:/,/^[a-zA-Z].*:/p" \
    | grep -vE '^\s*#' | grep -vE '^\s*@?#'
}
publish_recipe=$(recipe_cmds publish)
if printf '%s' "$publish_recipe" | grep -qE 'git push[^&|]*origin[[:space:]]+main'; then
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
releasepr_recipe=$(recipe_cmds release-pr)
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
git checkout --quiet -- CLAUDE.md

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
git checkout --quiet -- CLAUDE.md

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
  && printf '%s\n' "$changed" | grep -qx 'CLAUDE.md'; then
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
