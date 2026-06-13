/**
 * Error types for `@centient/config-loader`.
 *
 * Per the no-silent-degradation principle, a malformed config FILE is a hard
 * error surfaced to the caller — never a silent skip that falls through to the
 * next layer. These typed errors let consumers distinguish "your file is
 * broken" from "the value you asked for is missing".
 */

/** Discriminates the failure mode without string-matching messages. */
export type ConfigErrorCode =
  | "MALFORMED_FILE"
  | "INVALID_ENV"
  | "WRITE_FAILED"
  | "READ_FAILED";

/**
 * Raised for any unrecoverable config-resolution failure. Carries the offending
 * path/key/source so callers can render an actionable message.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  /** Filesystem path involved, when applicable. */
  readonly path?: string;
  /** Dotted config key involved, when applicable. */
  readonly key?: string;
  /** Underlying cause, preserved for stack-trace forensics. */
  override readonly cause?: unknown;

  constructor(
    code: ConfigErrorCode,
    message: string,
    details: { path?: string; key?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.path = details.path;
    this.key = details.key;
    this.cause = details.cause;
    // Restore prototype chain for instanceof across the ES2022 transpile target.
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}
