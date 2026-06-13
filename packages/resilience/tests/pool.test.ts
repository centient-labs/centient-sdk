/**
 * Bounded-concurrency pool tests.
 */

import { describe, it, expect } from "vitest";
import { createPool, PoolRejectedError } from "../src/pool.js";

/** A deferred promise whose resolution the test controls. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createPool", () => {
  it("runs tasks and returns their values", async () => {
    const pool = createPool({ concurrency: 2 });
    const results = await Promise.all([
      pool.run(async () => 1),
      pool.run(async () => 2),
      pool.run(async () => 3),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    const pool = createPool({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const tasks = gates.map((gate, i) =>
      pool.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return i;
      }),
    );

    // Let microtasks settle: only 2 should be active.
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.active).toBe(2);
    expect(pool.queued).toBe(2);

    for (const gate of gates) gate.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(pool.active).toBe(0);
  });

  it("propagates task rejection without stalling the pool", async () => {
    const pool = createPool({ concurrency: 1 });
    await expect(pool.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    // Pool still works after a rejection.
    await expect(pool.run(async () => "ok")).resolves.toBe("ok");
  });

  it("catches a synchronous throw in the task factory", async () => {
    const pool = createPool({ concurrency: 1 });
    await expect(
      pool.run(() => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    await expect(pool.run(async () => 1)).resolves.toBe(1);
  });

  it("rejects with PoolRejectedError when the bounded queue is full", async () => {
    const pool = createPool({ concurrency: 1, maxQueue: 1 });
    const gate = deferred<void>();
    const running = pool.run(async () => {
      await gate.promise;
    });
    await Promise.resolve();
    // One slot busy, one queued is allowed.
    const queued = pool.run(async () => 2);
    // Second queued exceeds maxQueue -> rejected.
    await expect(pool.run(async () => 3)).rejects.toBeInstanceOf(PoolRejectedError);

    gate.resolve();
    await Promise.all([running, queued]);
  });

  it("onIdle resolves when all work settles", async () => {
    const pool = createPool({ concurrency: 2 });
    const gate = deferred<void>();
    const t1 = pool.run(async () => {
      await gate.promise;
    });
    const t2 = pool.run(async () => {
      await gate.promise;
    });
    let idle = false;
    const idlePromise = pool.onIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    gate.resolve();
    await Promise.all([t1, t2]);
    await idlePromise;
    expect(idle).toBe(true);
  });

  it("onIdle resolves immediately when already idle", async () => {
    const pool = createPool({ concurrency: 1 });
    await expect(pool.onIdle()).resolves.toBeUndefined();
  });

  it("validates config", () => {
    expect(() => createPool({ concurrency: 0 })).toThrow(RangeError);
    expect(() => createPool({ concurrency: 1.5 })).toThrow(RangeError);
    expect(() => createPool({ concurrency: 1, maxQueue: -1 })).toThrow(RangeError);
  });
});
