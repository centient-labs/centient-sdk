/**
 * Size-based rotation for the JSONL event log (#132).
 *
 * `createJsonlSubscriber` appends forever: a 601 MB un-rotated
 * `maintainer.jsonl` was observed in production before this existed. Rotation
 * is **opt-in** — omitting `rotation` keeps the historical
 * append-until-the-disk-fills behavior byte for byte.
 *
 * Mechanics: **rename, not copy-truncate.** The JSONL subscriber holds no
 * persistent file descriptor — every flush is a discrete `appendFile(path,
 * lines)` (O_APPEND open → write → close, at most once per 100 ms / 100
 * events). A rename is therefore race-free against the writer: a flush that
 * opened the file before the rename lands its whole lines in the rotated file,
 * and the next flush recreates a fresh file at the canonical path
 * (`appendFile` creates on open). No reopen signal is needed and no bytes are
 * lost. Copy-truncate would instead destroy any lines flushed inside its
 * copy→truncate window — strictly worse for this writer.
 *
 * Because the subscriber owns the writer, the check runs at a **flush
 * boundary** rather than on a timer: the size is only ever checked in the one
 * place that is about to change it, so no periodic-check interval is needed
 * and rotation can never split a batch of lines across two files.
 *
 * Rotated files are named `<file>.<UTC stamp>` (e.g.
 * `events.jsonl.2026-07-02T10-15-30-123Z`), so a chronological sort is a sort
 * on the name; retention deletes the oldest rotated files beyond `maxFiles`.
 * The stamp pattern is matched **anchored** — operator-made siblings
 * (`events.jsonl.old`, `events.jsonl.1`, hand-renamed
 * `2026.06.13.events.jsonl`) do not match and are never swept.
 *
 * Known trade-off: a reader tailing the canonical path (`fromJsonl(path, {
 * follow: true })`) sees the stream restart at the rotation point — anything
 * written before the rename lives in the rotated sibling. That is the intended
 * cost of bounding the file.
 *
 * Symlinked log path (documented, not supported): if an operator replaces the
 * log with a symlink, `stat` follows the link (the TARGET's size drives the
 * threshold) but `rename` moves the LINK itself — the rotated file is the
 * symlink, the target stays where it is, and the next flush creates a REGULAR
 * file at the canonical path. Nothing is lost, but the indirection does not
 * survive the first rotation.
 *
 * Every failure here is logged through the injected {@link EventsLogger} and
 * swallowed: rotation is hygiene, and a hygiene failure must never take the
 * event stream down. Logged-and-continued is the point — silence would be a
 * P2 violation, throwing would kill the stream over a full disk.
 */

import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { EventsLogger } from "./logging.js";
import type { JsonlRotationOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default rotation threshold: 100 MiB. #132 names no figure; this bounds the
 * observed 601 MB failure mode ~6×.
 */
export const DEFAULT_ROTATION_MAX_SIZE_BYTES = 100 * 1024 * 1024;

/** Default number of rotated files retained. */
export const DEFAULT_ROTATION_MAX_FILES = 5;

/**
 * Matches the UTC stamp suffix this module produces:
 * `2026-07-02T10-15-30-123Z` (ISO-8601 with `:`/`.` → `-` so the name is
 * filesystem-safe on every platform), optionally followed by the `-N`
 * collision disambiguator {@link pickRotatedName} appends.
 *
 * Anchored at both ends. This is the dangerous regex in this file: retention
 * DELETES what it matches, so anything looser than an exact match on the stamp
 * shape would eventually unlink an operator's hand-named sibling.
 */
const ROTATED_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/;

/**
 * Upper bound on collision-disambiguation attempts. Reaching it means
 * thousands of rotated files share one millisecond stamp, which is not a real
 * condition — the cap exists so a pathological filesystem cannot spin the
 * flush chain forever.
 */
const MAX_COLLISION_ATTEMPTS = 1000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Rotation settings with defaults applied. @internal */
export interface ResolvedRotationConfig {
  maxSizeBytes: number;
  maxFiles: number;
}

/**
 * Apply defaults to (and validate) caller-supplied rotation options.
 *
 * Returns `null` when rotation is not configured — the opt-out that keeps the
 * default path identical to the pre-rotation behavior.
 *
 * Invalid settings **throw** at construction time rather than being silently
 * clamped: a `maxSizeBytes` of `-1` or `NaN` is a programming error, and
 * quietly substituting a working value would hide it until the disk filled
 * (P2 — no silent degradation, P5 — never silently substitute).
 *
 * @internal
 */
export function resolveRotationConfig(
  options: JsonlRotationOptions | undefined,
): ResolvedRotationConfig | null {
  if (!options) return null;

  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_ROTATION_MAX_SIZE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_ROTATION_MAX_FILES;

  if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes <= 0) {
    throw new TypeError(
      `rotation.maxSizeBytes must be a positive integer, received ${String(options.maxSizeBytes)}`,
    );
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0) {
    throw new TypeError(
      `rotation.maxFiles must be a non-negative integer, received ${String(options.maxFiles)}`,
    );
  }

  return { maxSizeBytes, maxFiles };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Outcome of one {@link rotateIfNeeded} call. @internal */
export interface RotationResult {
  /** True only when the live file was renamed. */
  rotated: boolean;
  /**
   * Why no rotation happened. Present exactly when `rotated` is false, so a
   * caller can distinguish "under threshold" from "we could not check"
   * (P11 — honest uncertainty).
   */
  reason?: "under-threshold" | "absent" | "stat-failed" | "rename-failed";
  /** Path the live file was renamed to; present only when `rotated`. */
  rotatedTo?: string;
  /** Paths of rotated files deleted by the retention pass in this call. */
  pruned: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * ISO-8601 with `:` and `.` replaced so the name is portable. The millisecond
 * component keeps two rotations inside the same second from colliding.
 */
function stampFor(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a rotated-sibling suffix into its sort key. `2026-…-123Z` → stamp with
 * disambiguator 0; `2026-…-123Z-2` → the same stamp with disambiguator 2.
 */
function splitSuffix(suffix: string): { stamp: string; n: number } {
  const dash = suffix.indexOf("-", suffix.indexOf("Z"));
  if (dash === -1) return { stamp: suffix, n: 0 };
  return { stamp: suffix.slice(0, dash), n: Number(suffix.slice(dash + 1)) };
}

/**
 * True when `name` is a rotated sibling *this module produced* for `filePath`.
 *
 * The whole safety of retention rests here, so the test is deliberately
 * narrow: the name must be the log's exact basename, then a literal `.`, then
 * a suffix matching {@link ROTATED_STAMP_RE} end to end. `startsWith` alone
 * would match `events.jsonl.old`; an unanchored regex would match
 * `events.jsonl.2026-07-02T10-15-30-123Z.bak`.
 *
 * @internal — exported for the adversarial name battery in tests/rotation.test.ts.
 */
export function isRotatedSiblingName(filePath: string, name: string): boolean {
  const prefix = `${basename(filePath)}.`;
  if (!name.startsWith(prefix)) return false;
  return ROTATED_STAMP_RE.test(name.slice(prefix.length));
}

/**
 * Pick a rotated-file name that does not already exist: `<file>.<stamp>`, or
 * `<file>.<stamp>-N` (N = 1, 2, …) on collision.
 *
 * `rename` silently OVERWRITES an existing target, so two rotations landing on
 * the same millisecond stamp would otherwise destroy the earlier rotated file.
 *
 * The exists-then-rename gap is not a TOCTOU concern in practice: rotation for
 * a given file happens on one serialized flush chain in one process, so
 * nothing else creates names in this namespace between the check and the
 * rename.
 *
 * Returns `null` if {@link MAX_COLLISION_ATTEMPTS} names are all taken.
 */
async function pickRotatedName(filePath: string, stamp: string): Promise<string | null> {
  const base = `${filePath}.${stamp}`;
  if (!(await pathExists(base))) return base;
  for (let n = 1; n <= MAX_COLLISION_ATTEMPTS; n++) {
    const candidate = `${base}-${n}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Inputs for {@link rotateIfNeeded}. @internal */
export interface RotateParams {
  /** Path of the live JSONL log. */
  filePath: string;
  config: ResolvedRotationConfig;
  logger: EventsLogger;
  /** Clock seam — injected so rotated names are deterministic in tests. */
  now: () => Date;
}

/**
 * Rotate `filePath` if it has reached `config.maxSizeBytes`, then prune
 * rotated siblings beyond `config.maxFiles`. **Never throws** — every failure
 * is logged and reported as a non-rotation with a `reason`.
 *
 * The threshold is checked with a real `stat` on every call rather than
 * against a running byte count kept by the caller. One `stat` per flush is
 * negligible next to the `appendFile` (open + write + close) the flush is
 * about to do, and it keeps the decision authoritative: an externally
 * truncated, deleted, or replaced file is observed immediately instead of
 * rotating on a stale tally.
 *
 * Called before the append, so the check sees the file as it stands and the
 * whole incoming batch lands in the fresh file. A batch can therefore carry
 * the file past `maxSizeBytes` by up to one flush's worth of lines — the file
 * is bounded at `maxSizeBytes + one batch`, not at `maxSizeBytes` exactly.
 *
 * @internal
 */
export async function rotateIfNeeded(params: RotateParams): Promise<RotationResult> {
  const { filePath, config, logger, now } = params;

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch (err) {
    // ENOENT is the normal first-write / just-rotated state, not a problem.
    if (isEnoent(err)) return { rotated: false, reason: "absent", pruned: [] };
    logger.warn(
      { filePath, error: errorMessage(err) },
      "JSONL rotation size check failed; continuing without rotation",
    );
    return { rotated: false, reason: "stat-failed", pruned: [] };
  }

  if (size < config.maxSizeBytes) {
    return { rotated: false, reason: "under-threshold", pruned: [] };
  }

  const rotatedTo = await pickRotatedName(filePath, stampFor(now()));
  if (rotatedTo === null) {
    logger.warn(
      { filePath, attempts: MAX_COLLISION_ATTEMPTS },
      "JSONL rotation could not find a free rotated name; continuing without rotation",
    );
    return { rotated: false, reason: "rename-failed", pruned: [] };
  }

  try {
    await rename(filePath, rotatedTo);
  } catch (err) {
    logger.warn(
      { filePath, rotatedTo, error: errorMessage(err) },
      "JSONL rotation rename failed; continuing without rotation",
    );
    return { rotated: false, reason: "rename-failed", pruned: [] };
  }

  const pruned = await pruneRotatedFiles(filePath, config.maxFiles, logger);
  logger.info(
    {
      filePath,
      rotatedTo,
      sizeBytes: size,
      maxSizeBytes: config.maxSizeBytes,
      prunedCount: pruned.length,
    },
    "JSONL log rotated",
  );
  return { rotated: true, rotatedTo, pruned };
}

/**
 * Delete rotated siblings of `filePath` beyond the newest `maxFiles`. Only
 * names accepted by {@link isRotatedSiblingName} are candidates — anything
 * else in the directory is left alone. Never throws.
 */
async function pruneRotatedFiles(
  filePath: string,
  maxFiles: number,
  logger: EventsLogger,
): Promise<string[]> {
  const dir = dirname(filePath);
  const prefix = `${basename(filePath)}.`;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    logger.warn(
      { dir, error: errorMessage(err) },
      "JSONL rotation retention scan failed; rotated files not pruned",
    );
    return [];
  }

  const rotated = entries
    .filter((name) => isRotatedSiblingName(filePath, name))
    .sort((a, b) => {
      // Oldest first. The fixed-width UTC stamp sorts chronologically as a
      // string; the `-N` disambiguator is compared numerically so `-10` sorts
      // after `-2` rather than before it.
      const left = splitSuffix(a.slice(prefix.length));
      const right = splitSuffix(b.slice(prefix.length));
      if (left.stamp !== right.stamp) return left.stamp < right.stamp ? -1 : 1;
      return left.n - right.n;
    });

  const excess = rotated.slice(0, Math.max(0, rotated.length - maxFiles));
  const pruned: string[] = [];
  for (const name of excess) {
    const full = join(dir, name);
    try {
      await unlink(full);
      pruned.push(full);
    } catch (err) {
      // A rotated sibling that is a directory, or one another process holds,
      // is skipped — retention is best-effort, and the next rotation retries.
      logger.warn(
        { filePath: full, error: errorMessage(err) },
        "JSONL rotation could not delete a rotated file",
      );
    }
  }
  return pruned;
}
