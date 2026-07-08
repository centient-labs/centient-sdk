#!/usr/bin/env node
//
// Rewrite the version column of the CLAUDE.md package table from each
// packages/*/package.json. Chained after `changeset version` (root
// `version-packages` script, invoked by `make publish`) so a release
// can never leave the table stale — the 2.0.0/0.7.0 release proved the
// manual-sync convention breaks main on every publish.
//
// Two derived facts are synced: the version column, and the
// "N resource classes" claim in the @centient/sdk row (counted from
// packages/sdk/src/resources/, same rule as check-claudemd-versions.sh).
// The rest of the description column is human-curated and stays manual.
// A package with no table row is an error — the row needs a
// human-written description, and a silent skip would reintroduce the
// drift this script exists to stop.
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

const RESOURCES_DIR = join('packages', 'sdk', 'src', 'resources');

// Count concrete exported Resource classes in the SDK source — the same
// rule as check-claudemd-versions.sh (`^export class *Resource`; the
// abstract BaseResource does not match `export class` and is excluded).
function countResourceClasses() {
  let count = 0;
  for (const file of readdirSync(RESOURCES_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(RESOURCES_DIR, file), 'utf8');
    count += (src.match(/^export class [A-Za-z]+Resource\b/gm) ?? []).length;
  }
  if (count === 0) {
    throw new Error(
      `no Resource classes found under ${RESOURCES_DIR} — refusing to sync the count to 0 (count rule out of date?)`,
    );
  }
  return count;
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

  // Resource count: the "N resource classes" claim in the @centient/sdk
  // row is derived state, so it is synced here too. The sdk row itself
  // is guaranteed present (a missing row threw above); a row without the
  // claim is an error — the claimed count is what claudemd-check guards.
  const actualResources = countResourceClasses();
  const sdkRow = claudeMd.match(/^\|\s*`@centient\/sdk`\s*\|.*$/m)[0];
  const claimRe = /(\d+) resource classes/;
  const claim = sdkRow.match(claimRe);
  if (!claim) {
    throw new Error(
      `MISSING  resource count  (no 'N resource classes' claim in the @centient/sdk row — add one by hand)`,
    );
  }
  if (Number(claim[1]) === actualResources) {
    log(`OK       resource count  (${actualResources})`);
  } else {
    claudeMd = claudeMd.replace(sdkRow, sdkRow.replace(claimRe, `${actualResources} resource classes`));
    changed = true;
    synced.push('resource count');
    log(`SYNCED   resource count  (${claim[1]} -> ${actualResources})`);
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
