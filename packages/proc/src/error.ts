/**
 * Unified, typed error shape for every subprocess failure mode.
 *
 * A single error class distinguishes the failure kinds via the `kind`
 * discriminant so callers can branch without parsing messages. The class also
 * carries the captured stdout/stderr (when any was produced before the failure)
 * and the exit/signal metadata.
 */

import type { ProcErrorKind } from "./types.js";

/** Structured context attached to a {@link ProcError}. */
export interface ProcErrorContext {
  /** The executable that was run. */
  readonly command: string;
  /** The argument vector the executable was run with. */
  readonly args: readonly string[];
  /** Exit code, when the process started and exited. */
  readonly exitCode?: number;
  /** Terminating signal, when the process was killed. */
  readonly signal?: NodeJS.Signals | null;
  /** stdout captured before the failure. */
  readonly stdout?: string | Buffer;
  /** stderr captured before the failure. */
  readonly stderr?: string | Buffer;
  /** Configured timeout, present on `timeout` errors. */
  readonly timeoutMs?: number;
  /** The byte cap that was exceeded, present on `buffer-overflow` errors. */
  readonly limitBytes?: number;
  /**
   * Bytes actually accumulated on the offending stream when the cap tripped,
   * present on `buffer-overflow` errors. Always `> limitBytes`; lets callers
   * see how far over the limit the stream ran.
   */
  readonly actualBytes?: number;
  /** The underlying error, present on `spawn-failure` errors. */
  readonly cause?: unknown;
}

/**
 * The one error every runner code path rejects with. `kind` is the
 * discriminant; the remaining fields are best-effort context.
 */
export class ProcError extends Error {
  override readonly name = "ProcError";

  /** Which failure mode occurred. */
  readonly kind: ProcErrorKind;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode?: number;
  readonly signal?: NodeJS.Signals | null;
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
  readonly timeoutMs?: number;
  readonly limitBytes?: number;
  readonly actualBytes?: number;

  constructor(kind: ProcErrorKind, message: string, context: ProcErrorContext) {
    super(message, context.cause !== undefined ? { cause: context.cause } : undefined);
    this.kind = kind;
    this.command = context.command;
    this.args = context.args;
    this.exitCode = context.exitCode;
    this.signal = context.signal;
    this.stdout = context.stdout;
    this.stderr = context.stderr;
    this.timeoutMs = context.timeoutMs;
    this.limitBytes = context.limitBytes;
    this.actualBytes = context.actualBytes;
  }
}

/** Narrowing type guard for {@link ProcError}. */
export function isProcError(value: unknown): value is ProcError {
  return value instanceof ProcError;
}
