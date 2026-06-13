export {
  resolveColorSupport,
  detectCapabilities,
  detectTerminalCapabilities,
  makeAnsiColors,
  createAnsiColors,
  colorize,
  writeError,
  defaultErrorSink,
  DEFAULT_WIDTH,
} from "./colors.js";

export type {
  StreamInfo,
  EnvRecord,
  TerminalCapabilities,
  AnsiColors,
} from "./colors.js";

export {
  SemverError,
  parseSemver,
  formatSemver,
  compareSemver,
  compareVersions,
  satisfies,
} from "./semver.js";

export type { SemverTuple } from "./semver.js";
