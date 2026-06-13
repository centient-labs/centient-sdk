/**
 * Allowed-roots path-traversal validator.
 *
 * Validates that an untrusted path, once resolved, stays inside one of a
 * caller-supplied set of allowed root directories. This is the "path" half of
 * the package (the other half being the single-component sanitizer).
 *
 * Strictest-of-seeds policy. Behavior is drawn from the seeds; where they
 * disagree the stricter wins, and the source seed is named:
 *
 *   - reject null bytes                         (centient validatePath, crucible)
 *   - reject empty / whitespace-only            (centient, crucible)
 *   - reject literal `..` outright              (crucible sanitizePath — STRICTER
 *                                                than centient, which allowed
 *                                                `..` as long as the resolved
 *                                                path stayed in-root. We reject
 *                                                the sequence up front AND do the
 *                                                containment check, belt + braces.)
 *   - containment check with trailing separator (crucible — avoids the
 *                                                `/app/data` vs `/app/data-backup`
 *                                                prefix false-positive that a
 *                                                bare `startsWith` has)
 *   - tilde expansion is opt-in                 (centient validatePath had it on;
 *                                                we default it OFF — expanding
 *                                                `~` silently rewrites the path,
 *                                                which is the kind of implicit
 *                                                behavior the design philosophy
 *                                                warns against. Callers opt in.)
 *
 * `[added]` checks (no seed; demanded by the acceptance vectors):
 *   - reject percent-encoded traversal / separators in the raw input
 *   - reject unicode homoglyph separators in the raw input
 *   - reject Windows drive-letter prefixes (`C:\`) and device paths (`\\.\`)
 *   - reject UNC paths (`\\server\share`)
 *
 * Symlink resolution is intentionally NOT performed here: this module is
 * pure/synchronous and does no filesystem I/O (testable, no clock/fs
 * coupling). The async {@link resolveRealPathWithinRoots} guard layers
 * `fs.realpath` on top for callers that need symlink-safe containment.
 */

import { isAbsolute, resolve, sep } from "node:path";

import { fail, ok, type PathError, type Result } from "./result.js";
import { hasUnicodeTrick } from "./unicode-trick.js";

/** Options for {@link validateWithinRoots}. */
export interface ValidateWithinRootsOptions {
  /**
   * Allowed root directories. The resolved path must be equal to, or nested
   * under, at least one of these. Callers MUST pass at least one root — there
   * is no implicit default (centient used `[homedir, /tmp, cwd]`; defaulting
   * to ambient process state is exactly the silent behavior we avoid).
   */
  allowedRoots: string[];
  /**
   * When true, a leading `~` is expanded to `homeDir` before resolution.
   * Default false. Requires {@link ValidateWithinRootsOptions.homeDir}.
   */
  expandTilde?: boolean;
  /**
   * Home directory used for `~` expansion. Injected (not read from `os` /
   * `process.env`) so the function stays pure and testable. Required when
   * {@link ValidateWithinRootsOptions.expandTilde} is true.
   */
  homeDir?: string;
  /**
   * When true (default), require the input to be an absolute path (or a `~`
   * path when tilde expansion is enabled). Relative inputs are resolved
   * against `cwd` by `path.resolve`, which couples behavior to ambient state;
   * requiring absolute inputs keeps the check deterministic.
   */
  requireAbsolute?: boolean;
}

const NULL_BYTE = "\u0000";

// Percent-encoded `.` / `/` / `\` / null, single or double encoded. [added]
const PERCENT_ENCODED_RE = /%(25)*(2e|2f|5c|00|c0|c1|e0|f0)/i;

// Windows drive-letter prefix, e.g. `C:\` or `C:/` or bare `C:`. [added]
const WINDOWS_DRIVE_RE = /^[A-Za-z]:([\\/]|$)/;

// Windows device namespace paths: `\\.\PhysicalDrive0`, `\\?\C:\…`. [added]
const WINDOWS_DEVICE_RE = /^\\\\[.?]\\/;

// UNC path: `\\server\share`. Backslash form only — a forward-slash `//host`
// is treated as an ordinary absolute path by POSIX `path.resolve`. [added]
const UNC_RE = /^\\\\[^\\]/;

/**
 * Validate that `inputPath` resolves to a location inside one of
 * `options.allowedRoots`. Pure and synchronous — no filesystem access, no
 * ambient `os`/`process` reads beyond what the caller injects.
 *
 * @returns the resolved absolute path on success, or a {@link PathError}
 */
export function validateWithinRoots(
  inputPath: string,
  options: ValidateWithinRootsOptions,
): Result<string, PathError> {
  const requireAbsolute = options.requireAbsolute ?? true;
  const expandTilde = options.expandTilde ?? false;

  // Empty / whitespace-only. (centient, crucible)
  if (inputPath.length === 0 || inputPath.trim() === "") {
    return fail("EMPTY", "Path cannot be empty");
  }

  // Null bytes. (centient, crucible)
  if (inputPath.includes(NULL_BYTE)) {
    return fail("NULL_BYTE", "Path contains a null byte");
  }

  // Caller must supply roots. (no implicit ambient default)
  if (options.allowedRoots.length === 0) {
    return fail(
      "NO_ALLOWED_ROOTS",
      "At least one allowed root must be provided",
    );
  }

  // Percent-encoded traversal / separators in the raw input. [added]
  if (PERCENT_ENCODED_RE.test(inputPath)) {
    return fail(
      "PERCENT_ENCODED",
      "Path contains percent-encoded path characters",
    );
  }

  // Unicode homoglyph separators / dot-runs, plus characters that NFKC-fold
  // into a separator or `..` (e.g. U+2100 -> "a/c", U+FE68 -> "\"). Shares the
  // exact detector the component sanitizer uses so the two layers cannot drift
  // apart. [added]
  if (hasUnicodeTrick(inputPath)) {
    return fail(
      "UNICODE_TRICK",
      "Path contains characters that imitate path separators or dots",
    );
  }

  // Windows device / drive / UNC forms — rejected outright; this validator is
  // for POSIX-rooted containment. [added]
  if (WINDOWS_DEVICE_RE.test(inputPath)) {
    return fail("UNC_PATH", "Windows device-namespace paths are not allowed");
  }
  if (UNC_RE.test(inputPath)) {
    return fail("UNC_PATH", "UNC paths are not allowed");
  }
  if (WINDOWS_DRIVE_RE.test(inputPath)) {
    return fail(
      "WINDOWS_DRIVE",
      "Windows drive-letter paths are not allowed",
    );
  }

  // Tilde expansion (opt-in). (centient had it on by default; we gate it.)
  let candidate = inputPath;
  if (candidate.startsWith("~")) {
    if (!expandTilde) {
      return fail("NOT_ABSOLUTE", "Tilde expansion is not enabled");
    }
    if (options.homeDir === undefined || options.homeDir === "") {
      return fail(
        "NOT_ABSOLUTE",
        "Tilde expansion requires a homeDir to be provided",
      );
    }
    // `~` -> homeDir, `~/foo` -> homeDir + /foo.
    candidate = options.homeDir + candidate.slice(1);
  }

  // Require absolute input (deterministic resolution). (centient
  // validateProjectPath required leading `/` or `~`.)
  if (requireAbsolute && !isAbsolute(candidate)) {
    return fail("NOT_ABSOLUTE", "Path must be absolute");
  }

  // Reject literal `..` outright BEFORE resolving. (crucible — stricter than
  // centient's "allow if it resolves in-root".)
  if (inputPath.includes("..")) {
    return fail("TRAVERSAL", "Path contains a '..' sequence");
  }

  const resolvedPath = resolve(candidate);

  // Containment: resolved path equals a root, or is nested under root + sep.
  // Trailing-separator guard prevents `/app/data` matching `/app/data-backup`.
  // (crucible)
  const contained = options.allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    const rootWithSep = resolvedRoot.endsWith(sep)
      ? resolvedRoot
      : resolvedRoot + sep;
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(rootWithSep);
  });

  if (!contained) {
    return fail(
      "OUTSIDE_ROOTS",
      "Path resolves outside the allowed roots",
    );
  }

  return ok(resolvedPath);
}
