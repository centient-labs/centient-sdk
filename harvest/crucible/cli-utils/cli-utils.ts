/**
 * Shared CLI Utilities
 *
 * Common utilities for all crucible CLI subcommands:
 * - writeError: Structured three-part error output to stderr
 * - detectTerminalCapabilities: FORCE_COLOR/NO_COLOR/TERM=dumb capability detection
 *
 * ADR-004 D4/D5: Shared writeError pattern and NO_COLOR convention.
 */

/**
 * Write a structured error to stderr.
 * Three-part layout: what went wrong, what was expected, how to recover.
 * Returns void (does not exit). Exit code handling is the caller's responsibility.
 */
export function writeError(what: string, expected: string, recovery: string): void {
  process.stderr.write(
    `[ERROR] ${what}\n  Expected: ${expected}\n  Recovery: ${recovery}\n`,
  );
}

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
 * Detect terminal capabilities for the given stream.
 * Precedence chain: FORCE_COLOR > NO_COLOR > TERM=dumb > isTTY > default.
 *
 * - FORCE_COLOR (any value): forces hasColor=true, isTTY from stream
 * - NO_COLOR (any value): forces hasColor=false
 * - TERM=dumb: forces hasColor=false and isDumb=true
 * - isTTY===true: hasColor=true
 * - default: hasColor=false
 *
 * Width uses a >0 check to handle non-TTY streams where columns may be 0.
 */
export function detectTerminalCapabilities(
  stream: "stdout" | "stderr" = "stdout",
): TerminalCapabilities {
  const s = process[stream] as NodeJS.WriteStream;
  const isTTY = s.isTTY ?? false;

  let hasColor: boolean;
  let isDumb = false;

  if ("FORCE_COLOR" in process.env) {
    hasColor = true;
  } else if ("NO_COLOR" in process.env) {
    hasColor = false;
  } else if (process.env.TERM === "dumb") {
    hasColor = false;
    isDumb = true;
  } else if (isTTY) {
    hasColor = true;
  } else {
    hasColor = false;
  }

  const width = s.columns > 0 ? s.columns : 80;

  return { isTTY, hasColor, isDumb, width };
}

/**
 * ANSI color codes for CLI output.
 * Evaluates detectTerminalCapabilities() once at creation time and returns plain properties.
 * CLI processes do not change color state mid-execution, so caching is safe.
 *
 * ADR-004 D5: Shared ANSI constant, NO_COLOR-aware.
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

export function createAnsiColors(): AnsiColors {
  const { hasColor: enabled } = detectTerminalCapabilities('stdout');
  return {
    reset: enabled ? "\x1b[0m" : "",
    bright: enabled ? "\x1b[1m" : "",
    dim: enabled ? "\x1b[2m" : "",
    red: enabled ? "\x1b[31m" : "",
    green: enabled ? "\x1b[32m" : "",
    yellow: enabled ? "\x1b[33m" : "",
    cyan: enabled ? "\x1b[36m" : "",
  };
}
