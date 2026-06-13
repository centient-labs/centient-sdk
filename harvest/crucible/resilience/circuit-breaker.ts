/**
 * Pipeline Circuit Breaker (ADR-036 Decision 5)
 *
 * Pure state machine for the 3-tier persistence fallback chain
 * (Crystal > WAL > in-memory). This module manages state transitions
 * only -- the actual persistence tier composition happens at a higher level.
 *
 * State machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
 *
 * This is the persistence fallback chain, distinct from the 4-tier
 * data-availability degradation in the agents subcommand (ADR-038).
 *
 * Defaults are CALIBRATION ITEMS -- adjust after 3 empirical pipeline runs:
 *   - Failure threshold: 3
 *   - Open duration: 60s
 *   - Backoff multiplier: 2x
 *   - Max open duration: 5 min
 *
 * All functions are pure -- no I/O, no side effects. Time is injected
 * via `now: Date` parameter (same pattern as health-monitor.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Circuit breaker states. */
export type CircuitState = "closed" | "open" | "half_open";

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening (default: 3). */
  failureThreshold: number;
  /** Time in ms before transitioning from open to half-open (default: 60000). */
  openDurationMs: number;
  /** Backoff multiplier for successive open periods (default: 2). */
  backoffMultiplier: number;
  /** Maximum open duration in ms (default: 300000 = 5 min). */
  maxOpenDurationMs: number;
}

/** Circuit breaker state snapshot. */
export interface CircuitBreakerState {
  /** Current state of the circuit. */
  state: CircuitState;
  /** Number of consecutive failures in current closed period. */
  failureCount: number;
  /** Timestamp when the circuit was last opened (ISO 8601). */
  lastOpenedAt: string | null;
  /** Timestamp of the last failure (ISO 8601). */
  lastFailureAt: string | null;
  /** Timestamp of the last success (ISO 8601). */
  lastSuccessAt: string | null;
  /** Current open duration (increases with backoff). */
  currentOpenDurationMs: number;
  /** Total number of times the circuit has opened. */
  totalOpens: number;
}

/** Result of checking whether a call should proceed. */
export interface CircuitCheckResult {
  /** Whether the call is allowed. */
  allowed: boolean;
  /** Current circuit state. */
  state: CircuitState;
  /** Reason if not allowed. */
  reason?: string;
  /** Time remaining in ms until half-open transition (if open). */
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Constants (CALIBRATION ITEMS)
// ---------------------------------------------------------------------------

/** Default failure threshold before opening. */
const DEFAULT_FAILURE_THRESHOLD = 3;

/** Default open duration: 60s. */
const DEFAULT_OPEN_DURATION_MS = 60_000;

/** Default backoff multiplier: 2x. */
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/** Default maximum open duration cap: 5 minutes. */
const DEFAULT_MAX_OPEN_DURATION_MS = 300_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Return the default circuit breaker configuration.
 *
 * All values are CALIBRATION ITEMS (ADR-036 calibration plan):
 * - failureThreshold: 3 (observe Crystal API reliability; increase if too sensitive)
 * - openDurationMs: 60s (observe recovery times; increase if premature retries)
 * - backoffMultiplier: 2x
 * - maxOpenDurationMs: 5 min
 */
export function getDefaultCircuitBreakerConfig(): CircuitBreakerConfig {
  return {
    failureThreshold: DEFAULT_FAILURE_THRESHOLD,
    openDurationMs: DEFAULT_OPEN_DURATION_MS,
    backoffMultiplier: DEFAULT_BACKOFF_MULTIPLIER,
    maxOpenDurationMs: DEFAULT_MAX_OPEN_DURATION_MS,
  };
}

// ---------------------------------------------------------------------------
// State Factory
// ---------------------------------------------------------------------------

/**
 * Create initial circuit breaker state (closed, no failures).
 */
export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    state: "closed",
    failureCount: 0,
    lastOpenedAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    currentOpenDurationMs: DEFAULT_OPEN_DURATION_MS,
    totalOpens: 0,
  };
}

// ---------------------------------------------------------------------------
// Pure State Machine Functions
// ---------------------------------------------------------------------------

/**
 * Check if a call should be allowed through the circuit.
 *
 * - CLOSED: always allowed
 * - OPEN: blocked until openDuration elapses, then transitions to HALF_OPEN
 * - HALF_OPEN: allowed (one test call)
 *
 * Pure function -- takes state + current time, returns result + updated state.
 * The open duration is read from `state.currentOpenDurationMs` (which already
 * accounts for backoff), so no config is needed here.
 *
 * @param state - Current circuit breaker state
 * @param now - Current timestamp (injected for testability)
 * @returns Check result and (potentially transitioned) updated state
 */
export function checkCircuit(
  state: CircuitBreakerState,
  now: Date,
): { result: CircuitCheckResult; updatedState: CircuitBreakerState } {
  if (state.state === "closed") {
    return {
      result: { allowed: true, state: "closed" },
      updatedState: state,
    };
  }

  if (state.state === "half_open") {
    return {
      result: { allowed: true, state: "half_open" },
      updatedState: state,
    };
  }

  // state === "open"
  if (state.lastOpenedAt === null) {
    // Should not happen, but handle gracefully
    return {
      result: {
        allowed: false,
        state: "open",
        reason: "Circuit is open (no open timestamp recorded).",
      },
      updatedState: state,
    };
  }

  const openedAt = new Date(state.lastOpenedAt);
  const elapsedMs = now.getTime() - openedAt.getTime();
  const requiredMs = state.currentOpenDurationMs;

  if (elapsedMs >= requiredMs) {
    // Enough time has passed -- transition to HALF_OPEN
    const updatedState: CircuitBreakerState = {
      ...state,
      state: "half_open",
    };

    return {
      result: { allowed: true, state: "half_open" },
      updatedState,
    };
  }

  // Still in open period -- reject with retry-after
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
 * Record a successful call.
 *
 * - CLOSED: reset failure count
 * - HALF_OPEN: transition to CLOSED (circuit recovered), reset backoff
 * - OPEN: no-op (should not reach here, but handle gracefully)
 *
 * Pure function.
 *
 * @param state - Current circuit breaker state
 * @param now - Current timestamp (injected for testability)
 * @returns Updated circuit breaker state
 */
export function recordSuccess(
  state: CircuitBreakerState,
  now: Date,
): CircuitBreakerState {
  const nowIso = now.toISOString();

  if (state.state === "half_open") {
    // Recovery successful -- close the circuit, reset backoff
    return {
      ...state,
      state: "closed",
      failureCount: 0,
      lastSuccessAt: nowIso,
      currentOpenDurationMs: DEFAULT_OPEN_DURATION_MS,
    };
  }

  if (state.state === "closed") {
    // Reset failure count on success
    return {
      ...state,
      failureCount: 0,
      lastSuccessAt: nowIso,
    };
  }

  // OPEN state -- should not happen, but handle gracefully
  return {
    ...state,
    lastSuccessAt: nowIso,
  };
}

/**
 * Record a failed call.
 *
 * - CLOSED: increment failure count. If >= threshold, transition to OPEN.
 * - HALF_OPEN: transition back to OPEN (recovery failed), increase backoff.
 * - OPEN: increment failure count but do not change state.
 *
 * Pure function.
 *
 * @param state - Current circuit breaker state
 * @param cbConfig - Circuit breaker configuration
 * @param now - Current timestamp (injected for testability)
 * @returns Updated circuit breaker state
 */
export function recordFailure(
  state: CircuitBreakerState,
  cbConfig: CircuitBreakerConfig,
  now: Date,
): CircuitBreakerState {
  const nowIso = now.toISOString();

  if (state.state === "half_open") {
    // Any failure in HALF_OPEN re-opens with increased backoff
    const newBackoff = computeBackoff(
      state.currentOpenDurationMs,
      cbConfig.backoffMultiplier,
      cbConfig.maxOpenDurationMs,
    );

    return {
      ...state,
      state: "open",
      failureCount: state.failureCount + 1,
      lastFailureAt: nowIso,
      lastOpenedAt: nowIso,
      currentOpenDurationMs: newBackoff,
      totalOpens: state.totalOpens + 1,
    };
  }

  if (state.state === "closed") {
    const newFailureCount = state.failureCount + 1;

    if (newFailureCount >= cbConfig.failureThreshold) {
      // Threshold exceeded -- trip open
      return {
        ...state,
        state: "open",
        failureCount: newFailureCount,
        lastFailureAt: nowIso,
        lastOpenedAt: nowIso,
        currentOpenDurationMs: cbConfig.openDurationMs,
        totalOpens: state.totalOpens + 1,
      };
    }

    // Below threshold -- stay closed
    return {
      ...state,
      failureCount: newFailureCount,
      lastFailureAt: nowIso,
    };
  }

  // OPEN state -- record failure but don't change state
  return {
    ...state,
    failureCount: state.failureCount + 1,
    lastFailureAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next backoff duration with exponential increase, capped at max.
 */
function computeBackoff(
  currentMs: number,
  multiplier: number,
  maxMs: number,
): number {
  return Math.min(currentMs * multiplier, maxMs);
}
