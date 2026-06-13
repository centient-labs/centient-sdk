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
