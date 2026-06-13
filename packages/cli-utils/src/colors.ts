/**
 * Terminal capability detection and ANSI color helpers.
 *
 * Reconciled superset of two duplicated copies:
 *   - support/cli `src/lib/colors.ts`
 *   - crucible `packages/crucible/src/cli-utils.ts` (which additionally
 *     carried `writeError`; ported here)
 *
 * Both originals read `process.env` and `process.stdout`/`process.stderr`
 * globals directly, which makes capability detection awkward to unit-test.
 * The detection logic is refactored into a pure core (`resolveColorSupport`,
 * `detectCapabilities`) that takes an injectable env record and stream
 * descriptor. Thin convenience wrappers (`detectTerminalCapabilities`,
 * `createAnsiColors`) read the live `process` for ergonomic CLI call sites.
 */

/**
 * Minimal description of a writable stream's terminal attributes. Mirrors the
 * subset of `NodeJS.WriteStream` that capability detection consults, so tests
 * can pass a plain object instead of a real TTY.
 */
export interface StreamInfo {
  /** Whether the stream is attached to a TTY. */
  isTTY?: boolean;
  /** Terminal column count (0 or undefined when not a TTY). */
  columns?: number;
}

/** A `process.env`-like record. Values may be absent (`undefined`). */
export type EnvRecord = Record<string, string | undefined>;

/**
 * Terminal capability flags for a given output stream.
 * Used to make informed decisions about ANSI color, width, and formatting.
 */
export interface TerminalCapabilities {
  isTTY: boolean;
  hasColor: boolean;
  isDumb: boolean;
  width: number;
}

/**
 * Default column count used when a stream reports no usable width (non-TTY
 * streams frequently report `0` or `undefined`).
 *
 * This is the *fallback* {@link detectCapabilities} substitutes into
 * {@link TerminalCapabilities.width}; it is not a knob callers pass in.
 * Consumers that want a different default should not mutate or re-pass this
 * constant — they should read the resolved `width` off the returned
 * {@link TerminalCapabilities} and apply their own clamp. Exported only so
 * tests and callers can assert against the exact fallback value.
 */
export const DEFAULT_WIDTH = 80;

/**
 * Resolve whether color output is supported, given an env record and whether
 * the target stream is a TTY. Pure — reads no globals.
 *
 * Precedence order (highest wins; documented and tested):
 *   1. `FORCE_COLOR` present (any value, including "")  -> color ON
 *   2. `NO_COLOR`    present (any value, including "")  -> color OFF
 *   3. `TERM === "dumb"`                                -> color OFF (dumb)
 *   4. stream is a TTY                                  -> color ON
 *   5. otherwise                                        -> color OFF
 *
 * Presence is tested with `in`/`Object.prototype.hasOwnProperty`, matching the
 * NO_COLOR convention (https://no-color.org): the variable's mere presence is
 * the signal, regardless of value.
 */
export function resolveColorSupport(
  env: EnvRecord,
  isTTY: boolean
): { hasColor: boolean; isDumb: boolean } {
  if (hasKey(env, "FORCE_COLOR")) return { hasColor: true, isDumb: false };
  if (hasKey(env, "NO_COLOR")) return { hasColor: false, isDumb: false };
  if (env.TERM === "dumb") return { hasColor: false, isDumb: true };
  if (isTTY) return { hasColor: true, isDumb: false };
  return { hasColor: false, isDumb: false };
}

/**
 * Detect terminal capabilities from an injectable env record and stream
 * descriptor. Pure — reads no globals. This is the unit-testable core behind
 * {@link detectTerminalCapabilities}.
 *
 * Width uses a `> 0` check so non-TTY streams (where `columns` is `0` or
 * `undefined`) fall back to {@link DEFAULT_WIDTH}.
 */
export function detectCapabilities(
  env: EnvRecord,
  stream: StreamInfo
): TerminalCapabilities {
  const isTTY = stream.isTTY ?? false;
  const { hasColor, isDumb } = resolveColorSupport(env, isTTY);
  const columns = stream.columns ?? 0;
  const width = columns > 0 ? columns : DEFAULT_WIDTH;
  return { isTTY, hasColor, isDumb, width };
}

/**
 * Detect terminal capabilities for one of the live process streams.
 * Convenience wrapper over {@link detectCapabilities} that reads `process.env`
 * and the chosen `process` stream. Prefer {@link detectCapabilities} in tests.
 */
export function detectTerminalCapabilities(
  stream: "stdout" | "stderr" = "stdout"
): TerminalCapabilities {
  const s = process[stream] as unknown as StreamInfo;
  return detectCapabilities(process.env, s);
}

/**
 * The ANSI escape codes a color set knows how to emit. Each is either the raw
 * SGR sequence (when color is supported) or an empty string (when it is not),
 * so callers can interpolate unconditionally and degrade to identity.
 */
export interface AnsiColors {
  reset: string;
  bright: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  cyan: string;
}

const ANSI_CODES: AnsiColors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const ANSI_EMPTY: AnsiColors = {
  reset: "",
  bright: "",
  dim: "",
  red: "",
  green: "",
  yellow: "",
  cyan: "",
};

/**
 * Build an ANSI color set. When `enabled` is `false`, every field is the empty
 * string so colorizing degrades to an identity transform.
 *
 * Pure — pass an explicit `enabled` flag (e.g. from
 * `detectCapabilities(env, stream).hasColor`).
 */
export function makeAnsiColors(enabled: boolean): AnsiColors {
  return enabled ? { ...ANSI_CODES } : { ...ANSI_EMPTY };
}

/**
 * Build an ANSI color set for the live `process.stdout`. Convenience wrapper
 * over {@link makeAnsiColors}; CLI processes do not change color state
 * mid-execution, so evaluating capabilities once is safe. Prefer
 * {@link makeAnsiColors} in tests.
 */
export function createAnsiColors(): AnsiColors {
  const { hasColor } = detectTerminalCapabilities("stdout");
  return makeAnsiColors(hasColor);
}

/**
 * Wrap `text` in an ANSI code and a reset, but only when colors are enabled.
 * When `colors.reset` is empty (color disabled) this returns `text` unchanged
 * — the identity-function degradation path.
 */
export function colorize(
  colors: AnsiColors,
  code: keyof Omit<AnsiColors, "reset">,
  text: string
): string {
  const open = colors[code];
  if (open === "") return text;
  return `${open}${text}${colors.reset}`;
}

/**
 * The default sink {@link writeError} uses when no `write` is injected: the
 * live `process.stderr`. Extracted to a module-level constant so the default
 * is a single named reference (not an inline closure rebuilt per call), which
 * keeps {@link writeError}'s signature pure to read and lets tests assert the
 * default exists without invoking the real stderr.
 */
export const defaultErrorSink = (chunk: string): void => {
  process.stderr.write(chunk);
};

/**
 * Write a structured, three-part error to a sink (defaults to
 * {@link defaultErrorSink}, i.e. `process.stderr`). Layout: what went wrong,
 * what was expected, how to recover. Returns void and does not exit —
 * exit-code handling is the caller's responsibility.
 *
 * Ported from crucible `cli-utils.ts` (the superset copy). The `write` sink is
 * injectable so the formatting can be unit-tested without touching the real
 * stderr.
 */
export function writeError(
  what: string,
  expected: string,
  recovery: string,
  write: (chunk: string) => void = defaultErrorSink
): void {
  write(`[ERROR] ${what}\n  Expected: ${expected}\n  Recovery: ${recovery}\n`);
}

function hasKey(env: EnvRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined;
}
