/**
 * Bounded-concurrency pool.
 *
 * Runs async tasks with at most `concurrency` in flight at once. Submitted
 * tasks beyond the limit queue (FIFO) until a slot frees. An optional
 * `maxQueue` bounds the backlog: when full, `run` rejects with a
 * {@link PoolRejectedError} rather than growing the queue without limit
 * (no silent degradation — the caller learns the pool is saturated).
 *
 * No clock or randomness is involved, so nothing here needs injection; the
 * pool is a pure scheduling primitive over the host's microtask/promise queue.
 */

/** Error thrown when the pool's bounded queue is full. */
export class PoolRejectedError extends Error {
  constructor(maxQueue: number) {
    super(`Pool queue is full (maxQueue=${maxQueue}); task rejected.`);
    this.name = "PoolRejectedError";
  }
}

/** Configuration for a {@link Pool}. */
export interface PoolConfig {
  /** Maximum tasks running concurrently. Must be > 0. */
  concurrency: number;
  /**
   * Maximum tasks waiting to start. Omit for an unbounded queue. When set and
   * full, {@link Pool.run} rejects with {@link PoolRejectedError}.
   */
  maxQueue?: number;
}

/** A snapshot of pool occupancy. */
export interface PoolStats {
  /** Tasks currently executing. */
  active: number;
  /** Tasks waiting to start. */
  queued: number;
  /** Configured concurrency limit. */
  concurrency: number;
}

/** A bounded-concurrency execution pool. */
export interface Pool {
  /**
   * Submit `task` for execution. Resolves/rejects with the task's outcome.
   * Rejects immediately with {@link PoolRejectedError} if `maxQueue` is set
   * and the queue is full.
   */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently executing. */
  readonly active: number;
  /** Tasks waiting to start. */
  readonly queued: number;
  /** A snapshot of occupancy. */
  stats(): PoolStats;
  /** Resolves when all active and queued tasks have settled. */
  onIdle(): Promise<void>;
}

interface Waiter {
  start: () => void;
}

/**
 * Create a bounded-concurrency {@link Pool}.
 *
 * @example
 * const pool = createPool({ concurrency: 4 });
 * const results = await Promise.all(urls.map((u) => pool.run(() => fetch(u))));
 *
 * @example Bounded queue (reject when saturated)
 * const pool = createPool({ concurrency: 2, maxQueue: 10 });
 * try { await pool.run(task); }
 * catch (e) { if (e instanceof PoolRejectedError) { /* shed load *\/ } }
 */
export function createPool(config: PoolConfig): Pool {
  const { concurrency, maxQueue } = config;

  if (concurrency <= 0 || !Number.isInteger(concurrency)) {
    throw new RangeError(
      `createPool: concurrency must be a positive integer, got ${concurrency}`,
    );
  }
  if (maxQueue !== undefined && (maxQueue < 0 || !Number.isInteger(maxQueue))) {
    throw new RangeError(
      `createPool: maxQueue must be a non-negative integer, got ${maxQueue}`,
    );
  }

  let active = 0;
  const queue: Waiter[] = [];
  const idleResolvers: Array<() => void> = [];

  function settleIdle(): void {
    if (active === 0 && queue.length === 0) {
      const resolvers = idleResolvers.splice(0, idleResolvers.length);
      for (const resolve of resolvers) resolve();
    }
  }

  function next(): void {
    if (active >= concurrency) return;
    const waiter = queue.shift();
    if (waiter === undefined) {
      settleIdle();
      return;
    }
    waiter.start();
  }

  /**
   * Free a slot after a task settles and schedule the next waiter. The
   * decrement and the next() pump are coupled in a try/finally so that an
   * unexpected throw from next() (or waiter.start()) cannot strand the pool
   * with a permanently-occupied slot — the active count is always released and
   * the scheduler is always pumped, keeping queued tasks live.
   */
  function release(): void {
    // Decrement first, then pump, inside try/finally: even if next() throws
    // (it should not — it is internal), the slot has already been freed, so the
    // pool can never deadlock on a leaked active count.
    try {
      active -= 1;
    } finally {
      next();
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          active += 1;
          // Defend against a synchronous throw inside the task factory.
          let promise: Promise<T>;
          try {
            promise = task();
          } catch (error) {
            reject(error);
            release();
            return;
          }
          promise.then(
            (value) => {
              resolve(value);
              release();
            },
            (error: unknown) => {
              reject(error);
              release();
            },
          );
        };

        if (active < concurrency && queue.length === 0) {
          start();
          return;
        }
        if (maxQueue !== undefined && queue.length >= maxQueue) {
          reject(new PoolRejectedError(maxQueue));
          return;
        }
        queue.push({ start });
      });
    },
    get active(): number {
      return active;
    },
    get queued(): number {
      return queue.length;
    },
    stats(): PoolStats {
      return { active, queued: queue.length, concurrency };
    },
    onIdle(): Promise<void> {
      if (active === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleResolvers.push(resolve));
    },
  };
}
