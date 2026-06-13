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
 */
export type ProcErrorKind =
  | "spawn-failure"
  | "non-zero-exit"
  | "timeout"
  | "signal"
  | "buffer-overflow"
  | "aborted";

/** Captured output and exit metadata for a process that ran to completion. */
export interface ProcResult {
  /** Captured stdout, decoded as UTF-8 (or raw Buffer when `encoding: "buffer"`). */
  readonly stdout: string | Buffer;
  /** Captured stderr, decoded as UTF-8 (or raw Buffer when `encoding: "buffer"`). */
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
   * SIGKILL when the runner terminates a process (timeout or abort). Defaults
   * to {@link DEFAULT_KILL_GRACE_MS}.
   */
  readonly killGraceMs?: number;

  /** Maximum bytes buffered for stdout before the process is killed with a `buffer-overflow` error. */
  readonly maxStdoutBytes?: number;
  /** Maximum bytes buffered for stderr before the process is killed with a `buffer-overflow` error. */
  readonly maxStderrBytes?: number;

  /** Data to stream to the child's stdin. The pipe is closed after writing. */
  readonly input?: string | Buffer;

  /** How to present captured output. `"utf8"` (default) decodes to strings; `"buffer"` returns raw Buffers. */
  readonly encoding?: "utf8" | "buffer";

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

/** Default grace period between SIGTERM and SIGKILL, in milliseconds. */
export const DEFAULT_KILL_GRACE_MS = 5_000;

/** Default per-stream buffer cap, in bytes (10 MiB). */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
