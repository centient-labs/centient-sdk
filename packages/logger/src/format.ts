/**
 * Log Formatting Utilities
 *
 * Provides pretty (ANSI colored) and JSON formatting for log entries.
 *
 * @module format
 */

import type { LogEntry, LogLevel } from "./types.js";

/**
 * ANSI color codes for log levels
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m", // gray
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  fatal: "\x1b[35m", // magenta
};

const RESET = "\x1b[0m";

/**
 * Format a log entry as pretty-printed colored output for terminal display
 *
 * Format: HH:mm:ss.SSS LEVEL [component] message key=value ...
 *
 * @param entry - The log entry to format
 * @returns Formatted string with ANSI colors
 *
 * @example
 * const entry = { timestamp: "2025-01-25T10:30:45.123Z", level: "info", ... };
 * formatPretty(entry);
 * // Returns: "10:30:45.123 INFO  [my-component] Session started sessionId=abc123"
 */
export function formatPretty(entry: LogEntry): string {
  const time = entry.timestamp.slice(11, 23);
  const color = LEVEL_COLORS[entry.level];

  // Extract standard fields to avoid duplication in context display.
  // `version` is intentionally NOT stripped — if the caller put it in context,
  // it belongs in the rendered tail like any other user field.
  const {
    level: _l,
    timestamp: _t,
    message,
    component,
    service: _s,
    pid: _p,
    hostname: _h,
    ...rest
  } = entry;

  const contextParts: string[] = [];
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "object") {
      contextParts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      contextParts.push(`${key}=${value}`);
    }
  }
  const contextStr = contextParts.length > 0 ? ` ${contextParts.join(" ")}` : "";
  const componentStr = component !== "main" ? `[${component}] ` : "";

  return `${time} ${color}${entry.level.toUpperCase().padEnd(5)}${RESET} ${componentStr}${message}${contextStr}`;
}

/**
 * Format a log entry as a JSON string
 *
 * @param entry - The log entry to format
 * @returns JSON string representation
 */
export function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Configuration options for isPrettyEnabled
 */
export interface PrettyEnabledOptions {
  /** Explicit override for pretty printing (true/false) */
  logPretty?: string;
  /** Node environment (e.g., "production", "development") */
  nodeEnv?: string;
}

/**
 * Check if pretty printing should be enabled
 *
 * When called with options, uses the provided values.
 * When called without options, falls back to process.env for backward compatibility.
 *
 * @param options - Optional configuration (logPretty, nodeEnv)
 * @returns true if pretty printing should be used
 *
 * @example
 * // Use explicit config (recommended)
 * isPrettyEnabled({ logPretty: "true" }); // true
 * isPrettyEnabled({ nodeEnv: "production" }); // false
 *
 * // Legacy: reads from process.env (for backward compatibility)
 * isPrettyEnabled(); // reads LOG_PRETTY and NODE_ENV from process.env
 */
export function isPrettyEnabled(options?: PrettyEnabledOptions): boolean {
  // Get values from options or fall back to process.env for backward compatibility
  const logPretty = options?.logPretty ?? process.env.LOG_PRETTY;
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;

  if (logPretty === "true") return true;
  if (logPretty === "false") return false;
  // Default: pretty in non-production, JSON in production
  return nodeEnv !== "production";
}

/**
 * Configuration options for getConfiguredLevel
 */
export interface ConfiguredLevelOptions {
  /** Log level string (e.g., "debug", "info", "warn") */
  logLevel?: string;
}

/**
 * Get the configured log level
 *
 * When called with options, uses the provided value.
 * When called without options, falls back to process.env.LOG_LEVEL for backward compatibility.
 *
 * @param options - Optional configuration (logLevel)
 * @returns The configured log level, defaults to "info"
 *
 * @example
 * // Use explicit config (recommended)
 * getConfiguredLevel({ logLevel: "debug" }); // "debug"
 * getConfiguredLevel({ logLevel: "WARN" }); // "warn" (case-insensitive)
 *
 * // Legacy: reads from process.env (for backward compatibility)
 * getConfiguredLevel(); // reads LOG_LEVEL from process.env
 */
export function getConfiguredLevel(options?: ConfiguredLevelOptions): LogLevel {
  // Get value from options or fall back to process.env for backward compatibility
  const rawLevel = options?.logLevel ?? process.env.LOG_LEVEL;
  const envLevel = rawLevel?.toLowerCase();
  const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
  if (envLevel && validLevels.includes(envLevel)) {
    return envLevel as LogLevel;
  }
  return "info";
}

/**
 * Generate a filesystem-safe timestamp string for log rotation filenames
 *
 * Format: YYYY-MM-DDTHHMMSS (no colons or periods)
 *
 * @param date - The date to format, defaults to current time
 * @returns Filesystem-safe timestamp string
 *
 * @example
 * generateRotationTimestamp(new Date("2025-01-25T10:30:45.123Z"));
 * // Returns: "2025-01-25T10-30-45"
 */
export function generateRotationTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
