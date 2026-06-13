/**
 * Public types for `@centient/config-loader`.
 *
 * This package resolves and LAYERS configuration. It deliberately does NOT
 * validate domain shapes — validation schemas stay in consumers. The loader's
 * contract is "give me the highest-precedence value for a key, surface every
 * malformed file loudly, and let me write a layer back to disk".
 */

/**
 * Minimal filesystem surface the loader depends on. The default Node adapter
 * (`createNodeFileSystem`) implements this against `node:fs`, but tests inject
 * an in-memory implementation so no real disk access is required.
 *
 * All methods are synchronous: config resolution happens once at startup and a
 * sync surface keeps the precedence logic linear and easy to reason about.
 */
export interface FileSystem {
  /** Return true if a path exists (file or directory). */
  existsSync(path: string): boolean;
  /** Read a UTF-8 file. Throws if the path does not exist. */
  readFileSync(path: string): string;
  /**
   * Write a UTF-8 file. `mode` (when supplied) is the octal permission bits to
   * apply to the file, e.g. `0o600` for owner-only read/write.
   */
  writeFileSync(path: string, data: string, mode?: number): void;
  /** Create a directory (recursively). `mode` is the octal permission bits. */
  mkdirSync(path: string, mode?: number): void;
  /** Apply octal permission bits to an existing path. */
  chmodSync(path: string, mode: number): void;
  /** Return true if the path exists AND is a directory. */
  isDirectory(path: string): boolean;
}

/**
 * Minimal environment surface. The default (`createProcessEnv`) reads
 * `process.env`; tests inject a plain record so env precedence is deterministic.
 */
export interface EnvProvider {
  /** Return the raw string value of an env var, or undefined if unset. */
  get(name: string): string | undefined;
}

/**
 * Optional sink for non-fatal warnings (e.g. an env var that could not be
 * coerced and was therefore ignored). Injected so the loader carries ZERO
 * runtime dependencies — wire `@centient/logger` here from the consumer if you
 * want structured output. When omitted, warnings are still collected on the
 * resolution result; nothing is written anywhere.
 */
export interface ConfigLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * One non-fatal warning surfaced during resolution. Malformed FILES are errors
 * (thrown), not warnings — per the no-silent-degradation principle. Warnings are
 * reserved for recoverable cases such as an out-of-range env override that the
 * caller asked to be coerced.
 */
export interface ConfigWarning {
  /** Dotted key path the warning relates to, when applicable. */
  key?: string;
  /** Which layer produced the warning (e.g. "env", "project"). */
  source?: ConfigLayerKind;
  /** Human-readable description. */
  message: string;
}

/** The four resolution layers, in precedence order (env wins). */
export type ConfigLayerKind = "env" | "project" | "user" | "default";

/**
 * A single resolved value plus provenance — which layer it came from. Consumers
 * use `source` for diagnostics ("why is this value X?") and for write-back
 * decisions (only persist values that did not come from `env`).
 */
export interface ResolvedValue<T> {
  value: T;
  source: ConfigLayerKind;
}

/**
 * How an env var string is coerced into a typed value before it participates in
 * precedence. Coercion is the ONE place the loader inspects value shape — and it
 * is opt-in per key, supplied by the consumer, never a domain schema baked in
 * here. A coercer throws to reject a malformed env value (no silent skip).
 */
export type EnvCoercer<T> = (raw: string) => T;

/** Maps a dotted config key to the env var name (and optional coercer). */
export interface EnvBinding<T = unknown> {
  /** Env var name, e.g. "ENGRAM_URL". */
  env: string;
  /**
   * Coerce the raw env string. Defaults to identity (string passthrough). Throw
   * from here to reject a malformed value — the loader rethrows as a
   * `ConfigError` tagged with the key and env name.
   */
  coerce?: EnvCoercer<T>;
}

/**
 * Options for {@link createConfigLoader}. Everything except `appName` has a
 * sensible default; injection points exist for `fs` and `env` so the whole
 * loader is testable without touching real disk or process state.
 */
export interface ConfigLoaderOptions {
  /**
   * Application name, e.g. "centient". Drives the default user-config home
   * (`~/.{appName}`) and the project-config filename (`.{appName}.json`) when
   * those are not overridden below.
   */
  appName: string;

  /**
   * Default values — the lowest-precedence layer. A flat record keyed by dotted
   * path (e.g. `{ "engram.timeoutMs": 10000 }`). Nested objects in project/user
   * files are flattened to the same dotted keys before layering, so a default
   * and a file value for the same logical key always collide correctly.
   */
  defaults?: Readonly<Record<string, unknown>>;

  /**
   * Env bindings — maps dotted keys to env var names. Only keys listed here are
   * eligible to be overridden from the environment; an unbound key never reads
   * `process.env`. This is explicit by design (no magic NAME_MANGLING).
   */
  envBindings?: Readonly<Record<string, EnvBinding>>;

  /**
   * Absolute path to the user config file. Defaults to
   * `{userHome}/config.json` where `userHome` is `~/.{appName}` (or the
   * `homeEnvVar` override target, when set).
   */
  userConfigPath?: string;

  /**
   * Env var that, when set, overrides the user-config home directory (e.g.
   * "CENTIENT_HOME"). Tilde-prefixed values are expanded against `homeDir`.
   */
  homeEnvVar?: string;

  /**
   * Octal permission bits applied to the user config file on every `write()`.
   * Defaults to `0o600` (owner read/write only) because config files routinely
   * hold credentials. NOTE: this mode is ASSERTED on every write — writing back
   * to an existing file resets its permissions to this value. Set it explicitly
   * (e.g. `0o644`) if your deployment needs a different mode, or to opt into a
   * looser policy intentionally rather than having 0o600 imposed silently.
   */
  configFileMode?: number;

  /**
   * Project config filename to search for during walk-up discovery. Defaults to
   * `.{appName}.json`.
   */
  projectConfigFilename?: string;

  /**
   * Directory to begin project-config walk-up from. Defaults to `cwd()`.
   */
  projectPath?: string;

  /**
   * Marker directory/file names that identify a project root during walk-up
   * (in addition to the project config file itself). Defaults to
   * `[".git"]`. A `package.json` carrying a `workspaces` field also marks a
   * root.
   */
  projectRootMarkers?: readonly string[];

  /**
   * Maximum number of ancestor directories the project-root walk-up will inspect
   * before giving up. Defaults to 64, which is ample for typical layouts; raise
   * it for unusually deeply nested enterprise monorepos. Must be a positive
   * integer (non-integer/non-positive values fall back to the default).
   */
  projectMaxWalkUpDepth?: number;

  /** Injected filesystem. Defaults to a `node:fs`-backed adapter. */
  fs?: FileSystem;
  /** Injected env provider. Defaults to a `process.env`-backed adapter. */
  env?: EnvProvider;
  /** Injected home directory. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Injected cwd. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Optional warning sink. */
  logger?: ConfigLogger;
}

/**
 * The result of a full resolution pass. `get`/`getResolved` read individual
 * keys; `all` is the flattened merged view; `warnings` collects every non-fatal
 * issue encountered while building this snapshot.
 */
export interface ConfigSnapshot {
  /** Flattened, fully-merged config (highest-precedence value per key). */
  readonly all: Readonly<Record<string, unknown>>;
  /** Non-fatal warnings gathered during this resolution. */
  readonly warnings: readonly ConfigWarning[];
  /** Absolute path of the project config that was loaded, or null. */
  readonly projectConfigPath: string | null;
  /** Absolute path of the user config file (whether or not it exists). */
  readonly userConfigPath: string;
}
