/**
 * Retry tests — the injectable classifier is honoured exactly (no hidden
 * defaults leaking in), the packaged taxonomy matches its documented table,
 * and the loop's sleeps come from the injected backoff + sleep seams so no
 * real time is spent.
 */

import { describe, it, expect } from "vitest";
import { createBackoff } from "../src/backoff.js";
import { fixedRandom } from "../src/random.js";
import {
  withRetry,
  isTransientError,
  createTransientErrorPredicate,
  type ShouldRetry,
} from "../src/retry.js";

/** A sleep that records what it was asked to wait for, and waits for nothing. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sleep: async (ms: number) => {
      calls.push(ms);
    },
  };
}

/** Deterministic full-jitter schedule pinned at the top of each range. */
function pinnedBackoff() {
  return createBackoff({
    baseDelayMs: 500,
    strategy: "exponential",
    factor: 2,
    maxDelayMs: 5_000,
    jitter: "full",
    random: fixedRandom(0.5),
  });
}

/** An SDK-shaped error carrying a status code. */
function httpError(statusCode: number, message = "http failure"): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe("withRetry — loop mechanics", () => {
  it("returns the first success without sleeping", async () => {
    const { sleep, calls } = recordingSleep();
    const result = await withRetry(async () => "ok", { backoff: pinnedBackoff(), sleep });
    expect(result).toBe("ok");
    expect(calls).toEqual([]);
  });

  it("retries transient failures and returns the eventual success", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw httpError(503);
        return attempts;
      },
      { backoff: pinnedBackoff(), sleep },
    );
    expect(result).toBe(3);
    // Two sleeps, taken from the injected schedule: 0.5 * 500, 0.5 * 1000.
    expect(calls).toEqual([250, 500]);
  });

  it("re-throws the last error unchanged once attempts are exhausted", async () => {
    const { sleep, calls } = recordingSleep();
    const errors = [httpError(500, "first"), httpError(500, "second"), httpError(500, "third")];
    let i = 0;
    await expect(
      withRetry(
        async () => {
          throw errors[i++];
        },
        { backoff: pinnedBackoff(), sleep },
      ),
    ).rejects.toBe(errors[2]);
    expect(calls).toHaveLength(2); // 3 attempts sleep twice
  });

  it("stops immediately when the classifier rejects the failure", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw httpError(400, "bad request");
        },
        { backoff: pinnedBackoff(), sleep },
      ),
    ).rejects.toThrow("bad request");
    expect(attempts).toBe(1);
    expect(calls).toEqual([]);
  });

  it("reports each retry through onRetry before sleeping", async () => {
    const { sleep } = recordingSleep();
    const seen: Array<{ attempt: number; attempts: number; delayMs: number }> = [];
    let n = 0;
    await withRetry(
      async () => {
        n++;
        if (n < 3) throw httpError(502);
        return n;
      },
      {
        backoff: pinnedBackoff(),
        sleep,
        onRetry: ({ attempt, attempts, delayMs, error }) => {
          expect(error).toBeInstanceOf(Error);
          seen.push({ attempt, attempts, delayMs });
        },
      },
    );
    expect(seen).toEqual([
      { attempt: 1, attempts: 3, delayMs: 250 },
      { attempt: 2, attempts: 3, delayMs: 500 },
    ]);
  });

  it("honours attempts = 1 as no-retry", async () => {
    const { sleep, calls } = recordingSleep();
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(500);
        },
        { backoff: pinnedBackoff(), attempts: 1, sleep },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
    expect(calls).toEqual([]);
  });

  it("sleeps 0 when full jitter yields 0 — the fleet-de-correlating case", async () => {
    const { sleep, calls } = recordingSleep();
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      jitter: "full",
      random: fixedRandom(0),
    });
    let n = 0;
    await withRetry(
      async () => {
        n++;
        if (n < 3) throw httpError(500);
        return n;
      },
      { backoff, sleep },
    );
    expect(calls).toEqual([0, 0]);
  });

  it("rejects an attempts count the backoff's budget cannot cover", async () => {
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      jitter: "full",
      maxDelayMs: 5_000,
      attempts: 3,
      maxTotalDelayMs: 15_000,
    });
    await expect(
      withRetry(async () => "never", { backoff, attempts: 5 }),
    ).rejects.toThrow(/exceeds the backoff's budgeted 3/);
    // Within the budget it runs normally.
    await expect(withRetry(async () => "ok", { backoff, attempts: 3 })).resolves.toBe("ok");
  });

  it("defaults attempts to the backoff's declared budget, not to 3", async () => {
    // The chain length was stated once, on the schedule. Repeating it here
    // must not be required — and a budget tighter than the default must not
    // make the ergonomic path throw.
    const { sleep, calls } = recordingSleep();
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      factor: 2,
      maxDelayMs: 5_000,
      jitter: "full",
      attempts: 2,
      maxTotalDelayMs: 1_000,
      random: fixedRandom(0.5),
    });
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(503);
        },
        { backoff, sleep }, // no attempts
      ),
    ).rejects.toThrow("http failure"); // the op's error, NOT a RangeError
    expect(n).toBe(2); // exactly the budgeted chain
    expect(calls).toEqual([250]); // one sleep, not two
  });

  it("still guards an explicit overrun of a below-default budget", async () => {
    // The defaulting fix must not disable the guard it defaults around.
    const backoff = createBackoff({
      baseDelayMs: 500,
      strategy: "exponential",
      jitter: "full",
      attempts: 2,
      maxTotalDelayMs: 1_000,
    });
    await expect(withRetry(async () => "never", { backoff, attempts: 3 })).rejects.toThrow(
      /exceeds the backoff's budgeted 2/,
    );
  });

  it("falls back to 3 attempts when the backoff declared no budget", async () => {
    const { sleep, calls } = recordingSleep();
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(500);
        },
        { backoff: pinnedBackoff(), sleep }, // budgetedAttempts is undefined
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
    expect(calls).toHaveLength(2);
  });

  it("rejects a non-integer or sub-1 attempts", async () => {
    await expect(
      withRetry(async () => "x", { backoff: pinnedBackoff(), attempts: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      withRetry(async () => "x", { backoff: pinnedBackoff(), attempts: 2.5 }),
    ).rejects.toThrow(RangeError);
  });
});

describe("withRetry — injectable classifier", () => {
  it("uses the caller's predicate verbatim, in place of the default", async () => {
    const { sleep, calls } = recordingSleep();
    // Inverted stance: retry the 4xx the default would refuse.
    const shouldRetry: ShouldRetry = (e) => (e as { statusCode?: number }).statusCode === 404;
    let n = 0;
    const result = await withRetry(
      async () => {
        n++;
        if (n < 3) throw httpError(404);
        return "recovered";
      },
      { backoff: pinnedBackoff(), sleep, shouldRetry },
    );
    expect(result).toBe("recovered");
    expect(calls).toHaveLength(2);
  });

  it("does not consult the default once a predicate is supplied", async () => {
    const { sleep } = recordingSleep();
    // A predicate that refuses everything must stop even a 503, which the
    // default classifies as retryable.
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw httpError(503);
        },
        { backoff: pinnedBackoff(), sleep, shouldRetry: () => false },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });

  it("passes the raw thrown value, including non-Error throws", async () => {
    const seen: unknown[] = [];
    await expect(
      withRetry(
        async () => {
          throw "a bare string";
        },
        {
          backoff: pinnedBackoff(),
          sleep: async () => {},
          shouldRetry: (e) => {
            seen.push(e);
            return false;
          },
        },
      ),
    ).rejects.toBe("a bare string");
    expect(seen).toEqual(["a bare string"]);
  });
});

describe("isTransientError — packaged taxonomy", () => {
  it("retries request timeouts", () => {
    expect(isTransientError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      true,
    );
    expect(
      isTransientError(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    ).toBe(true);
    expect(isTransientError(Object.assign(new Error("nope"), { code: "TIMEOUT" }))).toBe(true);
    expect(isTransientError(new Error("Request timed out after 5000ms"))).toBe(true);
  });

  it("retries 5xx", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isTransientError(httpError(status))).toBe(true);
    }
    expect(isTransientError(Object.assign(new Error("x"), { status: 500 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { response: { status: 503 } }))).toBe(
      true,
    );
    expect(isTransientError(new Error("Internal server error"))).toBe(true);
  });

  it("retries network failures", () => {
    for (const code of ["NETWORK_ERROR", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]) {
      expect(isTransientError(Object.assign(new Error("net"), { code }))).toBe(true);
    }
    expect(isTransientError(new Error("connect ECONNREFUSED 127.0.0.1:8080"))).toBe(true);
  });

  it("does NOT retry 4xx, including a 409 CAS conflict", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(isTransientError(httpError(status))).toBe(false);
    }
  });

  it("does NOT retry schema-validation failures", () => {
    expect(isTransientError(Object.assign(new Error("invalid"), { name: "ZodError" }))).toBe(
      false,
    );
  });

  it("does NOT retry unknown or non-object throws (duplicate-write risk)", () => {
    expect(isTransientError(new Error("something went sideways"))).toBe(false);
    expect(isTransientError("a string")).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError({ nothing: "useful" })).toBe(false);
  });

  it("lets the status code win over a misleading message", () => {
    // A 400 whose message happens to mention a timeout is still deterministic.
    expect(isTransientError(httpError(400, "request timed out validating"))).toBe(false);
  });

  it("ignores a non-numeric or out-of-range status", () => {
    // A `status: "failed"` string must not be read as a code — it falls
    // through to the remaining rules, which classify it unknown.
    expect(isTransientError(Object.assign(new Error("x"), { status: "failed" }))).toBe(false);
    expect(isTransientError(Object.assign(new Error("x"), { statusCode: 99 }))).toBe(false);
  });
});

describe("createTransientErrorPredicate — variants", () => {
  it("treats a caller-owned conflict as terminal even when it looks retryable", () => {
    class CasConflict extends Error {
      readonly name = "TimeoutError"; // deliberately retryable-looking
    }
    const shouldRetry = createTransientErrorPredicate({
      isConflict: (e) => e instanceof CasConflict,
    });
    expect(shouldRetry(new CasConflict("version conflict"))).toBe(false);
    // The conflict hook does not disturb the rest of the taxonomy.
    expect(shouldRetry(httpError(503))).toBe(true);
  });

  it("adds caller-supplied retryable codes, case-insensitively", () => {
    const shouldRetry = createTransientErrorPredicate({ retryableCodes: ["eai_again"] });
    expect(shouldRetry(Object.assign(new Error("dns"), { code: "EAI_AGAIN" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("dns"), { code: "EAI_AGAIN" }))).toBe(false);
  });

  it("can flip the unknown-error stance to retry", () => {
    const shouldRetry = createTransientErrorPredicate({ retryUnknown: true });
    expect(shouldRetry(new Error("mystery"))).toBe(true);
    expect(shouldRetry("a string")).toBe(true);
    // Explicitly-classified terminals stay terminal.
    expect(shouldRetry(httpError(404))).toBe(false);
    expect(shouldRetry(Object.assign(new Error("invalid"), { name: "ZodError" }))).toBe(false);
  });

  it("returns an independent predicate per call (no shared mutable state)", () => {
    const a = createTransientErrorPredicate({ retryableCodes: ["EPIPE"] });
    const b = createTransientErrorPredicate();
    const err = Object.assign(new Error("pipe"), { code: "EPIPE" });
    expect(a(err)).toBe(true);
    expect(b(err)).toBe(false);
    expect(isTransientError(err)).toBe(false);
  });
});
