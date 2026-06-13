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
// error — the row needs a human-written description, and a silent skip
// would reintroduce the drift this script exists to stop.
//
// The work is a composable function that THROWS on failure (so it can
// be imported and unit-tested); only the run-as-script guard at the
// bottom maps a thrown error to a non-zero exit code.
//
// Usage:
//   node scripts/sync-claudemd-versions.mjs   # from repo root
//   pnpm run version-packages                 # changeset version + this

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const CLAUDE_MD = 'CLAUDE.md';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readPackageJson(pkgJsonPath) {
  const raw = readFileSync(pkgJsonPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(`malformed JSON in ${pkgJsonPath}: ${cause.message}`, { cause });
  }
}

// Sync the CLAUDE.md table in place. Returns a summary; throws on any
// drift it cannot safely fix (missing file, missing table row, bad JSON).
export function syncClaudeMdVersions({ log = () => {} } = {}) {
  if (!existsSync(CLAUDE_MD)) {
    throw new Error(`${CLAUDE_MD} not found (run from repo root)`);
  }

  let claudeMd = readFileSync(CLAUDE_MD, 'utf8');
  const missing = [];
  const synced = [];
  let changed = false;

  for (const dir of readdirSync('packages').sort()) {
    const pkgJsonPath = join('packages', dir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue; // e.g. sdk-python

    const { name, version } = readPackageJson(pkgJsonPath);
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
      log(`OK       ${name}  (${version})`);
    } else {
      claudeMd = claudeMd.replace(row, `$1${version}$3`);
      changed = true;
      synced.push(name);
      log(`SYNCED   ${name}  (${tableVersion} -> ${version})`);
    }
  }

  if (missing.length > 0) {
    const lines = missing.map(
      (name) => `MISSING  ${name}  (no ${CLAUDE_MD} table row — add one with a description by hand)`,
    );
    throw new Error(lines.join('\n'));
  }

  if (changed) {
    writeFileSync(CLAUDE_MD, claudeMd);
    log(`\n${CLAUDE_MD} package table synced.`);
  } else {
    log(`\n${CLAUDE_MD} package table already in sync.`);
  }

  return { changed, synced };
}

// Run-as-script guard: execute only when invoked directly, and translate
// a thrown error into a non-zero exit (the sole place exit status is set).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    syncClaudeMdVersions({ log: (m) => console.log(m) });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
