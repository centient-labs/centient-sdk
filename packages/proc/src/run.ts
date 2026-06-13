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
  type ProcEncoding,
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
  private accumulated = 0;

  constructor(private readonly limit: number) {}

  /** Append a chunk. Returns `true` when the cap is exceeded. */
  push(chunk: Buffer): boolean {
    this.accumulated += chunk.length;
    this.chunks.push(chunk);
    return this.accumulated > this.limit;
  }

  /** Total bytes accumulated so far (including any over-cap chunk). */
  get size(): number {
    return this.accumulated;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/**
 * Run a process to completion.
 *
 * @param command  The executable to run. Passed verbatim to `spawn` as the
 *                 program image — NOT through a shell. The runner never sets
 *                 `shell: true`, so `command` and `args` are not tokenised,
 *                 glob-expanded, or variable-interpolated by any shell: a value
 *                 like `"foo; rm -rf /"` is treated as a single (non-existent)
 *                 program name and fails with `spawn-failure`, never as two
 *                 commands. There is therefore no shell-metacharacter attack
 *                 surface to sanitise here — sanitising would only break the
 *                 binary-agnostic contract (callers legitimately pass arbitrary
 *                 absolute paths and argument bytes). The one genuine foot-gun —
 *                 an empty / non-string `command` — is rejected eagerly below.
 *
 *                 Callers who must run *shell* syntax should do so explicitly by
 *                 invoking the shell as the program (e.g.
 *                 `runProcess("/bin/sh", { args: ["-c", script] })`) and own the
 *                 quoting of `script` themselves; this runner will not do it for
 *                 them implicitly.
 * @param options  See {@link RunOptions}.
 */
export function runProcess(command: string, options: RunOptions = {}): Promise<ProcResult> {
  const args = options.args ?? [];
  const clock = options.clock ?? systemClock;
  const spawnImpl: SpawnImpl = options.spawnImpl ?? (spawn as SpawnImpl);
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_BYTES;
  const encoding: ProcEncoding = options.encoding ?? "utf8";

  return new Promise<ProcResult>((resolve, reject) => {
    // Reject an empty / non-string command before touching the OS. This is the
    // one input that is unambiguously a caller bug (passing `spawn` an empty
    // program image yields confusing platform-specific failures). It is NOT a
    // shell-injection guard — see the doc comment on why there is no shell
    // surface to sanitise.
    if (typeof command !== "string" || command.length === 0) {
      reject(
        new ProcError("spawn-failure", "Command must be a non-empty string", {
          command: String(command),
          args,
        })
      );
      return;
    }

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
    // An UNEXPECTED stdin write error (not EPIPE / stream-destroyed), captured so
    // that an otherwise-clean exit does not silently drop a real I/O failure.
    let stdinError: NodeJS.ErrnoException | undefined;

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

    // Cancel a pending SIGKILL-escalation timer. The kill timer is armed AFTER
    // `settle` (so `clearTimers` cannot reach it) to guarantee the child is
    // force-killed if it ignores SIGTERM. But once the child has actually exited
    // — the `close`/`error` events below — escalation is moot, so the timer must
    // be torn down or it dangles for the whole grace window, holding the event
    // loop open and firing a redundant SIGKILL at a dead (possibly recycled) PID.
    const cancelKillTimer = (): void => {
      if (killTimer !== undefined) {
        clock.clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    // Decode the fully-concatenated stream exactly once with the configured
    // encoding. Concatenating before decoding (rather than per-chunk) means a
    // multi-byte sequence split across a chunk boundary is never mis-decoded.
    const decode = (buf: Buffer): string | Buffer =>
      encoding === "buffer" ? buf : buf.toString(encoding);

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
      if (killGraceMs > 0) {
        // Give the child a chance to shut down cleanly on SIGTERM, then force
        // it down with SIGKILL if it is still alive after the grace window.
        child.kill("SIGTERM");
        killTimer = clock.setTimeout(() => {
          child.kill("SIGKILL");
        }, killGraceMs);
      } else {
        // killGraceMs === 0 means "no grace": go straight to SIGKILL. Sending
        // SIGTERM as well would be a redundant, racing signal delivered in the
        // same tick — the child cannot act on it before SIGKILL lands.
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
    const overflow = (stream: "stdout" | "stderr", limit: number, actual: number): void => {
      settle(() =>
        reject(
          new ProcError(
            "buffer-overflow",
            `Process ${stream} exceeded ${limit} byte cap (accumulated ${actual} bytes): ${command}`,
            {
              command,
              args,
              limitBytes: limit,
              actualBytes: actual,
              stdout: decode(stdout.toBuffer()),
              stderr: decode(stderr.toBuffer()),
            }
          )
        )
      );
      escalateKill();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.push(chunk)) overflow("stdout", maxStdoutBytes, stdout.size);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.push(chunk)) overflow("stderr", maxStderrBytes, stderr.size);
    });

    // --- Spawn failure --------------------------------------------------------
    // `error` fires when the process could not be spawned at all (e.g. ENOENT).
    // It can also fire after a successful spawn for stdio errors; in either case
    // we treat the first terminal signal as authoritative via `settle`.
    child.on("error", (err: NodeJS.ErrnoException) => {
      // The child is gone; a pending SIGKILL escalation is no longer needed.
      cancelKillTimer();
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
      // The child has exited for good. If an earlier terminal path armed the
      // SIGKILL escalation timer, tear it down — the process is already gone.
      cancelKillTimer();

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
        // The process exited cleanly. If feeding its stdin failed with an
        // unexpected error, the "success" is not trustworthy (the child may have
        // acted on truncated input), so surface it rather than swallow it.
        if (stdinError !== undefined) {
          const cause = stdinError;
          settle(() =>
            reject(
              new ProcError(
                "stdin-error",
                `Process exited 0 but writing stdin failed: ${command}: ${cause.message}`,
                { command, args, exitCode: 0, signal: null, stdout: out, stderr: errOut, cause }
              )
            )
          );
          return;
        }
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
      // Distinguish expected pipe teardown from real I/O failures.
      //
      // EPIPE / ERR_STREAM_DESTROYED just mean the child stopped reading (it
      // exited or closed stdin early); the close/error path reports the actual
      // outcome, so these are swallowed. Any OTHER error (e.g. ENOSPC on a
      // backing pipe) is a genuine failure the caller must hear about, so it is
      // captured and — if the process nonetheless exits 0 — surfaced as a
      // `stdin-error` rather than masked behind a misleading success.
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        const expected = err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED";
        if (!expected && stdinError === undefined) stdinError = err;
      });
      child.stdin.end(data);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
