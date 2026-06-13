/**
 * Public types for the hardened subprocess runner.
 *
 * The runner is binary-agnostic: callers pass the executable and its argument
 * vector explicitly. Nothing in this package knows about any particular tool.
 */

import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from "node:child_process";

/**
 * Discriminates the way a process run failed. Every {@link ProcError} carries
 * exactly one of these kinds.
 *
 * - `spawn-failure`   — the process could not be started (e.g. `ENOENT` when
 *                       the binary is not on `PATH`, or `EACCES`).
 * - `non-zero-exit`   — the process started and exited with a non-zero code.
 * - `timeout`         — the process exceeded `timeoutMs` and was killed by the
 *                       runner's kill escalation.
 * - `signal`          — the process was terminated by a signal that the runner
 *                       did not itself send for timeout/abort reasons.
 * - `buffer-overflow` — stdout or stderr exceeded the configured byte cap and
 *                       the process was killed.
 * - `aborted`         — the supplied {@link AbortSignal} fired and the process
 *                       was killed.
 * - `stdin-error`     — writing the supplied `input` to the child's stdin failed
 *                       with an unexpected I/O error (e.g. `ENOSPC`) AND the
 *                       process otherwise exited cleanly, so the failure would
 *                       otherwise be silently lost. Expected pipe-teardown errors
 *                       (`EPIPE`, `ERR_STREAM_DESTROYED`) are NOT reported this
 *                       way — they just mean the child stopped reading.
 */
export type ProcErrorKind =
  | "spawn-failure"
  | "non-zero-exit"
  | "timeout"
  | "signal"
  | "buffer-overflow"
  | "aborted"
  | "stdin-error";

/**
 * How captured output is presented.
 *
 * `"buffer"` returns raw {@link Buffer}s; any other value is a Node.js
 * {@link BufferEncoding} applied via `Buffer.prototype.toString`.
 */
export type ProcEncoding = BufferEncoding | "buffer";

/** Captured output and exit metadata for a process that ran to completion. */
export interface ProcResult {
  /** Captured stdout, decoded with the configured {@link RunOptions.encoding} (or raw Buffer when `encoding: "buffer"`). */
  readonly stdout: string | Buffer;
  /** Captured stderr, decoded with the configured {@link RunOptions.encoding} (or raw Buffer when `encoding: "buffer"`). */
  readonly stderr: string | Buffer;
  /** Exit code. Always `0` for a successful {@link ProcResult}. */
  readonly exitCode: number;
  /** Signal that terminated the process, if any. `null` on a normal exit. */
  readonly signal: NodeJS.Signals | null;
}

/**
 * Injectable clock so timeout behaviour is testable without real sleeps.
 * The default implementation delegates to the global timer functions.
 */
export interface Clock {
  setTimeout(handler: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Opaque timer handle returned by {@link Clock.setTimeout}. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

/**
 * The subset of `node:child_process` `spawn` used by the runner. Injectable so
 * tests can substitute a fake child process and exercise every settle path.
 */
export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options: NodeSpawnOptions
) => ChildProcess;

/** Options controlling a single process run. */
export interface RunOptions {
  /** Argument vector. Passed verbatim to the child; never shell-interpreted. */
  readonly args?: readonly string[];

  /**
   * Hard wall-clock limit in milliseconds. On expiry the runner escalates
   * SIGTERM then SIGKILL (see {@link RunOptions.killGraceMs}) and settles with a
   * `timeout` {@link ProcError}. Omit or set `0` to disable the timeout.
   */
  readonly timeoutMs?: number;

  /**
   * Grace period in milliseconds between the initial SIGTERM and the follow-up
   * SIGKILL when the runner terminates a process (timeout, abort, or buffer
   * overflow). Defaults to {@link DEFAULT_KILL_GRACE_MS}.
   *
   * Set `0` for *no* grace: the runner sends SIGKILL immediately and does NOT
   * also send SIGTERM (a same-tick SIGTERM the child could never act on before
   * SIGKILL would be pure noise).
   */
  readonly killGraceMs?: number;

  /** Maximum bytes buffered for stdout before the process is killed with a `buffer-overflow` error. */
  readonly maxStdoutBytes?: number;
  /** Maximum bytes buffered for stderr before the process is killed with a `buffer-overflow` error. */
  readonly maxStderrBytes?: number;

  /** Data to stream to the child's stdin. The pipe is closed after writing. */
  readonly input?: string | Buffer;

  /**
   * How to present captured output.
   *
   * - `"buffer"` returns the raw `Buffer`s unchanged.
   * - Any Node.js {@link https://nodejs.org/api/buffer.html#buffers-and-character-encodings | `BufferEncoding`}
   *   (`"utf8"` (default), `"utf-8"`, `"ascii"`, `"latin1"`, `"hex"`, `"base64"`,
   *   `"base64url"`, `"utf16le"`, `"ucs2"`, `"binary"`) decodes the captured bytes
   *   with `Buffer.prototype.toString(encoding)`.
   *
   * The decode is applied once, to the fully-concatenated stream, so multi-byte
   * sequences split across chunk boundaries are never mis-decoded.
   */
  readonly encoding?: ProcEncoding;

  /** Working directory for the child process. */
  readonly cwd?: string;

  /** Environment for the child process. When omitted the parent environment is inherited. */
  readonly env?: NodeJS.ProcessEnv;

  /**
   * When fired, the runner kills the process (SIGTERM then SIGKILL) and settles
   * with an `aborted` {@link ProcError}. If the signal is already aborted the
   * runner rejects before spawning.
   */
  readonly signal?: AbortSignal;

  /** Override the spawn implementation. Defaults to `node:child_process` `spawn`. */
  readonly spawnImpl?: SpawnImpl;

  /** Override the clock used for timeout/kill-grace timers. Defaults to global timers. */
  readonly clock?: Clock;
}

/**
 * Default grace period between SIGTERM and SIGKILL, in milliseconds.
 *
 * These constants are deliberately exported as plain values with no
 * application-wide "configure these globally" hook. `runProcess` is a pure
 * function whose behaviour is fully determined by its arguments — there is no
 * hidden mutable state to keep it deterministic and trivially testable. Callers
 * who want a different default everywhere wrap `runProcess` once and pass their
 * own override (e.g.
 * `const run = (cmd, o) => runProcess(cmd, { killGraceMs: 1000, ...o })`),
 * which keeps the default explicit and local rather than global and ambient.
 */
export const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Default per-stream buffer cap, in bytes (10 MiB). See
 * {@link DEFAULT_KILL_GRACE_MS} for why there is no global override mechanism.
 */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
