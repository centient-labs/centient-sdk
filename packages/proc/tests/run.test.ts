import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { isProcError, ProcError, runProcess } from "../src/index.js";
import type { Clock, SpawnImpl, TimerHandle } from "../src/index.js";

const NODE = process.execPath;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * A controllable fake ChildProcess. Drives the runner's event handlers
 * directly so signal/kill/exit races are deterministic — no real OS process.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  /** Signals delivered via kill(), in order. */
  readonly kills: (NodeJS.Signals | number)[] = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal ?? "SIGTERM");
    return true;
  }

  // --- helpers to drive the runner ---
  emitStdout(data: string): void {
    this.stdout.emit("data", Buffer.from(data));
  }
  emitStderr(data: string): void {
    this.stderr.emit("data", Buffer.from(data));
  }
  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
  fail(err: Error): void {
    this.emit("error", err);
  }
}

/** A spawn impl that hands back a pre-built FakeChild. */
function fakeSpawn(child: FakeChild): SpawnImpl {
  return (() => child as unknown as ReturnType<SpawnImpl>) as SpawnImpl;
}

/**
 * A spawn impl that records every invocation (command + args) so a test can
 * assert whether — and how — the child was spawned. Used to prove the
 * pre-spawn guards never reach the OS.
 */
function countingSpawn(child: FakeChild): {
  spawn: SpawnImpl;
  readonly calls: { command: string; args: readonly string[] }[];
} {
  const calls: { command: string; args: readonly string[] }[] = [];
  const spawn = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return child as unknown as ReturnType<SpawnImpl>;
  }) as SpawnImpl;
  return { spawn, calls };
}

/** A manual clock: timers fire only when `tick()` is called. */
class FakeClock implements Clock {
  private seq = 0;
  private readonly timers = new Map<number, { handler: () => void; ms: number }>();

  setTimeout(handler: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { handler, ms });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  /** Fire the timer whose delay equals `ms`. */
  fire(ms: number): void {
    for (const [id, t] of this.timers) {
      if (t.ms === ms) {
        this.timers.delete(id);
        t.handler();
        return;
      }
    }
    throw new Error(`no pending timer for ${ms}ms`);
  }

  get pending(): number {
    return this.timers.size;
  }
}

// ---------------------------------------------------------------------------
// Real-process tests (fast `node -e` commands)
// ---------------------------------------------------------------------------

describe("runProcess — real processes", () => {
  it("resolves with stdout/stderr and exitCode 0 on success", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write('hi'); process.stderr.write('warn')"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hi");
    expect(result.stderr).toBe("warn");
    expect(result.signal).toBeNull();
  });

  it("rejects with non-zero-exit and preserves output", async () => {
    const err = await runProcess(NODE, {
      args: ["-e", "process.stdout.write('partial'); process.exit(3)"],
    }).catch((e) => e);
    expect(isProcError(err)).toBe(true);
    expect((err as ProcError).kind).toBe("non-zero-exit");
    expect((err as ProcError).exitCode).toBe(3);
    expect((err as ProcError).stdout).toBe("partial");
  });

  it("rejects with spawn-failure (ENOENT) when the binary does not exist", async () => {
    const err = await runProcess("this-binary-does-not-exist-xyz", { args: [] }).catch((e) => e);
    expect(isProcError(err)).toBe(true);
    expect((err as ProcError).kind).toBe("spawn-failure");
    expect((err as ProcError).cause).toBeDefined();
  });

  it("round-trips stdin to stdout", async () => {
    const payload = "round-trip-payload-42";
    const result = await runProcess(NODE, {
      args: [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))",
      ],
      input: payload,
    });
    expect(result.stdout).toBe(payload);
  });

  it("returns raw Buffers when encoding is 'buffer'", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write(Buffer.from([0,1,2,3]))"],
      encoding: "buffer",
    });
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect([...(result.stdout as Buffer)]).toEqual([0, 1, 2, 3]);
  });

  it("kills a slow process on timeout (real, short timeout)", async () => {
    const start = Date.now();
    const err = await runProcess(NODE, {
      args: ["-e", "setTimeout(()=>{}, 60000)"],
      timeoutMs: 150,
      killGraceMs: 50,
    }).catch((e) => e);
    expect((err as ProcError).kind).toBe("timeout");
    expect((err as ProcError).timeoutMs).toBe(150);
    // Should be killed promptly, nowhere near the 60s the child requested.
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it("kills a process when the AbortSignal fires", async () => {
    const ac = new AbortController();
    const p = runProcess(NODE, {
      args: ["-e", "setTimeout(()=>{}, 60000)"],
      signal: ac.signal,
      killGraceMs: 50,
    });
    setTimeout(() => ac.abort(new Error("cancelled")), 50);
    const err = await p.catch((e) => e);
    expect((err as ProcError).kind).toBe("aborted");
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await runProcess(NODE, { args: ["-e", "1"], signal: ac.signal }).catch((e) => e);
    expect((err as ProcError).kind).toBe("aborted");
  });

  it("kills the process on stdout buffer overflow", async () => {
    const err = await runProcess(NODE, {
      // Emit far more than the cap.
      args: ["-e", "process.stdout.write('x'.repeat(100000))"],
      maxStdoutBytes: 1024,
      killGraceMs: 50,
    }).catch((e) => e);
    expect((err as ProcError).kind).toBe("buffer-overflow");
    expect((err as ProcError).limitBytes).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Injected clock + fake child: deterministic timeout/kill escalation
// ---------------------------------------------------------------------------

describe("runProcess — injected clock + fake child", () => {
  it("escalates SIGTERM then SIGKILL on timeout", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      killGraceMs: 500,
      spawnImpl: fakeSpawn(child),
      clock,
    });

    // Fire the timeout timer.
    clock.fire(1000);
    // SIGTERM sent immediately.
    expect(child.kills).toEqual(["SIGTERM"]);
    // Grace timer armed; fire it to escalate.
    clock.fire(500);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);

    const err = await p.catch((e) => e);
    expect((err as ProcError).kind).toBe("timeout");
  });

  it("clears the SIGKILL-escalation timer once the child closes after a timeout", async () => {
    // Regression: the kill-grace timer is armed AFTER settle (so clearTimers
    // cannot reach it). When the child obeys SIGTERM and closes, that timer must
    // be torn down — otherwise it dangles for the whole grace window, holding the
    // event loop open and firing a redundant SIGKILL at a dead/recycled PID.
    const child = new FakeChild();
    const clock = new FakeClock();
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      killGraceMs: 5000,
      spawnImpl: fakeSpawn(child),
      clock,
    }).catch((e) => e);

    clock.fire(1000); // timeout -> reject + SIGTERM + arm 5s SIGKILL timer
    expect(child.kills).toEqual(["SIGTERM"]);
    expect(clock.pending).toBe(1); // the escalation timer is pending

    child.close(null, "SIGTERM"); // child obeyed SIGTERM and exited
    await p;

    expect(clock.pending).toBe(0); // escalation timer cleared, no leak
    expect(child.kills).toEqual(["SIGTERM"]); // no redundant SIGKILL fired
  });

  it("clears the SIGKILL-escalation timer once the child closes after an abort", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    const ac = new AbortController();
    const p = runProcess(NODE, {
      args: [],
      killGraceMs: 5000,
      signal: ac.signal,
      spawnImpl: fakeSpawn(child),
      clock,
    }).catch((e) => e);

    ac.abort(new Error("cancelled")); // abort -> reject + SIGTERM + arm timer
    expect(child.kills).toEqual(["SIGTERM"]);
    expect(clock.pending).toBe(1);

    child.close(null, "SIGTERM");
    await p;

    expect(clock.pending).toBe(0);
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  it("still escalates to SIGKILL when the child ignores SIGTERM", async () => {
    // The cancel must NOT fire when the child stays alive: the grace timer must
    // still escalate to SIGKILL if no close arrives within the window.
    const child = new FakeChild();
    const clock = new FakeClock();
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      killGraceMs: 5000,
      spawnImpl: fakeSpawn(child),
      clock,
    }).catch((e) => e);

    clock.fire(1000); // timeout -> SIGTERM + arm timer
    clock.fire(5000); // grace elapses, child never closed -> SIGKILL
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    await p;
  });

  it("clears the timeout timer on a clean exit (no kill)", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      spawnImpl: fakeSpawn(child),
      clock,
    });
    expect(clock.pending).toBe(1);
    child.emitStdout("ok");
    child.close(0, null);
    const result = await p;
    expect(result.stdout).toBe("ok");
    expect(clock.pending).toBe(0); // timer cleared
    expect(child.kills).toEqual([]); // never killed
  });

  it("reports an external signal as a signal error", async () => {
    const child = new FakeChild();
    const p = runProcess(NODE, { args: [], spawnImpl: fakeSpawn(child) });
    child.close(null, "SIGKILL");
    const err = await p.catch((e) => e);
    expect((err as ProcError).kind).toBe("signal");
    expect((err as ProcError).signal).toBe("SIGKILL");
  });
});

// ---------------------------------------------------------------------------
// Settle-once invariant
// ---------------------------------------------------------------------------

describe("runProcess — settle-once invariant", () => {
  it("a timeout followed by a late close still settles exactly once", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    let settleCount = 0;
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      killGraceMs: 0,
      spawnImpl: fakeSpawn(child),
      clock,
    })
      .then(() => {
        settleCount++;
      })
      .catch(() => {
        settleCount++;
      });

    clock.fire(1000); // timeout fires -> reject + SIGTERM/SIGKILL
    // The child eventually closes from the kill; this must be a no-op.
    child.emitStdout("late");
    child.close(null, "SIGKILL");
    // A spurious second close/error must also be ignored.
    child.close(1, null);
    child.fail(new Error("spurious"));

    await p;
    expect(settleCount).toBe(1);
  });

  it("a buffer overflow followed by a close settles exactly once", async () => {
    const child = new FakeChild();
    let settleCount = 0;
    const p = runProcess(NODE, {
      args: [],
      maxStdoutBytes: 4,
      killGraceMs: 0,
      spawnImpl: fakeSpawn(child),
    })
      .then(() => settleCount++)
      .catch((e) => {
        settleCount++;
        return e;
      });

    child.emitStdout("toolong"); // 7 bytes > 4 cap -> overflow reject
    child.emitStdout("more"); // a second over-cap chunk must not re-settle
    child.close(null, "SIGKILL"); // close from the kill must not re-settle

    const err = await p;
    expect(settleCount).toBe(1);
    expect((err as ProcError).kind).toBe("buffer-overflow");
  });

  it("an error after a successful close does not overturn the result", async () => {
    const child = new FakeChild();
    let settleCount = 0;
    const p = runProcess(NODE, { args: [], spawnImpl: fakeSpawn(child) })
      .then((r) => {
        settleCount++;
        return r;
      })
      .catch(() => settleCount++);

    child.emitStdout("done");
    child.close(0, null); // resolve
    child.fail(new Error("post-close stdio error")); // must be ignored

    const result = await p;
    expect(settleCount).toBe(1);
    expect((result as { stdout: string }).stdout).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Input validation & pre-spawn guards
// ---------------------------------------------------------------------------

describe("runProcess — pre-spawn guards", () => {
  it("rejects an empty command without spawning", async () => {
    const child = new FakeChild();
    const { spawn, calls } = countingSpawn(child);
    const err = await runProcess("", { spawnImpl: spawn }).catch((e) => e);
    expect(isProcError(err)).toBe(true);
    expect((err as ProcError).kind).toBe("spawn-failure");
    expect(calls).toHaveLength(0); // never touched the OS
  });

  it("rejects a non-string command without spawning", async () => {
    const child = new FakeChild();
    const { spawn, calls } = countingSpawn(child);
    // Deliberately violate the type to exercise the runtime guard.
    const err = await runProcess(undefined as unknown as string, {
      spawnImpl: spawn,
    }).catch((e) => e);
    expect((err as ProcError).kind).toBe("spawn-failure");
    expect(calls).toHaveLength(0);
  });

  it("does NOT spawn when the signal is already aborted", async () => {
    const child = new FakeChild();
    const { spawn, calls } = countingSpawn(child);
    const ac = new AbortController();
    ac.abort();
    const err = await runProcess(NODE, { args: ["-e", "1"], signal: ac.signal, spawnImpl: spawn })
      .catch((e) => e);
    expect((err as ProcError).kind).toBe("aborted");
    expect(calls).toHaveLength(0); // pre-abort short-circuits before spawn
  });

  it("passes a command with shell metacharacters verbatim to spawn (no shell, no injection)", async () => {
    const child = new FakeChild();
    const { spawn, calls } = countingSpawn(child);
    // A classic injection payload. Because there is no shell, this is a single
    // (bogus) program name handed straight to spawn — never two commands.
    const payload = "foo; rm -rf / && echo $(whoami)";
    const p = runProcess(payload, { args: ["a b", "$HOME", "`id`"], spawnImpl: spawn }).catch(
      (e) => e
    );
    child.fail(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    await p;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(payload); // verbatim, untouched
    expect(calls[0]?.args).toEqual(["a b", "$HOME", "`id`"]); // verbatim, untouched
  });
});

// ---------------------------------------------------------------------------
// killGraceMs === 0 semantics
// ---------------------------------------------------------------------------

describe("runProcess — killGraceMs 0", () => {
  it("sends only SIGKILL (no racing SIGTERM) on timeout with zero grace", async () => {
    const child = new FakeChild();
    const clock = new FakeClock();
    const p = runProcess(NODE, {
      args: [],
      timeoutMs: 1000,
      killGraceMs: 0,
      spawnImpl: fakeSpawn(child),
      clock,
    }).catch((e) => e);

    clock.fire(1000); // timeout
    expect(child.kills).toEqual(["SIGKILL"]); // straight to SIGKILL, no SIGTERM
    expect(clock.pending).toBe(0); // no escalation timer armed

    const err = await p;
    expect((err as ProcError).kind).toBe("timeout");
  });
});

// ---------------------------------------------------------------------------
// Encodings beyond utf8 / buffer
// ---------------------------------------------------------------------------

describe("runProcess — encodings", () => {
  it("decodes captured output as hex", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write(Buffer.from([0xde,0xad,0xbe,0xef]))"],
      encoding: "hex",
    });
    expect(result.stdout).toBe("deadbeef");
  });

  it("decodes captured output as base64", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write('hello')"],
      encoding: "base64",
    });
    expect(result.stdout).toBe(Buffer.from("hello").toString("base64"));
  });

  it("decodes captured output as latin1", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write(Buffer.from([0xff,0x41]))"],
      encoding: "latin1",
    });
    expect(result.stdout).toBe("ÿA");
  });

  it("does not mis-decode a multi-byte sequence split across chunks", async () => {
    // "é" is 0xC3 0xA9 in UTF-8. Deliver the two bytes in separate data events;
    // decoding the concatenated buffer once must reconstruct it intact.
    const child = new FakeChild();
    const p = runProcess(NODE, { args: [], spawnImpl: fakeSpawn(child) });
    child.stdout.emit("data", Buffer.from([0xc3]));
    child.stdout.emit("data", Buffer.from([0xa9]));
    child.close(0, null);
    const result = await p;
    expect(result.stdout).toBe("é");
  });
});

// ---------------------------------------------------------------------------
// Buffer-cap edge cases
// ---------------------------------------------------------------------------

describe("runProcess — buffer caps", () => {
  it("reports actualBytes accumulated alongside the limit on overflow", async () => {
    const child = new FakeChild();
    const p = runProcess(NODE, {
      args: [],
      maxStdoutBytes: 4,
      killGraceMs: 0,
      spawnImpl: fakeSpawn(child),
    }).catch((e) => e);
    child.emitStdout("0123456789"); // 10 bytes > 4 cap
    child.close(null, "SIGKILL");
    const err = await p;
    expect((err as ProcError).kind).toBe("buffer-overflow");
    expect((err as ProcError).limitBytes).toBe(4);
    expect((err as ProcError).actualBytes).toBe(10);
    expect((err as ProcError).message).toContain("accumulated 10 bytes");
  });

  it("settles once when stdout AND stderr both overflow in the same tick", async () => {
    const child = new FakeChild();
    let settleCount = 0;
    const p = runProcess(NODE, {
      args: [],
      maxStdoutBytes: 2,
      maxStderrBytes: 2,
      killGraceMs: 0,
      spawnImpl: fakeSpawn(child),
    })
      .then(() => settleCount++)
      .catch((e) => {
        settleCount++;
        return e;
      });
    child.emitStdout("aaaa"); // overflow stdout
    child.emitStderr("bbbb"); // overflow stderr — must be a no-op (already settled)
    child.close(null, "SIGKILL");
    const err = await p;
    expect(settleCount).toBe(1);
    expect((err as ProcError).kind).toBe("buffer-overflow");
    expect((err as ProcError).limitBytes).toBe(2); // the stdout overflow won
  });

  it("captures an input larger than a typical OS pipe buffer round-trip", async () => {
    // 256 KiB — comfortably larger than the 64 KiB default pipe buffer, forcing
    // multiple write/drain cycles through stdin and multiple stdout data events.
    const payload = "x".repeat(256 * 1024);
    const result = await runProcess(NODE, {
      args: [
        "-e",
        "let d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(d)))",
      ],
      input: payload,
      maxStdoutBytes: 1024 * 1024,
    });
    expect((result.stdout as string).length).toBe(payload.length);
    expect(result.stdout).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// env handling
// ---------------------------------------------------------------------------

describe("runProcess — env", () => {
  it("inherits the parent environment when env is undefined", async () => {
    // With env omitted, spawn inherits process.env. Read a var we set here.
    const sentinel = "PROC_TEST_SENTINEL_VALUE";
    process.env.PROC_TEST_SENTINEL = sentinel;
    try {
      const result = await runProcess(NODE, {
        args: ["-e", "process.stdout.write(process.env.PROC_TEST_SENTINEL ?? '<unset>')"],
      });
      expect(result.stdout).toBe(sentinel);
    } finally {
      delete process.env.PROC_TEST_SENTINEL;
    }
  });

  it("uses ONLY the supplied env when env is provided", async () => {
    const result = await runProcess(NODE, {
      args: ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"],
      env: { ONLY_THIS: "1" },
    });
    const keys = JSON.parse(result.stdout as string) as string[];
    expect(keys).toContain("ONLY_THIS");
  });
});

// ---------------------------------------------------------------------------
// stdin error surfacing
// ---------------------------------------------------------------------------

describe("runProcess — stdin errors", () => {
  it("swallows an EPIPE stdin error and still resolves on a clean exit", async () => {
    const child = new FakeChild();
    const p = runProcess(NODE, { args: [], input: "data", spawnImpl: fakeSpawn(child) });
    // Child stopped reading; the pipe broke. This is expected teardown.
    child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    child.emitStdout("ok");
    child.close(0, null);
    const result = await p;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("surfaces an UNEXPECTED stdin error as a stdin-error on an otherwise-clean exit", async () => {
    const child = new FakeChild();
    const p = runProcess(NODE, { args: [], input: "data", spawnImpl: fakeSpawn(child) }).catch(
      (e) => e
    );
    // A real I/O failure — not pipe teardown.
    child.stdin.emit("error", Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }));
    child.close(0, null);
    const err = await p;
    expect(isProcError(err)).toBe(true);
    expect((err as ProcError).kind).toBe("stdin-error");
    expect(((err as ProcError).cause as NodeJS.ErrnoException).code).toBe("ENOSPC");
  });

  it("lets a non-zero exit win over a captured stdin error", async () => {
    const child = new FakeChild();
    const p = runProcess(NODE, { args: [], input: "data", spawnImpl: fakeSpawn(child) }).catch(
      (e) => e
    );
    child.stdin.emit("error", Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }));
    child.close(7, null); // process itself failed — that is the headline failure
    const err = await p;
    expect((err as ProcError).kind).toBe("non-zero-exit");
    expect((err as ProcError).exitCode).toBe(7);
  });
});
