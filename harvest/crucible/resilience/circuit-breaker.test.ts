/**
 * Tests for Pipeline Circuit Breaker (ADR-036 Decision 5)
 *
 * Tests the pure state machine for the 3-tier persistence fallback:
 * - State transitions: closed -> open -> half_open -> closed
 * - Exponential backoff with 2x multiplier and cap
 * - checkCircuit auto-transition from open -> half_open
 * - retryAfterMs calculation
 *
 * Zero infrastructure dependencies -- all functions are pure.
 */

import { describe, it, expect } from "vitest";
import {
  createCircuitBreakerState,
  getDefaultCircuitBreakerConfig,
  checkCircuit,
  recordSuccess,
  recordFailure,
} from "../../src/state/circuit-breaker.js";
import type {
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "../../src/state/circuit-breaker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TIME = new Date("2026-02-09T12:00:00.000Z");

/** Create a Date offset from a base time by the given milliseconds. */
function offsetMs(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** Shorthand for config with overrides. */
function cfg(
  overrides?: Partial<CircuitBreakerConfig>,
): CircuitBreakerConfig {
  return { ...getDefaultCircuitBreakerConfig(), ...overrides };
}

/** Trip the circuit open by recording enough failures. */
function tripOpen(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = getDefaultCircuitBreakerConfig(),
  now: Date = BASE_TIME,
): CircuitBreakerState {
  let current = state;
  for (let i = 0; i < config.failureThreshold; i++) {
    current = recordFailure(current, config, now);
  }
  return current;
}

// ============================================================
// createCircuitBreakerState
// ============================================================

describe("createCircuitBreakerState", () => {
  it("should create a closed state with zero counters", () => {
    const state = createCircuitBreakerState();
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.totalOpens).toBe(0);
    expect(state.lastOpenedAt).toBeNull();
    expect(state.lastFailureAt).toBeNull();
    expect(state.lastSuccessAt).toBeNull();
  });

  it("should initialize currentOpenDurationMs to default", () => {
    const state = createCircuitBreakerState();
    expect(state.currentOpenDurationMs).toBe(60_000);
  });
});

// ============================================================
// getDefaultCircuitBreakerConfig
// ============================================================

describe("getDefaultCircuitBreakerConfig", () => {
  it("should return expected calibration defaults", () => {
    const config = getDefaultCircuitBreakerConfig();
    expect(config.failureThreshold).toBe(3);
    expect(config.openDurationMs).toBe(60_000);
    expect(config.backoffMultiplier).toBe(2);
    expect(config.maxOpenDurationMs).toBe(300_000);
  });
});

// ============================================================
// recordFailure
// ============================================================

describe("recordFailure", () => {
  it("should increment failure count without transition below threshold", () => {
    const state = createCircuitBreakerState();
    const config = cfg({ failureThreshold: 3 });

    const updated = recordFailure(state, config, BASE_TIME);

    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(1);
    expect(updated.lastFailureAt).toBe(BASE_TIME.toISOString());
  });

  it("should stay closed after threshold minus one failures", () => {
    const config = cfg({ failureThreshold: 3 });
    let state = createCircuitBreakerState();

    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);

    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(2);
  });

  it("should transition closed -> open at failure threshold", () => {
    const config = cfg({ failureThreshold: 3 });
    const state = tripOpen(createCircuitBreakerState(), config);

    expect(state.state).toBe("open");
    expect(state.failureCount).toBe(3);
    expect(state.totalOpens).toBe(1);
    expect(state.lastOpenedAt).toBe(BASE_TIME.toISOString());
  });

  it("should set currentOpenDurationMs to openDurationMs on first trip", () => {
    const config = cfg({ failureThreshold: 1, openDurationMs: 45_000 });
    const state = recordFailure(createCircuitBreakerState(), config, BASE_TIME);

    expect(state.currentOpenDurationMs).toBe(45_000);
  });

  it("should transition half_open -> open on any failure", () => {
    const config = cfg();
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 60_000,
      totalOpens: 1,
    };

    const updated = recordFailure(halfOpen, config, BASE_TIME);

    expect(updated.state).toBe("open");
    expect(updated.totalOpens).toBe(2);
    expect(updated.lastOpenedAt).toBe(BASE_TIME.toISOString());
  });

  it("should increase backoff when re-opening from half_open", () => {
    const config = cfg({ backoffMultiplier: 2, maxOpenDurationMs: 300_000 });
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 60_000,
    };

    const updated = recordFailure(halfOpen, config, BASE_TIME);

    expect(updated.currentOpenDurationMs).toBe(120_000); // 60_000 * 2
  });

  it("should cap backoff at maxOpenDurationMs", () => {
    const config = cfg({ backoffMultiplier: 2, maxOpenDurationMs: 100_000 });
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 80_000,
    };

    const updated = recordFailure(halfOpen, config, BASE_TIME);

    // 80_000 * 2 = 160_000, capped at 100_000
    expect(updated.currentOpenDurationMs).toBe(100_000);
  });

  it("should increment failure count in open state without changing state", () => {
    const config = cfg();
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      failureCount: 5,
      lastOpenedAt: BASE_TIME.toISOString(),
    };

    const updated = recordFailure(openState, config, BASE_TIME);

    expect(updated.state).toBe("open");
    expect(updated.failureCount).toBe(6);
  });
});

// ============================================================
// recordSuccess
// ============================================================

describe("recordSuccess", () => {
  it("should reset failure count in closed state", () => {
    const state: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      failureCount: 2,
    };

    const updated = recordSuccess(state, BASE_TIME);

    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(0);
    expect(updated.lastSuccessAt).toBe(BASE_TIME.toISOString());
  });

  it("should transition half_open -> closed on success", () => {
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      failureCount: 3,
      currentOpenDurationMs: 120_000,
    };

    const updated = recordSuccess(halfOpen, BASE_TIME);

    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(0);
    expect(updated.lastSuccessAt).toBe(BASE_TIME.toISOString());
  });

  it("should reset backoff to default on successful recovery", () => {
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 240_000, // elevated from prior trips
    };

    const updated = recordSuccess(halfOpen, BASE_TIME);

    expect(updated.currentOpenDurationMs).toBe(60_000); // reset to default
  });

  it("should handle success in open state gracefully", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
    };

    const updated = recordSuccess(openState, BASE_TIME);

    expect(updated.state).toBe("open"); // no transition
    expect(updated.lastSuccessAt).toBe(BASE_TIME.toISOString());
  });
});

// ============================================================
// checkCircuit
// ============================================================

describe("checkCircuit", () => {
  it("should allow calls when closed", () => {
    const state = createCircuitBreakerState();

    const { result, updatedState } = checkCircuit(state, BASE_TIME);

    expect(result.allowed).toBe(true);
    expect(result.state).toBe("closed");
    expect(updatedState).toBe(state); // no mutation
  });

  it("should allow calls when half_open", () => {
    const state: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
    };

    const { result } = checkCircuit(state, BASE_TIME);

    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
  });

  it("should block calls when open and duration not elapsed", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME.toISOString(),
      currentOpenDurationMs: 60_000,
    };

    const now = offsetMs(BASE_TIME, 30_000); // 30s into 60s open period
    const { result, updatedState } = checkCircuit(openState, now);

    expect(result.allowed).toBe(false);
    expect(result.state).toBe("open");
    expect(result.retryAfterMs).toBe(30_000); // 60s - 30s remaining
    expect(result.reason).toContain("open");
    expect(updatedState.state).toBe("open"); // no transition yet
  });

  it("should transition open -> half_open when duration elapsed", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME.toISOString(),
      currentOpenDurationMs: 60_000,
    };

    const now = offsetMs(BASE_TIME, 60_000); // exactly at open duration
    const { result, updatedState } = checkCircuit(openState, now);

    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
    expect(updatedState.state).toBe("half_open");
  });

  it("should transition open -> half_open when well past duration", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME.toISOString(),
      currentOpenDurationMs: 60_000,
    };

    const now = offsetMs(BASE_TIME, 120_000); // 2x the duration
    const { result, updatedState } = checkCircuit(openState, now);

    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
    expect(updatedState.state).toBe("half_open");
  });

  it("should handle open state with null lastOpenedAt gracefully", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: null, // edge case
    };

    const { result } = checkCircuit(openState, BASE_TIME);

    expect(result.allowed).toBe(false);
    expect(result.state).toBe("open");
    expect(result.reason).toContain("no open timestamp");
  });

  it("should calculate correct retryAfterMs at various points", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME.toISOString(),
      currentOpenDurationMs: 60_000,
    };

    // At 0s: retry after 60s
    const { result: r0 } = checkCircuit(openState, BASE_TIME);
    expect(r0.retryAfterMs).toBe(60_000);

    // At 15s: retry after 45s
    const { result: r15 } = checkCircuit(openState, offsetMs(BASE_TIME, 15_000));
    expect(r15.retryAfterMs).toBe(45_000);

    // At 59s: retry after 1s
    const { result: r59 } = checkCircuit(openState, offsetMs(BASE_TIME, 59_000));
    expect(r59.retryAfterMs).toBe(1_000);
  });

  it("should use currentOpenDurationMs (with backoff) not base openDurationMs", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME.toISOString(),
      currentOpenDurationMs: 120_000, // elevated from backoff
    };

    // At 60s: base would allow, but backoff requires 120s
    const now60 = offsetMs(BASE_TIME, 60_000);
    const { result: r60 } = checkCircuit(openState, now60);
    expect(r60.allowed).toBe(false);
    expect(r60.retryAfterMs).toBe(60_000); // 120s - 60s

    // At 120s: backoff elapsed
    const now120 = offsetMs(BASE_TIME, 120_000);
    const { result: r120 } = checkCircuit(openState, now120);
    expect(r120.allowed).toBe(true);
    expect(r120.state).toBe("half_open");
  });
});

// ============================================================
// Integration: Full Lifecycle
// ============================================================

describe("Full lifecycle: closed -> open -> half_open -> closed", () => {
  it("should complete a full trip-and-recovery cycle", () => {
    const config = cfg({
      failureThreshold: 3,
      openDurationMs: 60_000,
    });

    // 1. Start closed
    let state = createCircuitBreakerState();
    expect(state.state).toBe("closed");

    // 2. Three failures -> open
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("open");
    expect(state.totalOpens).toBe(1);

    // 3. Check at 30s: still blocked
    const { result: r30, updatedState: s30 } = checkCircuit(
      state, offsetMs(BASE_TIME, 30_000),
    );
    expect(r30.allowed).toBe(false);
    expect(r30.retryAfterMs).toBe(30_000);
    state = s30;

    // 4. Check at 60s: transitions to half_open
    const { result: r60, updatedState: s60 } = checkCircuit(
      state, offsetMs(BASE_TIME, 60_000),
    );
    expect(r60.allowed).toBe(true);
    expect(r60.state).toBe("half_open");
    state = s60;

    // 5. Success in half_open -> closed
    state = recordSuccess(state, offsetMs(BASE_TIME, 61_000));
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });

  it("should escalate backoff on repeated trip cycles", () => {
    const config = cfg({
      failureThreshold: 1,
      openDurationMs: 10_000,
      backoffMultiplier: 2,
      maxOpenDurationMs: 100_000,
    });

    let state = createCircuitBreakerState();
    let t = BASE_TIME;

    // Trip 1: open duration = 10s
    state = recordFailure(state, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(10_000);

    // Wait and recover
    t = offsetMs(t, 10_000);
    const { updatedState: halfOpen1 } = checkCircuit(state, t);
    state = recordSuccess(halfOpen1, t);
    expect(state.state).toBe("closed");
    expect(state.currentOpenDurationMs).toBe(60_000); // reset to default

    // Trip 2: open again, gets base openDurationMs
    state = recordFailure(state, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(10_000);

    // Wait and probe, but fail -> backoff = 20s
    t = offsetMs(t, 10_000);
    const { updatedState: halfOpen2 } = checkCircuit(state, t);
    state = recordFailure(halfOpen2, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(20_000); // 10_000 * 2

    // Wait and probe, but fail again -> backoff = 40s
    t = offsetMs(t, 20_000);
    const { updatedState: halfOpen3 } = checkCircuit(state, t);
    state = recordFailure(halfOpen3, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(40_000); // 20_000 * 2

    // Wait and probe, but fail again -> backoff = 80s
    t = offsetMs(t, 40_000);
    const { updatedState: halfOpen4 } = checkCircuit(state, t);
    state = recordFailure(halfOpen4, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(80_000); // 40_000 * 2

    // Wait and probe, but fail again -> backoff = 100s (capped)
    t = offsetMs(t, 80_000);
    const { updatedState: halfOpen5 } = checkCircuit(state, t);
    state = recordFailure(halfOpen5, config, t);
    expect(state.state).toBe("open");
    expect(state.currentOpenDurationMs).toBe(100_000); // capped at max
  });

  it("should track totalOpens across multiple trip cycles", () => {
    const config = cfg({ failureThreshold: 1, openDurationMs: 1_000 });
    let state = createCircuitBreakerState();
    let t = BASE_TIME;

    // Trip 1
    state = recordFailure(state, config, t);
    expect(state.totalOpens).toBe(1);

    // Recover
    t = offsetMs(t, 1_000);
    const { updatedState: ho1 } = checkCircuit(state, t);
    state = recordSuccess(ho1, t);

    // Trip 2
    state = recordFailure(state, config, t);
    expect(state.totalOpens).toBe(2);

    // Probe fails -> re-open (counted as trip 3)
    t = offsetMs(t, 1_000);
    const { updatedState: ho2 } = checkCircuit(state, t);
    state = recordFailure(ho2, config, t);
    expect(state.totalOpens).toBe(3);
  });
});

describe("Edge cases", () => {
  it("should handle success resetting failures before threshold", () => {
    const config = cfg({ failureThreshold: 3 });
    let state = createCircuitBreakerState();

    // Fail twice, then succeed
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.failureCount).toBe(2);

    state = recordSuccess(state, BASE_TIME);
    expect(state.failureCount).toBe(0);
    expect(state.state).toBe("closed");

    // Need 3 more failures to trip
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("closed");

    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("open");
  });

  it("should handle failure threshold of 1", () => {
    const config = cfg({ failureThreshold: 1 });
    const state = recordFailure(createCircuitBreakerState(), config, BASE_TIME);

    expect(state.state).toBe("open");
    expect(state.failureCount).toBe(1);
    expect(state.totalOpens).toBe(1);
  });

  it("should preserve immutability -- original state unchanged", () => {
    const config = cfg({ failureThreshold: 1 });
    const original = createCircuitBreakerState();

    const afterFailure = recordFailure(original, config, BASE_TIME);

    // Original should be unchanged
    expect(original.state).toBe("closed");
    expect(original.failureCount).toBe(0);
    expect(original.totalOpens).toBe(0);

    // New state should reflect failure
    expect(afterFailure.state).toBe("open");
    expect(afterFailure.failureCount).toBe(1);
  });
});
