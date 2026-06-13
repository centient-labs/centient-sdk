/**
 * Circuit breaker — ported from crucible's pure state machine
 * (platform/crucible `src/state/circuit-breaker.ts`) and wrapped in a
 * clock-injected, factory-style stateful breaker.
 *
 * State machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED.
 *
 * - CLOSED: calls pass; consecutive failures accumulate. At `failureThreshold`
 *   the circuit trips OPEN.
 * - OPEN: calls are rejected until `currentOpenDurationMs` elapses, then the
 *   next check transitions to HALF_OPEN.
 * - HALF_OPEN: a single probe call is allowed. Success closes the circuit and
 *   resets backoff; failure re-opens it with an exponentially-increased open
 *   duration, capped at `maxOpenDurationMs`.
 *
 * The pure functions ({@link checkCircuit}, {@link recordSuccess},
 * {@link recordFailure}) take state + an epoch-millisecond timestamp and
 * return new state — no I/O, no hidden clock. The {@link createCircuitBreaker}
 * factory holds the state and injects a {@link Clock}, so callers never read
 * the wall clock directly.
 */

import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

/** Circuit breaker states. */
export type CircuitState = "closed" | "open" | "half_open";

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  /** Consecutive failures before opening (default: 3). */
  failureThreshold: number;
  /** Time in ms before OPEN -> HALF_OPEN (default: 60_000). */
  openDurationMs: number;
  /** Backoff multiplier for successive open periods (default: 2). */
  backoffMultiplier: number;
  /** Maximum open duration in ms (default: 300_000 = 5 min). */
  maxOpenDurationMs: number;
}

/** Circuit breaker state snapshot (immutable; epoch-ms timestamps). */
export interface CircuitBreakerState {
  /** Current state of the circuit. */
  state: CircuitState;
  /** Consecutive failures in the current closed period. */
  failureCount: number;
  /** Epoch ms when the circuit was last opened, or null. */
  lastOpenedAt: number | null;
  /** Epoch ms of the last failure, or null. */
  lastFailureAt: number | null;
  /** Epoch ms of the last success, or null. */
  lastSuccessAt: number | null;
  /** Current open duration in ms (grows with backoff). */
  currentOpenDurationMs: number;
  /** Total number of times the circuit has opened. */
  totalOpens: number;
}

/** Result of checking whether a call should proceed. */
export interface CircuitCheckResult {
  /** Whether the call is allowed. */
  allowed: boolean;
  /** Circuit state after the (possible) auto-transition. */
  state: CircuitState;
  /** Reason if not allowed. */
  reason?: string;
  /** Time in ms until the HALF_OPEN transition (only when blocked). */
  retryAfterMs?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_OPEN_DURATION_MS = 60_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_OPEN_DURATION_MS = 300_000;

/** Return the default circuit breaker configuration. */
export function getDefaultCircuitBreakerConfig(): CircuitBreakerConfig {
  return {
    failureThreshold: DEFAULT_FAILURE_THRESHOLD,
    openDurationMs: DEFAULT_OPEN_DURATION_MS,
    backoffMultiplier: DEFAULT_BACKOFF_MULTIPLIER,
    maxOpenDurationMs: DEFAULT_MAX_OPEN_DURATION_MS,
  };
}

/** Create initial circuit breaker state (closed, no failures). */
export function createCircuitBreakerState(
  config: CircuitBreakerConfig = getDefaultCircuitBreakerConfig(),
): CircuitBreakerState {
  return {
    state: "closed",
    failureCount: 0,
    lastOpenedAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    currentOpenDurationMs: config.openDurationMs,
    totalOpens: 0,
  };
}

// ---------------------------------------------------------------------------
// Pure state machine
// ---------------------------------------------------------------------------

/**
 * Check whether a call should be allowed, auto-transitioning OPEN -> HALF_OPEN
 * once `currentOpenDurationMs` has elapsed since `lastOpenedAt`.
 *
 * Pure: takes state + `nowMs` (epoch ms), returns the result and a possibly
 * transitioned state. Reads the open duration from
 * `state.currentOpenDurationMs` (which already accounts for backoff).
 */
export function checkCircuit(
  state: CircuitBreakerState,
  nowMs: number,
): { result: CircuitCheckResult; updatedState: CircuitBreakerState } {
  if (state.state === "closed") {
    return { result: { allowed: true, state: "closed" }, updatedState: state };
  }

  if (state.state === "half_open") {
    return { result: { allowed: true, state: "half_open" }, updatedState: state };
  }

  // state === "open"
  if (state.lastOpenedAt === null) {
    return {
      result: {
        allowed: false,
        state: "open",
        reason: "Circuit is open (no open timestamp recorded).",
      },
      updatedState: state,
    };
  }

  const elapsedMs = nowMs - state.lastOpenedAt;
  const requiredMs = state.currentOpenDurationMs;

  if (elapsedMs >= requiredMs) {
    const updatedState: CircuitBreakerState = { ...state, state: "half_open" };
    return { result: { allowed: true, state: "half_open" }, updatedState };
  }

  const retryAfterMs = requiredMs - elapsedMs;
  return {
    result: {
      allowed: false,
      state: "open",
      reason: `Circuit is open. Retry after ${retryAfterMs}ms.`,
      retryAfterMs,
    },
    updatedState: state,
  };
}

/**
 * Record a successful call. HALF_OPEN -> CLOSED (resets backoff); CLOSED resets
 * the failure count; OPEN is a graceful no-op transition. Pure.
 */
export function recordSuccess(
  state: CircuitBreakerState,
  nowMs: number,
  config: CircuitBreakerConfig = getDefaultCircuitBreakerConfig(),
): CircuitBreakerState {
  if (state.state === "half_open") {
    return {
      ...state,
      state: "closed",
      failureCount: 0,
      lastSuccessAt: nowMs,
      currentOpenDurationMs: config.openDurationMs,
    };
  }

  if (state.state === "closed") {
    return { ...state, failureCount: 0, lastSuccessAt: nowMs };
  }

  // OPEN — record the success but do not transition.
  return { ...state, lastSuccessAt: nowMs };
}

/**
 * Record a failed call. CLOSED increments the failure count and trips OPEN at
 * the threshold; HALF_OPEN re-opens with increased backoff; OPEN increments
 * the count without changing state. Pure.
 */
export function recordFailure(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  nowMs: number,
): CircuitBreakerState {
  if (state.state === "half_open") {
    const newBackoff = computeBackoff(
      state.currentOpenDurationMs,
      config.backoffMultiplier,
      config.maxOpenDurationMs,
    );
    return {
      ...state,
      state: "open",
      failureCount: state.failureCount + 1,
      lastFailureAt: nowMs,
      lastOpenedAt: nowMs,
      currentOpenDurationMs: newBackoff,
      totalOpens: state.totalOpens + 1,
    };
  }

  if (state.state === "closed") {
    const newFailureCount = state.failureCount + 1;
    if (newFailureCount >= config.failureThreshold) {
      return {
        ...state,
        state: "open",
        failureCount: newFailureCount,
        lastFailureAt: nowMs,
        lastOpenedAt: nowMs,
        currentOpenDurationMs: config.openDurationMs,
        totalOpens: state.totalOpens + 1,
      };
    }
    return { ...state, failureCount: newFailureCount, lastFailureAt: nowMs };
  }

  // OPEN — record the failure but do not change state.
  return { ...state, failureCount: state.failureCount + 1, lastFailureAt: nowMs };
}

/** Exponential backoff increase, capped at `maxMs`. */
function computeBackoff(currentMs: number, multiplier: number, maxMs: number): number {
  return Math.min(currentMs * multiplier, maxMs);
}

// ---------------------------------------------------------------------------
// Stateful factory
// ---------------------------------------------------------------------------

/** A circuit breaker error raised by {@link CircuitBreaker.execute} when open. */
export class CircuitOpenError extends Error {
  /** Time in ms until the breaker may transition to HALF_OPEN. */
  readonly retryAfterMs: number | undefined;
  constructor(reason: string, retryAfterMs?: number) {
    super(reason);
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Options for {@link createCircuitBreaker}. */
export interface CircuitBreakerOptions extends Partial<CircuitBreakerConfig> {
  /** Clock for time injection (default: {@link systemClock}). */
  clock?: Clock;
}

/** A stateful, clock-injected circuit breaker. */
export interface CircuitBreaker {
  /**
   * Run `fn` through the breaker. Throws {@link CircuitOpenError} if the
   * circuit is open; otherwise records success/failure around the call and
   * re-throws any error `fn` raises.
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  /** Whether a call would currently be allowed (auto-transitions if due). */
  canExecute(): boolean;
  /** Record an out-of-band success (when not using {@link execute}). */
  onSuccess(): void;
  /** Record an out-of-band failure (when not using {@link execute}). */
  onFailure(): void;
  /** The current state (after any pending auto-transition). */
  getState(): CircuitState;
  /** An immutable snapshot of the full internal state. */
  snapshot(): CircuitBreakerState;
  /** Reset the breaker to a fresh closed state. */
  reset(): void;
}

/**
 * Create a stateful {@link CircuitBreaker}.
 *
 * @example
 * const breaker = createCircuitBreaker({ failureThreshold: 5 });
 * try {
 *   const data = await breaker.execute(() => fetchFromUpstream());
 * } catch (e) {
 *   if (e instanceof CircuitOpenError) { /* serve fallback *\/ }
 * }
 */
export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const { clock = systemClock, ...configOverrides } = options;
  const config: CircuitBreakerConfig = { ...getDefaultCircuitBreakerConfig(), ...configOverrides };
  let state = createCircuitBreakerState(config);

  function check(): CircuitCheckResult {
    const { result, updatedState } = checkCircuit(state, clock());
    state = updatedState;
    return result;
  }

  return {
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      const result = check();
      if (!result.allowed) {
        throw new CircuitOpenError(
          result.reason ?? "Circuit is open.",
          result.retryAfterMs,
        );
      }
      try {
        const value = await fn();
        state = recordSuccess(state, clock(), config);
        return value;
      } catch (error) {
        state = recordFailure(state, config, clock());
        throw error;
      }
    },
    canExecute(): boolean {
      return check().allowed;
    },
    onSuccess(): void {
      state = recordSuccess(state, clock(), config);
    },
    onFailure(): void {
      state = recordFailure(state, config, clock());
    },
    getState(): CircuitState {
      return check().state;
    },
    snapshot(): CircuitBreakerState {
      return { ...state };
    },
    reset(): void {
      state = createCircuitBreakerState(config);
    },
  };
}
