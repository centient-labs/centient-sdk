/**
 * Project-root discovery via walk-up-to-marker.
 *
 * Starting from a directory, walk toward the filesystem root looking for the
 * first ancestor that "looks like" a project root: it contains the project
 * config file, any of the configured marker names, or a `package.json` carrying
 * a `workspaces` field. Returns null when no root is found (the caller decides
 * the fallback — usually the start directory itself).
 *
 * Adapted from the touchstone store/discovery walk-up algorithm; generalised to
 * take an injected `FileSystem` and to report the located config file directly.
 */

import { join, parse as parsePath, resolve } from "node:path";

import type { FileSystem } from "./types.js";

/**
 * Hard cap on walk-up iterations. Any sane filesystem has far fewer than 64
 * ancestors between cwd and root; this guard only exists to defuse a
 * pathological symlink loop or an fs that never returns `parent === current`.
 */
const MAX_WALK_UP_DEPTH = 64;

export interface DiscoveryOptions {
  /** Directory to start from. */
  startDir: string;
  /** Project config filename, e.g. ".centient.json". */
  configFilename: string;
  /** Additional root markers (directories or files), e.g. [".git"]. */
  markers: readonly string[];
  /**
   * Optional sink for non-fatal observations during walk-up. Used to surface a
   * package.json that exists but could not be read/parsed: that file is not OUR
   * config so it does not fail resolution, but swallowing it entirely would be a
   * silent degradation. Omitted by default (callers that don't care pay nothing).
   */
  onWarn?: (warning: DiscoveryWarning) => void;
}

/** A non-fatal observation made while walking up to the project root. */
export interface DiscoveryWarning {
  /** Absolute path of the file the observation concerns. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** The underlying error, when one was caught. */
  cause?: unknown;
}

export interface DiscoveryResult {
  /** The discovered project root directory, or null if none was found. */
  root: string | null;
  /**
   * Absolute path to the project config file inside `root`, or null when the
   * root was identified by a marker but carries no config file.
   */
  configPath: string | null;
}

/**
 * Walk up from `startDir` to locate the project root and its config file.
 *
 * A config file found at any level wins immediately and pins both `root` and
 * `configPath`. Failing that, the first ancestor matching a marker (or a
 * workspaces `package.json`) becomes `root` with a null `configPath`.
 */
export function discoverProjectRoot(
  fs: FileSystem,
  options: DiscoveryOptions,
): DiscoveryResult {
  const { configFilename, markers } = options;
  let current = resolve(options.startDir);

  for (let depth = 0; depth < MAX_WALK_UP_DEPTH; depth++) {
    const configPath = join(current, configFilename);
    if (fs.existsSync(configPath)) {
      return { root: current, configPath };
    }

    for (const marker of markers) {
      if (fs.existsSync(join(current, marker))) {
        return { root: current, configPath: null };
      }
    }

    if (hasWorkspacesPackageJson(fs, current, options.onWarn)) {
      return { root: current, configPath: null };
    }

    const { root } = parsePath(current);
    const parent = resolve(current, "..");
    if (parent === current || current === root) {
      return { root: null, configPath: null };
    }
    current = parent;
  }

  return { root: null, configPath: null };
}

/**
 * True if `dir/package.json` exists and declares a `workspaces` field. A
 * package.json that cannot be read or parsed is treated as "not a workspaces
 * root" rather than a hard error: package.json is not OUR config file, so we
 * have no standing to fail the caller's resolution over it. But the failure is
 * NOT swallowed silently — it is reported via `onWarn` (when supplied) so an
 * operator can see that walk-up skipped a candidate root, and we differentiate
 * a read failure (e.g. permissions) from a JSON parse failure in the message.
 */
function hasWorkspacesPackageJson(
  fs: FileSystem,
  dir: string,
  onWarn?: (warning: DiscoveryWarning) => void,
): boolean {
  const pkgPath = join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return false;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath);
  } catch (cause) {
    onWarn?.({
      path: pkgPath,
      message: `Could not read package.json during project-root discovery (skipped as a workspaces root): ${pkgPath}`,
      cause,
    });
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    onWarn?.({
      path: pkgPath,
      message: `Malformed JSON in package.json during project-root discovery (skipped as a workspaces root): ${pkgPath}`,
      cause,
    });
    return false;
  }

  return parsed !== null && typeof parsed === "object" && "workspaces" in parsed;
}
