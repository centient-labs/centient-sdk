/**
 * Hardened subprocess runner.
 *
 * `runProcess` spawns a child process and returns a promise that settles
 * EXACTLY ONCE — resolving with a {@link ProcResult} on a clean (zero-exit) run,
 * or rejecting with a {@link ProcError} for every failure mode. The single
 * `settle` gate is the load-bearing invariant: races between the `close`,
 * `error`, timeout, abort, and buffer-cap paths can all fire, but only the
 * first one to call `settle` wins.
 *
 * Design constraints:
 * - `node:child_process` only; zero external runtime dependencies.
 * - The clock and the spawn implementation are injectable so timeout and kill
 *   escalation are tested without real sleeps or real processes.
 * - On timeout or abort the runner escalates SIGTERM then, after a grace
 *   period, SIGKILL — it never relies on the child cooperating.
 */

import { spawn } from "node:child_process";
import { ProcError } from "./error.js";
import {
  type Clock,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_MAX_BYTES,
  type ProcResult,
  type RunOptions,
  type SpawnImpl,
  type TimerHandle,
} from "./types.js";

/** Default clock: thin wrapper over the global timer functions. */
const systemClock: Clock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Accumulates a capped stream into a list of chunks, tracking total size. */
class CappedBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  /** Append a chunk. Returns `true` when the cap is exceeded. */
  push(chunk: Buffer): boolean {
    this.size += chunk.length;
    this.chunks.push(chunk);
    return this.size > this.limit;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/**
 * Run a process to completion.
 *
 * @param command  The executable to run. Passed verbatim to `spawn` — never
 *                 shell-interpreted, so callers are not exposed to shell
 *                 injection through `command` or `args`.
 * @param options  See {@link RunOptions}.
 */
export function runProcess(command: string, options: RunOptions = {}): Promise<ProcResult> {
  const args = options.args ?? [];
  const clock = options.clock ?? systemClock;
  const spawnImpl: SpawnImpl = options.spawnImpl ?? (spawn as SpawnImpl);
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_BYTES;
  const asBuffer = options.encoding === "buffer";

  return new Promise<ProcResult>((resolve, reject) => {
    // Pre-spawn abort: reject before touching the OS.
    if (options.signal?.aborted) {
      reject(
        new ProcError("aborted", `Process aborted before start: ${command}`, {
          command,
          args,
          cause: options.signal.reason,
        })
      );
      return;
    }

    const stdout = new CappedBuffer(maxStdoutBytes);
    const stderr = new CappedBuffer(maxStderrBytes);

    // --- The settle-once gate -------------------------------------------------
    // Every terminal path funnels through `settle`. The `settled` flag makes a
    // double-resolve / double-reject structurally impossible.
    let settled = false;
    let timeoutTimer: TimerHandle | undefined;
    let killTimer: TimerHandle | undefined;
    let onAbort: (() => void) | undefined;

    const clearTimers = (): void => {
      if (timeoutTimer !== undefined) clock.clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clock.clearTimeout(killTimer);
      if (onAbort && options.signal) options.signal.removeEventListener("abort", onAbort);
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      fn();
    };

    const decode = (buf: Buffer): string | Buffer => (asBuffer ? buf : buf.toString("utf8"));

    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      // Pipe all three streams; stdin is closed after `input` (if any) is written.
      stdio: ["pipe", "pipe", "pipe"],
    });

    // --- Kill escalation: SIGTERM now, SIGKILL after the grace window ---------
    // Used by both the timeout and abort paths. It does NOT settle on its own;
    // the caller arms `settle` first, then the eventual `close`/`error` is a
    // no-op because we have already settled.
    const escalateKill = (): void => {
      child.kill("SIGTERM");
      if (killGraceMs > 0) {
        killTimer = clock.setTimeout(() => {
          // If the child is still alive, force it down.
          child.kill("SIGKILL");
        }, killGraceMs);
      } else {
        child.kill("SIGKILL");
      }
    };

    // --- Timeout --------------------------------------------------------------
    if (options.timeoutMs && options.timeoutMs > 0) {
      const timeoutMs = options.timeoutMs;
      timeoutTimer = clock.setTimeout(() => {
        settle(() =>
          reject(
            new ProcError("timeout", `Process timed out after ${timeoutMs}ms: ${command}`, {
              command,
              args,
              timeoutMs,
              stdout: decode(stdout.toBuffer()),
              stderr: decode(stderr.toBuffer()),
            })
          )
        );
        escalateKill();
      }, timeoutMs);
    }

    // --- Abort ----------------------------------------------------------------
    if (options.signal) {
      onAbort = (): void => {
        settle(() =>
          reject(
            new ProcError("aborted", `Process aborted: ${command}`, {
              command,
              args,
              cause: options.signal?.reason,
              stdout: decode(stdout.toBuffer()),
              stderr: decode(stderr.toBuffer()),
            })
          )
        );
        escalateKill();
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    // --- Buffer caps ----------------------------------------------------------
    const overflow = (stream: "stdout" | "stderr", limit: number): void => {
      settle(() =>
        reject(
          new ProcError(
            "buffer-overflow",
            `Process ${stream} exceeded ${limit} byte cap: ${command}`,
            {
              command,
              args,
              limitBytes: limit,
              stdout: decode(stdout.toBuffer()),
              stderr: decode(stderr.toBuffer()),
            }
          )
        )
      );
      escalateKill();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.push(chunk)) overflow("stdout", maxStdoutBytes);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.push(chunk)) overflow("stderr", maxStderrBytes);
    });

    // --- Spawn failure --------------------------------------------------------
    // `error` fires when the process could not be spawned at all (e.g. ENOENT).
    // It can also fire after a successful spawn for stdio errors; in either case
    // we treat the first terminal signal as authoritative via `settle`.
    child.on("error", (err: NodeJS.ErrnoException) => {
      settle(() =>
        reject(
          new ProcError("spawn-failure", `Failed to spawn process: ${command}: ${err.message}`, {
            command,
            args,
            cause: err,
          })
        )
      );
    });

    // --- Clean / non-zero / signalled exit ------------------------------------
    child.on("close", (code, signal) => {
      const out = decode(stdout.toBuffer());
      const errOut = decode(stderr.toBuffer());

      if (signal !== null) {
        // Killed by a signal we did NOT send for timeout/abort/overflow — those
        // paths have already called settle, so reaching here means an external
        // signal. The settle guard makes this a no-op after our own kills.
        settle(() =>
          reject(
            new ProcError("signal", `Process killed by signal ${signal}: ${command}`, {
              command,
              args,
              signal,
              stdout: out,
              stderr: errOut,
            })
          )
        );
        return;
      }

      const exitCode = code ?? 0;
      if (exitCode === 0) {
        settle(() => resolve({ stdout: out, stderr: errOut, exitCode: 0, signal: null }));
      } else {
        settle(() =>
          reject(
            new ProcError("non-zero-exit", `Process exited with code ${exitCode}: ${command}`, {
              command,
              args,
              exitCode,
              signal: null,
              stdout: out,
              stderr: errOut,
            })
          )
        );
      }
    });

    // --- stdin streaming ------------------------------------------------------
    if (options.input !== undefined && child.stdin) {
      const data = Buffer.isBuffer(options.input)
        ? options.input
        : Buffer.from(options.input, "utf8");
      // Swallow EPIPE: if the child exits before draining stdin, the write
      // error is not the interesting failure — the close/error path reports it.
      child.stdin.on("error", () => {});
      child.stdin.end(data);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
