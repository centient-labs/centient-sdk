#!/usr/bin/env node
//
// Rewrite the version column of the CLAUDE.md package table from each
// packages/*/package.json. Chained after `changeset version` (root
// `version-packages` script, invoked by `make publish`) so a release
// can never leave the table stale — the 2.0.0/0.7.0 release proved the
// manual-sync convention breaks main on every publish.
//
// Only the version column is touched: the description column is
// human-curated and stays manual. A package with no table row is an
// error (exit 1) — the row needs a human-written description, and a
// silent skip would reintroduce the drift this script exists to stop.
//
// Usage:
//   node scripts/sync-claudemd-versions.mjs   # from repo root
//   pnpm run version-packages                 # changeset version + this

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLAUDE_MD = 'CLAUDE.md';

if (!existsSync(CLAUDE_MD)) {
  console.error(`error: ${CLAUDE_MD} not found (run from repo root)`);
  process.exit(1);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let claudeMd = readFileSync(CLAUDE_MD, 'utf8');
const missing = [];
let changed = false;

for (const dir of readdirSync('packages').sort()) {
  const pkgJsonPath = join('packages', dir, 'package.json');
  if (!existsSync(pkgJsonPath)) continue; // e.g. sdk-python

  const { name, version } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  if (!name || !version) continue;

  // Table row: | `@centient/foo` | 1.2.3 | description |
  const row = new RegExp(
    String.raw`^(\|\s*\`${escapeRegExp(name)}\`\s*\|\s*)([^|]*?)(\s*\|)`,
    'm',
  );
  const match = claudeMd.match(row);

  if (!match) {
    missing.push(name);
    continue;
  }

  const tableVersion = match[2].trim();
  if (tableVersion === version) {
    console.log(`OK       ${name}  (${version})`);
  } else {
    claudeMd = claudeMd.replace(row, `$1${version}$3`);
    changed = true;
    console.log(`SYNCED   ${name}  (${tableVersion} -> ${version})`);
  }
}

if (missing.length > 0) {
  for (const name of missing) {
    console.error(`MISSING  ${name}  (no ${CLAUDE_MD} table row — add one with a description by hand)`);
  }
  process.exit(1);
}

if (changed) {
  writeFileSync(CLAUDE_MD, claudeMd);
  console.log(`\n${CLAUDE_MD} package table synced.`);
} else {
  console.log(`\n${CLAUDE_MD} package table already in sync.`);
}
