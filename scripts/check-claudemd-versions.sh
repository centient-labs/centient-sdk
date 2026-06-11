#!/usr/bin/env bash
#
# Verify that the package table in CLAUDE.md matches the actual
# package.json versions in the monorepo, and that the "N resource
# classes" claim in the @centient/sdk row matches the number of
# concrete Resource classes exported from packages/sdk/src/resources/.
# Exits non-zero on drift.
#
# Usage:
#   ./scripts/check-claudemd-versions.sh      # from repo root
#   make claudemd-check                        # via Makefile target

set -euo pipefail

CLAUDE_MD="CLAUDE.md"
DRIFT=0

if [ ! -f "$CLAUDE_MD" ]; then
  echo "error: $CLAUDE_MD not found (run from repo root)" >&2
  exit 1
fi

for pkg_dir in packages/*/; do
  pkg_json="${pkg_dir}package.json"
  [ -f "$pkg_json" ] || continue

  name=$(awk -F'"' '/"name"/{print $4; exit}' "$pkg_json")
  actual=$(awk -F'"' '/"version"/{print $4; exit}' "$pkg_json")

  # Table rows: | `@centient/foo` | 1.2.3 | description |
  # Extract the version field (column 3) from the row matching this package name.
  table_version=$(awk -F'|' -v pkg="\`${name}\`" \
    '$2 ~ pkg { gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3 }' "$CLAUDE_MD")

  if [ -z "$table_version" ]; then
    echo "MISSING  $name  (actual: $actual, not in CLAUDE.md table)"
    DRIFT=1
  elif [ "$table_version" != "$actual" ]; then
    echo "DRIFT    $name  (CLAUDE.md: $table_version, actual: $actual)"
    DRIFT=1
  else
    echo "OK       $name  ($actual)"
  fi
done

# --- Resource count: CLAUDE.md sdk row claims "N resource classes" ---
# Count concrete exported Resource classes in the SDK source. The abstract
# BaseResource is deliberately excluded (it is a base class, not a resource).
actual_resources=$(grep -rhoE '^export class [A-Za-z]+Resource\b' packages/sdk/src/resources/*.ts | wc -l | tr -d '[:space:]')

claimed_resources=$(awk -F'|' '$2 ~ /`@centient\/sdk`/ {
  if (match($4, /[0-9]+ resource classes/)) {
    s = substr($4, RSTART, RLENGTH); sub(/ resource classes/, "", s); print s
  }
}' "$CLAUDE_MD")

if [ -z "$claimed_resources" ]; then
  echo "MISSING  resource count  (actual: $actual_resources, no 'N resource classes' claim in @centient/sdk row)"
  DRIFT=1
elif [ "$claimed_resources" != "$actual_resources" ]; then
  echo "DRIFT    resource count  (CLAUDE.md: $claimed_resources, actual: $actual_resources)"
  DRIFT=1
else
  echo "OK       resource count  ($actual_resources)"
fi

if [ "$DRIFT" -ne 0 ]; then
  echo ""
  echo "CLAUDE.md package table is out of sync. Update it and open a docs PR."
  exit 1
else
  echo ""
  echo "All package versions in CLAUDE.md match."
fi
