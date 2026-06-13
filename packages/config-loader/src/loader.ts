/**
 * The layered config loader.
 *
 * Precedence, highest to lowest:
 *
 *   1. Environment variables  (only keys with an `envBindings` entry)
 *   2. Project config file     (.{appName}.json, discovered by walk-up)
 *   3. User config file        (~/.{appName}/config.json)
 *   4. Defaults                (the `defaults` option)
 *
 * Resolution is computed once and CACHED. Call `reload()` to recompute after a
 * file changes. The cache is the merged flat keyspace plus provenance, so
 * `getResolved(key)` can report which layer a value came from with no rescan.
 *
 * NO SILENT FALLTHROUGH: a project/user file that exists but cannot be parsed
 * as JSON is a `ConfigError`, surfaced to the caller — never skipped to the
 * next layer. Likewise an env binding whose coercer throws is a `ConfigError`,
 * not a dropped override. The only "soft" path is a *missing* file, which is a
 * legitimate absence, not a malformation.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { discoverProjectRoot } from "./discovery.js";
import { ConfigError } from "./errors.js";
import { expandEnvRefsDeep } from "./expand.js";
import { flatten, unflatten } from "./flatten.js";
import { createNodeFileSystem, createProcessEnv } from "./fs-adapter.js";
import {
  CONFIG_FILE_MODE,
  ensureAppHome,
  expandTilde,
  resolveAppHome,
} from "./paths.js";
import type {
  ConfigLayerKind,
  ConfigLoaderOptions,
  ConfigLogger,
  ConfigSnapshot,
  ConfigWarning,
  EnvBinding,
  EnvProvider,
  FileSystem,
  ResolvedValue,
} from "./types.js";

/** A layer's flattened contents, tagged with its kind, for merge + provenance. */
interface Layer {
  kind: ConfigLayerKind;
  values: Record<string, unknown>;
}

/** The public loader surface returned by {@link createConfigLoader}. */
export interface ConfigLoader {
  /** Highest-precedence value for `key`, or `fallback` when absent. */
  get<T = unknown>(key: string, fallback?: T): T | undefined;
  /** Like {@link get} but reports the layer the value came from (null if absent). */
  getResolved<T = unknown>(key: string): ResolvedValue<T> | null;
  /** Whether any layer supplies `key`. */
  has(key: string): boolean;
  /** The full merged snapshot (flattened, with warnings + provenance paths). */
  snapshot(): ConfigSnapshot;
  /** Non-fatal warnings from the most recent resolution. */
  warnings(): readonly ConfigWarning[];
  /** Recompute from disk + env, dropping the cache. Returns the fresh snapshot. */
  reload(): ConfigSnapshot;
  /**
   * Persist `updates` (a flat or nested partial) into the USER config file,
   * merged over its current on-disk contents, then refresh the cache. The home
   * directory is created 0o700 and the file written 0o600. Env-sourced values
   * are NOT written — write-back targets the user layer only.
   */
  write(updates: Record<string, unknown>): ConfigSnapshot;
  /** Absolute user config file path. */
  userConfigPath(): string;
  /** Absolute project config file path that was loaded, or null. */
  projectConfigPath(): string | null;
}

interface ResolvedConfig {
  flat: Record<string, unknown>;
  provenance: Record<string, ConfigLayerKind>;
  warnings: ConfigWarning[];
  projectConfigPath: string | null;
}

/**
 * Create a layered config loader. The returned object resolves lazily on first
 * read and caches the result; injection points (`fs`, `env`, `homeDir`, `cwd`)
 * make the whole thing testable without real disk or process state.
 */
export function createConfigLoader(options: ConfigLoaderOptions): ConfigLoader {
  const fs: FileSystem = options.fs ?? createNodeFileSystem();
  const env: EnvProvider = options.env ?? createProcessEnv();
  const homeDir = options.homeDir ?? defaultHomeDir();
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger;

  const appName = options.appName;
  const defaults = options.defaults ?? {};
  const envBindings = options.envBindings ?? {};
  const projectConfigFilename = options.projectConfigFilename ?? `.${appName}.json`;
  const projectRootMarkers = options.projectRootMarkers ?? [".git"];
  const projectStartDir = options.projectPath ?? cwd;

  const homeEnvVarValue =
    options.homeEnvVar !== undefined ? env.get(options.homeEnvVar) : undefined;
  const appHome = resolveAppHome({ appName, homeDir, homeEnvVarValue });
  const userConfigPath =
    options.userConfigPath !== undefined
      ? expandTilde(options.userConfigPath, homeDir)
      : join(appHome, "config.json");

  let cache: ResolvedConfig | null = null;

  function resolve(): ResolvedConfig {
    if (cache !== null) {
      return cache;
    }
    cache = computeResolution({
      fs,
      env,
      homeDir,
      logger,
      defaults,
      envBindings,
      userConfigPath,
      projectConfigFilename,
      projectRootMarkers,
      projectStartDir,
    });
    return cache;
  }

  function toSnapshot(resolved: ResolvedConfig): ConfigSnapshot {
    return {
      all: resolved.flat,
      warnings: resolved.warnings,
      projectConfigPath: resolved.projectConfigPath,
      userConfigPath,
    };
  }

  return {
    get<T = unknown>(key: string, fallback?: T): T | undefined {
      const resolved = resolve();
      if (Object.prototype.hasOwnProperty.call(resolved.flat, key)) {
        return resolved.flat[key] as T;
      }
      return fallback;
    },

    getResolved<T = unknown>(key: string): ResolvedValue<T> | null {
      const resolved = resolve();
      if (!Object.prototype.hasOwnProperty.call(resolved.flat, key)) {
        return null;
      }
      return {
        value: resolved.flat[key] as T,
        source: resolved.provenance[key] as ConfigLayerKind,
      };
    },

    has(key: string): boolean {
      return Object.prototype.hasOwnProperty.call(resolve().flat, key);
    },

    snapshot(): ConfigSnapshot {
      return toSnapshot(resolve());
    },

    warnings(): readonly ConfigWarning[] {
      return resolve().warnings;
    },

    reload(): ConfigSnapshot {
      cache = null;
      return toSnapshot(resolve());
    },

    write(updates: Record<string, unknown>): ConfigSnapshot {
      writeUserConfig({ fs, userConfigPath, appHome, updates });
      cache = null;
      return toSnapshot(resolve());
    },

    userConfigPath(): string {
      return userConfigPath;
    },

    projectConfigPath(): string | null {
      return resolve().projectConfigPath;
    },
  };
}

interface ComputeArgs {
  fs: FileSystem;
  env: EnvProvider;
  homeDir: string;
  logger: ConfigLogger | undefined;
  defaults: Readonly<Record<string, unknown>>;
  envBindings: Readonly<Record<string, EnvBinding>>;
  userConfigPath: string;
  projectConfigFilename: string;
  projectRootMarkers: readonly string[];
  projectStartDir: string;
}

/** Build all four layers, merge by precedence, and record provenance. */
function computeResolution(args: ComputeArgs): ResolvedConfig {
  const warnings: ConfigWarning[] = [];

  const defaultLayer: Layer = { kind: "default", values: flatten({ ...args.defaults }) };

  const userValues = loadConfigFile(args.fs, args.env, args.userConfigPath, "user");
  const userLayer: Layer = { kind: "user", values: userValues };

  const discovery = discoverProjectRoot(args.fs, {
    startDir: args.projectStartDir,
    configFilename: args.projectConfigFilename,
    markers: args.projectRootMarkers,
  });
  const projectConfigPath = discovery.configPath;
  const projectValues =
    projectConfigPath !== null
      ? loadConfigFile(args.fs, args.env, projectConfigPath, "project")
      : {};
  const projectLayer: Layer = { kind: "project", values: projectValues };

  const envLayer: Layer = {
    kind: "env",
    values: readEnvLayer(args.env, args.envBindings, warnings),
  };

  // Lowest precedence first; later layers overwrite earlier on key collision.
  const layers: Layer[] = [defaultLayer, userLayer, projectLayer, envLayer];

  const flat: Record<string, unknown> = {};
  const provenance: Record<string, ConfigLayerKind> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values)) {
      flat[key] = value;
      provenance[key] = layer.kind;
    }
  }

  if (args.logger !== undefined) {
    for (const warning of warnings) {
      args.logger.warn(warning.message, { key: warning.key, source: warning.source });
    }
  }

  return { flat, provenance, warnings, projectConfigPath };
}

/**
 * Read and flatten a JSON config file. A MISSING file is an empty layer (legit
 * absence). A present-but-unparseable file is a `ConfigError` — never a silent
 * skip. Env references inside string values are expanded before flattening.
 */
function loadConfigFile(
  fs: FileSystem,
  env: EnvProvider,
  path: string,
  kind: "user" | "project",
): Record<string, unknown> {
  if (!fs.existsSync(path)) {
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(path);
  } catch (cause) {
    throw new ConfigError("READ_FAILED", `Failed to read ${kind} config: ${path}`, {
      path,
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(
      "MALFORMED_FILE",
      `Malformed JSON in ${kind} config: ${path}`,
      { path, cause },
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(
      "MALFORMED_FILE",
      `${kind} config must be a JSON object: ${path}`,
      { path },
    );
  }

  const expanded = expandEnvRefsDeep(parsed as Record<string, unknown>, env);
  return flatten(expanded);
}

/**
 * Build the env layer from bindings. Only bound keys are read. A coercer that
 * throws is a hard `ConfigError` (no silent drop) — an operator who sets a
 * malformed env override deserves to be told, not silently ignored.
 */
function readEnvLayer(
  env: EnvProvider,
  bindings: Readonly<Record<string, EnvBinding>>,
  _warnings: ConfigWarning[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    const raw = env.get(binding.env);
    if (raw === undefined || raw === "") {
      continue;
    }
    if (binding.coerce === undefined) {
      out[key] = raw;
      continue;
    }
    try {
      out[key] = binding.coerce(raw);
    } catch (cause) {
      throw new ConfigError(
        "INVALID_ENV",
        `Invalid value for ${binding.env} (key "${key}"): ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { key, cause },
      );
    }
  }
  return out;
}

/** Merge `updates` over the existing user file and write it back 0o600. */
function writeUserConfig(args: {
  fs: FileSystem;
  userConfigPath: string;
  appHome: string;
  updates: Record<string, unknown>;
}): void {
  const { fs, userConfigPath, appHome, updates } = args;

  // Ensure the home directory exists with owner-only perms before writing.
  ensureAppHome(fs, appHome);

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(userConfigPath)) {
    let raw: string;
    try {
      raw = fs.readFileSync(userConfigPath);
    } catch (cause) {
      throw new ConfigError(
        "READ_FAILED",
        `Failed to read user config before write-back: ${userConfigPath}`,
        { path: userConfigPath, cause },
      );
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = flatten(parsed as Record<string, unknown>);
      } else {
        throw new ConfigError(
          "MALFORMED_FILE",
          `Cannot write-back over a non-object user config: ${userConfigPath}`,
          { path: userConfigPath },
        );
      }
    } catch (cause) {
      if (cause instanceof ConfigError) {
        throw cause;
      }
      throw new ConfigError(
        "MALFORMED_FILE",
        `Cannot write-back over malformed user config: ${userConfigPath}`,
        { path: userConfigPath, cause },
      );
    }
  }

  const mergedFlat = { ...existing, ...flatten({ ...updates }) };
  const nested = unflatten(mergedFlat);
  const serialized = `${JSON.stringify(nested, null, 2)}\n`;

  try {
    fs.writeFileSync(userConfigPath, serialized, CONFIG_FILE_MODE);
  } catch (cause) {
    throw new ConfigError("WRITE_FAILED", `Failed to write user config: ${userConfigPath}`, {
      path: userConfigPath,
      cause,
    });
  }
}

/**
 * Resolve the OS home directory. Pulled into a helper so tests that DON'T
 * inject `homeDir` still have one stable seam to reason about.
 */
function defaultHomeDir(): string {
  return homedir();
}
