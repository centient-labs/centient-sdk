/**
 * Symlink-safe containment guard.
 *
 * `validateWithinRoots` is a lexical check: it normalizes `..` but cannot see
 * that a symlink *inside* an allowed root points *outside* it. This guard
 * resolves symlinks via `fs.realpath` before the caller performs any
 * read/access/import/exec.
 *
 * Lifted from centient `path-guards.ts` `assertRealPathWithinParent`, which is
 * the strictest of the seeds on symlinks (soma did no realpath; crucible did
 * no realpath). Behavior preserved:
 *
 *   - lexical containment first (cheap, catches plain `..`)
 *   - then walk up to the deepest EXISTING ancestor and realpath it, so a
 *     missing leaf is fine (the later fs op fails with ENOENT) but a symlinked
 *     intermediate directory is still caught
 *
 * Converted from throw-based to Result-typed, and generalized from a single
 * `expectedParent` to the package's allowed-roots set.
 *
 * `fs` is injected (defaulting to `node:fs/promises`) so callers can supply a
 * fake for tests — keeping the module decoupled from real filesystem state.
 */

import { dirname, resolve, sep } from "node:path";
import * as nodeFs from "node:fs/promises";

import {
  fail,
  ok,
  type PathError,
  type Result,
} from "./result.js";
import {
  validateWithinRoots,
  type ValidateWithinRootsOptions,
} from "./allowed-roots.js";

/** Minimal `fs.realpath` surface this guard depends on (injectable). */
export interface RealpathFs {
  realpath(path: string): Promise<string>;
}

/** Options for {@link resolveRealPathWithinRoots}. */
export interface ResolveRealPathOptions extends ValidateWithinRootsOptions {
  /**
   * Filesystem implementation. Defaults to `node:fs/promises`. Inject a fake
   * to test symlink behavior without touching the real filesystem.
   */
  fs?: RealpathFs;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  );
}

/**
 * Error thrown when `fs.realpath` fails for a reason the walk-up cannot absorb.
 *
 * Carries the failing operation (`"realpath"`), the exact probe path, and the
 * original errno `code` as first-class properties — not just baked into the
 * message string — so programmatic callers can branch on the failure without
 * re-parsing text. The triggering error is preserved via the standard `cause`
 * chain.
 */
export class RealpathGuardError extends Error {
  override readonly name = "RealpathGuardError";
  /** The filesystem operation that failed (always `"realpath"` here). */
  readonly operation = "realpath" as const;
  /** The path that was passed to `fs.realpath` when it failed. */
  readonly probe: string;
  /** The original errno code (e.g. `EACCES`), or `"unknown"` for non-errno. */
  readonly code: string;

  constructor(probe: string, code: string, cause: unknown) {
    super(`fs.realpath failed for ${JSON.stringify(probe)} (${code})`, {
      cause,
    });
    this.probe = probe;
    this.code = code;
  }
}

/**
 * Wrap an unexpected `fs.realpath` failure with context about which probe path
 * failed, preserving the original error as the `cause`. ENOENT/ENOTDIR are
 * handled inline (they drive the walk-up); everything else is genuinely
 * unexpected (EACCES, EIO, ELOOP, …) and is surfaced — not swallowed (design
 * philosophy: no silent degradation) — with enough context to debug which
 * operation failed, while still propagating the original errno via `cause`.
 */
function wrapUnexpectedRealpathError(
  probe: string,
  cause: unknown,
): RealpathGuardError {
  const code =
    isErrnoException(cause) && cause.code !== undefined
      ? cause.code
      : "unknown";
  return new RealpathGuardError(probe, code, cause);
}

function containedIn(realPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    const rootWithSep = resolvedRoot.endsWith(sep)
      ? resolvedRoot
      : resolvedRoot + sep;
    return realPath === resolvedRoot || realPath.startsWith(rootWithSep);
  });
}

/**
 * Lexically validate `inputPath` against the allowed roots, then resolve
 * symlinks on the deepest existing ancestor and confirm the REAL path is still
 * contained. Returns the lexically-resolved path on success (the same value
 * {@link validateWithinRoots} would return).
 *
 * @returns the validated path, or a {@link PathError}
 */
export async function resolveRealPathWithinRoots(
  inputPath: string,
  options: ResolveRealPathOptions,
): Promise<Result<string, PathError>> {
  // Lexical containment first (cheap, catches plain `..` traversal).
  const lexical = validateWithinRoots(inputPath, options);
  if (!lexical.ok) {
    return lexical;
  }

  const fs = options.fs ?? nodeFs;
  const allowedRoots = options.allowedRoots;

  let probe = lexical.value;
  for (;;) {
    let real: string | undefined;
    try {
      real = await fs.realpath(probe);
    } catch (err) {
      if (!isErrnoException(err)) {
        throw wrapUnexpectedRealpathError(probe, err);
      }
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
        throw wrapUnexpectedRealpathError(probe, err);
      }
      // probe doesn't exist yet — fall through to walk up to its parent.
    }

    if (real !== undefined) {
      if (!containedIn(real, allowedRoots)) {
        return fail(
          "OUTSIDE_ROOTS",
          "Path resolves through a symlink to a location outside the allowed roots",
        );
      }
      return ok(lexical.value);
    }

    const next = dirname(probe);
    if (next === probe) {
      // Reached the filesystem root without finding an existing ancestor; the
      // caller's later filesystem operation will fail with ENOENT anyway, and
      // there was no symlink to follow.
      return ok(lexical.value);
    }
    probe = next;
  }
}
