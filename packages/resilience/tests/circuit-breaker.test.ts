/**
 * Circuit breaker tests — pure state machine ported from crucible's
 * `tests/state/circuit-breaker.test.ts` (adapted from ISO timestamps to
 * epoch-ms), plus tests for the clock-injected stateful factory.
 */

import { describe, it, expect } from "vitest";
import {
  createCircuitBreaker,
  createCircuitBreakerState,
  getDefaultCircuitBreakerConfig,
  checkCircuit,
  recordSuccess,
  recordFailure,
  CircuitOpenError,
} from "../src/circuit-breaker.js";
import type {
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "../src/circuit-breaker.js";
import { createManualClock } from "../src/clock.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TIME = new Date("2026-02-09T12:00:00.000Z").getTime();

function offsetMs(base: number, ms: number): number {
  return base + ms;
}

function cfg(overrides?: Partial<CircuitBreakerConfig>): CircuitBreakerConfig {
  return { ...getDefaultCircuitBreakerConfig(), ...overrides };
}

function tripOpen(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = getDefaultCircuitBreakerConfig(),
  now: number = BASE_TIME,
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
  it("creates a closed state with zero counters", () => {
    const state = createCircuitBreakerState();
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.totalOpens).toBe(0);
    expect(state.lastOpenedAt).toBeNull();
    expect(state.lastFailureAt).toBeNull();
    expect(state.lastSuccessAt).toBeNull();
  });

  it("initializes currentOpenDurationMs to the config open duration", () => {
    expect(createCircuitBreakerState().currentOpenDurationMs).toBe(60_000);
    expect(
      createCircuitBreakerState(cfg({ openDurationMs: 5_000 })).currentOpenDurationMs,
    ).toBe(5_000);
  });
});

describe("getDefaultCircuitBreakerConfig", () => {
  it("returns expected calibration defaults", () => {
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
  it("increments failure count without transition below threshold", () => {
    const updated = recordFailure(createCircuitBreakerState(), cfg({ failureThreshold: 3 }), BASE_TIME);
    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(1);
    expect(updated.lastFailureAt).toBe(BASE_TIME);
  });

  it("stays closed after threshold minus one failures", () => {
    const config = cfg({ failureThreshold: 3 });
    let state = createCircuitBreakerState();
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(2);
  });

  it("transitions closed -> open at failure threshold", () => {
    const config = cfg({ failureThreshold: 3 });
    const state = tripOpen(createCircuitBreakerState(), config);
    expect(state.state).toBe("open");
    expect(state.failureCount).toBe(3);
    expect(state.totalOpens).toBe(1);
    expect(state.lastOpenedAt).toBe(BASE_TIME);
  });

  it("sets currentOpenDurationMs to openDurationMs on first trip", () => {
    const config = cfg({ failureThreshold: 1, openDurationMs: 45_000 });
    const state = recordFailure(createCircuitBreakerState(config), config, BASE_TIME);
    expect(state.currentOpenDurationMs).toBe(45_000);
  });

  it("transitions half_open -> open on any failure", () => {
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 60_000,
      totalOpens: 1,
    };
    const updated = recordFailure(halfOpen, cfg(), BASE_TIME);
    expect(updated.state).toBe("open");
    expect(updated.totalOpens).toBe(2);
    expect(updated.lastOpenedAt).toBe(BASE_TIME);
  });

  it("increases backoff when re-opening from half_open", () => {
    const config = cfg({ backoffMultiplier: 2, maxOpenDurationMs: 300_000 });
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 60_000,
    };
    expect(recordFailure(halfOpen, config, BASE_TIME).currentOpenDurationMs).toBe(120_000);
  });

  it("caps backoff at maxOpenDurationMs", () => {
    const config = cfg({ backoffMultiplier: 2, maxOpenDurationMs: 100_000 });
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 80_000,
    };
    expect(recordFailure(halfOpen, config, BASE_TIME).currentOpenDurationMs).toBe(100_000);
  });

  it("increments failure count in open state without changing state", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      failureCount: 5,
      lastOpenedAt: BASE_TIME,
    };
    const updated = recordFailure(openState, cfg(), BASE_TIME);
    expect(updated.state).toBe("open");
    expect(updated.failureCount).toBe(6);
  });
});

// ============================================================
// recordSuccess
// ============================================================

describe("recordSuccess", () => {
  it("resets failure count in closed state", () => {
    const state: CircuitBreakerState = { ...createCircuitBreakerState(), failureCount: 2 };
    const updated = recordSuccess(state, BASE_TIME);
    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(0);
    expect(updated.lastSuccessAt).toBe(BASE_TIME);
  });

  it("transitions half_open -> closed on success", () => {
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      failureCount: 3,
      currentOpenDurationMs: 120_000,
    };
    const updated = recordSuccess(halfOpen, BASE_TIME);
    expect(updated.state).toBe("closed");
    expect(updated.failureCount).toBe(0);
    expect(updated.lastSuccessAt).toBe(BASE_TIME);
  });

  it("resets backoff to default on successful recovery", () => {
    const halfOpen: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "half_open",
      currentOpenDurationMs: 240_000,
    };
    expect(recordSuccess(halfOpen, BASE_TIME).currentOpenDurationMs).toBe(60_000);
  });

  it("handles success in open state gracefully", () => {
    const openState: CircuitBreakerState = { ...createCircuitBreakerState(), state: "open" };
    const updated = recordSuccess(openState, BASE_TIME);
    expect(updated.state).toBe("open");
    expect(updated.lastSuccessAt).toBe(BASE_TIME);
  });
});

// ============================================================
// checkCircuit
// ============================================================

describe("checkCircuit", () => {
  it("allows calls when closed", () => {
    const state = createCircuitBreakerState();
    const { result, updatedState } = checkCircuit(state, BASE_TIME);
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("closed");
    expect(updatedState).toBe(state);
  });

  it("allows calls when half_open", () => {
    const state: CircuitBreakerState = { ...createCircuitBreakerState(), state: "half_open" };
    const { result } = checkCircuit(state, BASE_TIME);
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
  });

  it("blocks calls when open and duration not elapsed", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME,
      currentOpenDurationMs: 60_000,
    };
    const { result, updatedState } = checkCircuit(openState, offsetMs(BASE_TIME, 30_000));
    expect(result.allowed).toBe(false);
    expect(result.state).toBe("open");
    expect(result.retryAfterMs).toBe(30_000);
    expect(result.reason).toContain("open");
    expect(updatedState.state).toBe("open");
  });

  it("transitions open -> half_open when duration elapsed", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME,
      currentOpenDurationMs: 60_000,
    };
    const { result, updatedState } = checkCircuit(openState, offsetMs(BASE_TIME, 60_000));
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
    expect(updatedState.state).toBe("half_open");
  });

  it("transitions open -> half_open when well past duration", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME,
      currentOpenDurationMs: 60_000,
    };
    const { result } = checkCircuit(openState, offsetMs(BASE_TIME, 120_000));
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("half_open");
  });

  it("handles open state with null lastOpenedAt gracefully", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: null,
    };
    const { result } = checkCircuit(openState, BASE_TIME);
    expect(result.allowed).toBe(false);
    expect(result.state).toBe("open");
    expect(result.reason).toContain("no open timestamp");
  });

  it("calculates correct retryAfterMs at various points", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME,
      currentOpenDurationMs: 60_000,
    };
    expect(checkCircuit(openState, BASE_TIME).result.retryAfterMs).toBe(60_000);
    expect(checkCircuit(openState, offsetMs(BASE_TIME, 15_000)).result.retryAfterMs).toBe(45_000);
    expect(checkCircuit(openState, offsetMs(BASE_TIME, 59_000)).result.retryAfterMs).toBe(1_000);
  });

  it("uses currentOpenDurationMs (with backoff) not base openDurationMs", () => {
    const openState: CircuitBreakerState = {
      ...createCircuitBreakerState(),
      state: "open",
      lastOpenedAt: BASE_TIME,
      currentOpenDurationMs: 120_000,
    };
    const r60 = checkCircuit(openState, offsetMs(BASE_TIME, 60_000)).result;
    expect(r60.allowed).toBe(false);
    expect(r60.retryAfterMs).toBe(60_000);
    const r120 = checkCircuit(openState, offsetMs(BASE_TIME, 120_000)).result;
    expect(r120.allowed).toBe(true);
    expect(r120.state).toBe("half_open");
  });
});

// ============================================================
// Integration: full lifecycle (ported)
// ============================================================

describe("Full lifecycle: closed -> open -> half_open -> closed", () => {
  it("completes a full trip-and-recovery cycle", () => {
    const config = cfg({ failureThreshold: 3, openDurationMs: 60_000 });
    let state = createCircuitBreakerState(config);
    expect(state.state).toBe("closed");

    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("open");
    expect(state.totalOpens).toBe(1);

    const s30 = checkCircuit(state, offsetMs(BASE_TIME, 30_000));
    expect(s30.result.allowed).toBe(false);
    expect(s30.result.retryAfterMs).toBe(30_000);
    state = s30.updatedState;

    const s60 = checkCircuit(state, offsetMs(BASE_TIME, 60_000));
    expect(s60.result.allowed).toBe(true);
    expect(s60.result.state).toBe("half_open");
    state = s60.updatedState;

    state = recordSuccess(state, offsetMs(BASE_TIME, 61_000));
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });

  it("escalates backoff on repeated trip cycles", () => {
    const config = cfg({
      failureThreshold: 1,
      openDurationMs: 10_000,
      backoffMultiplier: 2,
      maxOpenDurationMs: 100_000,
    });
    let state = createCircuitBreakerState(config);
    let t = BASE_TIME;

    state = recordFailure(state, config, t);
    expect(state.currentOpenDurationMs).toBe(10_000);

    t = offsetMs(t, 10_000);
    state = recordSuccess(checkCircuit(state, t).updatedState, t, config);
    expect(state.state).toBe("closed");
    expect(state.currentOpenDurationMs).toBe(10_000); // reset to config open duration

    state = recordFailure(state, config, t);
    expect(state.currentOpenDurationMs).toBe(10_000);

    t = offsetMs(t, 10_000);
    state = recordFailure(checkCircuit(state, t).updatedState, config, t);
    expect(state.currentOpenDurationMs).toBe(20_000);

    t = offsetMs(t, 20_000);
    state = recordFailure(checkCircuit(state, t).updatedState, config, t);
    expect(state.currentOpenDurationMs).toBe(40_000);

    t = offsetMs(t, 40_000);
    state = recordFailure(checkCircuit(state, t).updatedState, config, t);
    expect(state.currentOpenDurationMs).toBe(80_000);

    t = offsetMs(t, 80_000);
    state = recordFailure(checkCircuit(state, t).updatedState, config, t);
    expect(state.currentOpenDurationMs).toBe(100_000); // capped
  });

  it("tracks totalOpens across multiple trip cycles", () => {
    const config = cfg({ failureThreshold: 1, openDurationMs: 1_000 });
    let state = createCircuitBreakerState(config);
    let t = BASE_TIME;

    state = recordFailure(state, config, t);
    expect(state.totalOpens).toBe(1);

    t = offsetMs(t, 1_000);
    state = recordSuccess(checkCircuit(state, t).updatedState, t, config);

    state = recordFailure(state, config, t);
    expect(state.totalOpens).toBe(2);

    t = offsetMs(t, 1_000);
    state = recordFailure(checkCircuit(state, t).updatedState, config, t);
    expect(state.totalOpens).toBe(3);
  });
});

describe("Edge cases", () => {
  it("handles success resetting failures before threshold", () => {
    const config = cfg({ failureThreshold: 3 });
    let state = createCircuitBreakerState(config);
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.failureCount).toBe(2);
    state = recordSuccess(state, BASE_TIME);
    expect(state.failureCount).toBe(0);
    state = recordFailure(state, config, BASE_TIME);
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("closed");
    state = recordFailure(state, config, BASE_TIME);
    expect(state.state).toBe("open");
  });

  it("handles failure threshold of 1", () => {
    const config = cfg({ failureThreshold: 1 });
    const state = recordFailure(createCircuitBreakerState(config), config, BASE_TIME);
    expect(state.state).toBe("open");
    expect(state.totalOpens).toBe(1);
  });

  it("preserves immutability — original state unchanged", () => {
    const config = cfg({ failureThreshold: 1 });
    const original = createCircuitBreakerState(config);
    const after = recordFailure(original, config, BASE_TIME);
    expect(original.state).toBe("closed");
    expect(original.failureCount).toBe(0);
    expect(after.state).toBe("open");
  });
});

// ============================================================
// Stateful factory (clock-injected)
// ============================================================

describe("createCircuitBreaker (stateful, clock-injected)", () => {
  it("executes the task and returns its value when closed", async () => {
    const breaker = createCircuitBreaker({ clock: createManualClock(BASE_TIME).clock });
    await expect(breaker.execute(async () => 42)).resolves.toBe(42);
    expect(breaker.getState()).toBe("closed");
  });

  it("trips open after the failure threshold and rejects with CircuitOpenError", async () => {
    const t = createManualClock(BASE_TIME);
    const breaker = createCircuitBreaker({ failureThreshold: 2, clock: t.clock });
    const boom = (): Promise<never> => Promise.reject(new Error("boom"));

    await expect(breaker.execute(boom)).rejects.toThrow("boom");
    await expect(breaker.execute(boom)).rejects.toThrow("boom");
    expect(breaker.snapshot().state).toBe("open");

    await expect(breaker.execute(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("recovers through half_open after the open duration elapses", async () => {
    const t = createManualClock(BASE_TIME);
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 5_000,
      clock: t.clock,
    });
    await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(breaker.snapshot().state).toBe("open");

    // Still open before the duration elapses.
    t.advance(4_999);
    expect(breaker.canExecute()).toBe(false);

    // After the duration: half_open, probe succeeds -> closed.
    t.advance(1);
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("surfaces retryAfterMs on the CircuitOpenError", async () => {
    const t = createManualClock(BASE_TIME);
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 10_000,
      clock: t.clock,
    });
    await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
    t.advance(3_000);
    try {
      await breaker.execute(async () => 1);
      throw new Error("expected CircuitOpenError");
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError);
      expect((e as CircuitOpenError).retryAfterMs).toBe(7_000);
    }
  });

  it("reset returns the breaker to a fresh closed state", () => {
    const t = createManualClock(BASE_TIME);
    const breaker = createCircuitBreaker({ failureThreshold: 1, clock: t.clock });
    breaker.onFailure();
    expect(breaker.snapshot().state).toBe("open");
    breaker.reset();
    expect(breaker.snapshot().state).toBe("closed");
    expect(breaker.snapshot().failureCount).toBe(0);
  });
});
