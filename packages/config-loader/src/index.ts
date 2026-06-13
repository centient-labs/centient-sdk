/**
 * `@centient/config-loader` — layered configuration resolution.
 *
 * Resolves a single value per key across four layers, highest precedence first:
 * env > project file > user file > defaults. Caches the merged result, surfaces
 * malformed files as hard errors (no silent fallthrough), supports write-back to
 * the user layer, and ships tilde-app path + project-root discovery helpers.
 *
 * This package LAYERS and RESOLVES. It does not validate domain shapes — keep
 * your validation schemas in the consumer; supply per-key `EnvCoercer`s if you
 * need env strings coerced before they participate in precedence.
 */

export { createConfigLoader } from "./loader.js";
export type { ConfigLoader } from "./loader.js";

export { ConfigError } from "./errors.js";
export type { ConfigErrorCode } from "./errors.js";

export { discoverProjectRoot, DEFAULT_MAX_WALK_UP_DEPTH } from "./discovery.js";
export type {
  DiscoveryOptions,
  DiscoveryResult,
  DiscoveryWarning,
} from "./discovery.js";

export {
  expandTilde,
  resolveAppHome,
  ensureAppHome,
  APP_HOME_MODE,
  CONFIG_FILE_MODE,
} from "./paths.js";

export { expandEnvRefs, expandEnvRefsDeep } from "./expand.js";
export { flatten, unflatten } from "./flatten.js";

export { createNodeFileSystem, createProcessEnv } from "./fs-adapter.js";

export type {
  FileSystem,
  EnvProvider,
  ConfigLogger,
  ConfigWarning,
  ConfigLayerKind,
  ResolvedValue,
  EnvCoercer,
  EnvBinding,
  ConfigLoaderOptions,
  ConfigSnapshot,
} from "./types.js";
