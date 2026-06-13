#!/usr/bin/env bash
#
# Self-test for the release gates (next-stage Initiative 1).
#
# Everything runs in a throwaway clone under mktemp — the working repo
# is never mutated. Guard tests drive the publish recipe with
# `make -o build -o check` (the exact prerequisite-skipping bypass the
# guards must survive) so no build or test suite runs; the one slow
# step is a single `pnpm install` in the clone for the version-flow
# test (~30-60s warm).
#
# The release-toolkit submodule is deliberately NOT initialized in the
# clone: none of the targets this script exercises (publish recipe
# guards, claudemd-check, the version flow via pnpm) source summary.sh.
#
# Usage: ./scripts/test-release-gates.sh   # from repo root

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

# --- publish guards (recipe only — build/check skipped via -o) ---------

echo dirty > dirty-file.txt
expect_fail "publish refuses a dirty tree" "Working tree is not clean" \
  make -o build -o check publish DRY_RUN=1
rm dirty-file.txt

git commit --quiet --allow-empty -m "selftest: move HEAD off origin/main"
expect_fail "publish refuses HEAD != origin/main" "HEAD is not origin/main" \
  make -o build -o check publish DRY_RUN=1
git reset --quiet --hard origin/main

rm -rf .logs
expect_fail "publish refuses without a live check stamp (make -o check bypass)" \
  "has not passed against this exact tree" \
  make -o build -o check publish DRY_RUN=1

# With all guards satisfied (stamp faked — we are testing the publish
# recipe's guard order and its DRY_RUN stop, not `check` itself),
# DRY_RUN=1 must exit 0 *before* any npm interaction or tree mutation.
mkdir -p .logs
{ git rev-parse HEAD; git status --porcelain; git diff HEAD; } \
  | git hash-object --stdin > .logs/.check-stamp
rc=0
out=$(make -o build -o check publish DRY_RUN=1 2>&1) || rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qF "DRY_RUN=1: all pre-publish gates passed"; then
  if [ -z "$(git status --porcelain)" ]; then
    ok "DRY_RUN=1 passes all gates and stops before version bump / npm"
  else
    bad "DRY_RUN=1 mutated the tree"
  fi
else
  bad "DRY_RUN=1 happy path (rc=$rc)"
  printf '%s\n' "$out" | tail -5
fi

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
