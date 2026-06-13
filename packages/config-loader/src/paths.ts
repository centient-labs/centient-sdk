/**
 * Path helpers: tilde expansion and 0o700 app-home directory management.
 *
 * The "tilde-app" helpers resolve `~/.{appName}`-style locations and ensure the
 * directory exists with owner-only (0o700) permissions — config homes routinely
 * hold credentials, so a world/group-readable home is a security defect, not a
 * cosmetic one. Permissions are ENFORCED (chmod) on every ensure call, not only
 * at creation, so a pre-existing loose directory is tightened.
 */

import { join } from "node:path";

import type { FileSystem } from "./types.js";

/** Owner read/write/execute only — the required mode for a config home. */
export const APP_HOME_MODE = 0o700;
/** Owner read/write only — the default mode for a written config file. */
export const CONFIG_FILE_MODE = 0o600;

/**
 * Expand a leading `~/` (or a bare `~`) to `homeDir`. Any other input is
 * returned unchanged — this only handles the user-home shorthand, not arbitrary
 * shell expansion.
 */
export function expandTilde(path: string, homeDir: string): string {
  if (path === "~") {
    return homeDir;
  }
  if (path.startsWith("~/")) {
    return join(homeDir, path.slice(2));
  }
  return path;
}

/**
 * Resolve the application home directory for a given app.
 *
 * Precedence:
 *   1. `homeEnvVar` (when supplied and set) — tilde-expanded against `homeDir`.
 *   2. `~/.{appName}`.
 *
 * This does NOT touch the filesystem; pair it with {@link ensureAppHome} to
 * create the directory with the correct permissions.
 */
export function resolveAppHome(args: {
  appName: string;
  homeDir: string;
  homeEnvVarValue?: string;
}): string {
  const { appName, homeDir, homeEnvVarValue } = args;
  if (homeEnvVarValue !== undefined && homeEnvVarValue !== "") {
    return expandTilde(homeEnvVarValue, homeDir);
  }
  return join(homeDir, `.${appName}`);
}

/**
 * Ensure `dir` exists as a directory with mode `0o700`. Creates it (recursive)
 * when missing; tightens permissions when it already exists. Returns `dir` for
 * call-site chaining.
 *
 * The permission tighten-on-existing behaviour is deliberate: a config home
 * created by an older tool (or copied between machines) may carry loose bits,
 * and silently trusting them would defeat the purpose of the 0o700 contract.
 */
export function ensureAppHome(fs: FileSystem, dir: string, mode = APP_HOME_MODE): string {
  if (fs.isDirectory(dir)) {
    fs.chmodSync(dir, mode);
    return dir;
  }
  fs.mkdirSync(dir, mode);
  // mkdir's `mode` is masked by the process umask, so re-assert it explicitly.
  fs.chmodSync(dir, mode);
  return dir;
}
