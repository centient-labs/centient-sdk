/**
 * Tests for the injectable retry classifier (`EngramClientConfig.shouldRetry`,
 * issue #173).
 *
 * Two things are under test, and they pull in opposite directions on purpose:
 *
 * 1. **The seam works.** An injected predicate governs EVERY request path —
 *    the raw-response 5xx gate, the transport catch, and the request timeout —
 *    so a caller can adopt the brownout taxonomy from #116 without forking the
 *    client or wrapping every call.
 * 2. **The default did not move.** With no `shouldRetry`, the client makes the
 *    same decisions it made before the seam existed: timeouts terminal, 5xx
 *    retried, transport failures retried.
 *
 * Two invariants hold whatever predicate is injected, and are pinned here
 * because a predicate that could break them would be a footgun rather than a
 * seam: `retries` still caps the attempt count, and a deterministic
 * response-shape failure is never re-issued.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { EngramClient } from "../src/client.js";
import { EngramError, NetworkError, NotFoundError, TimeoutError } from "../src/errors.js";
import { isBrownoutTransientError, type RetryPredicate } from "../src/retry.js";

/**
 * Not a credential — a fixture value this client never authenticates with.
 * Bound to a named constant rather than inlined so the ADR-006 deterministic
 * secret-scan gate demotes it, matching the convention already used across
 * these tests (`client-health.test.ts:40`, `resources/invitations.test.ts:98`,
 * `resources/consolidation-queue.test.ts:79`).
 */
const placeholder = "test-api-key";

/** A client that sleeps ~nothing between attempts. */
function makeClient(overrides: {
  shouldRetry?: RetryPredicate;
  retries?: number;
}): EngramClient {
  return new EngramClient({
    baseUrl: "http://localhost:3100",
    apiKey: placeholder,
    timeout: 5000,
    retries: overrides.retries ?? 3,
    retryDelay: 1,
    shouldRetry: overrides.shouldRetry,
  });
}

/** The shape `fetch` rejects with when an AbortController fires. */
function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function stubFetch(impl: () => unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockImplementation(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EngramClientConfig.shouldRetry — the _requestRaw path", () => {
  it("does NOT retry a request timeout by default (unchanged 2.x behaviour)", async () => {
    const fetchMock = stubFetch(() => Promise.reject(abortError()));
    const client = makeClient({});

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a request timeout when the injected predicate accepts it", async () => {
    // The acceptance case from #173: the injected predicate overrides the
    // default on the _requestRaw path.
    const fetchMock = stubFetch(() => Promise.reject(abortError()));
    const client = makeClient({ shouldRetry: isBrownoutTransientError, retries: 3 });

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("hands the predicate the typed TimeoutError, not the raw AbortError", async () => {
    stubFetch(() => Promise.reject(abortError()));
    const seen: unknown[] = [];
    const client = makeClient({
      shouldRetry: (err) => {
        seen.push(err);
        return false;
      },
    });

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(TimeoutError);
  });

  it("stops retrying a 5xx when the injected predicate rejects it", async () => {
    // The response-site gate (which decides BEFORE parseApiError constructs the
    // typed error) must consult the predicate too — otherwise a hard-coded
    // status check silently bypasses the seam.
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse(500, { code: "INTERNAL_ERROR", message: "boom" })),
    );
    const client = makeClient({ shouldRetry: () => false, retries: 3 });

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      EngramError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries a 5xx by default", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse(500, { code: "INTERNAL_ERROR", message: "boom" })),
    );
    const client = makeClient({ retries: 3 });

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      EngramError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 4xx when the injected predicate accepts it", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse(429, { code: "RATE_LIMITED", message: "slow down" })),
    );
    const client = makeClient({
      shouldRetry: (err) => err instanceof EngramError && err.statusCode === 429,
      retries: 3,
    });

    await expect(client._requestRaw("GET", "/v1/exports/1")).rejects.toBeInstanceOf(
      EngramError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("EngramClientConfig.shouldRetry — the request() path", () => {
  it("retries an unknown transport Error by default, but NOT under the brownout taxonomy", async () => {
    // The inverted half of #116: a generic Error may be a non-idempotent
    // partial success, so the brownout predicate refuses to replay it.
    const defaultFetch = stubFetch(() => Promise.reject(new Error("something odd")));
    await expect(makeClient({ retries: 3 }).getSession("s1")).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(defaultFetch).toHaveBeenCalledTimes(3);

    const brownoutFetch = stubFetch(() => Promise.reject(new Error("something odd")));
    await expect(
      makeClient({ shouldRetry: isBrownoutTransientError, retries: 3 }).getSession("s1"),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(brownoutFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying a fetch TypeError under the brownout taxonomy", async () => {
    // The load-bearing carve-out: fetch reports every transport failure as a
    // bare TypeError, so adopting the predicate must not silently disable
    // retries for real network outages.
    const fetchMock = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const client = makeClient({ shouldRetry: isBrownoutTransientError, retries: 3 });

    await expect(client.getSession("s1")).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a request timeout under the brownout taxonomy, then surfaces TimeoutError", async () => {
    const fetchMock = stubFetch(() => Promise.reject(abortError()));
    const client = makeClient({ shouldRetry: isBrownoutTransientError, retries: 2 });

    await expect(client.getSession("s1")).rejects.toBeInstanceOf(TimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("EngramClientConfig.shouldRetry — invariants that no predicate can break", () => {
  it("`retries` still caps the attempt count under an always-true predicate", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse(404, { code: "NOT_FOUND", message: "gone" })),
    );
    const client = makeClient({ shouldRetry: () => true, retries: 2 });

    await expect(client.getSession("s1")).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never re-issues a deterministic non-JSON 2xx body, even with an always-true predicate", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        text: () => Promise.resolve("<html>proxy</html>"),
      }),
    );
    const client = makeClient({ shouldRetry: () => true, retries: 3 });

    await expect(client.getSession("s1")).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes every classification through the one `shouldRetry` field", () => {
    // The seam is only real if no path hard-codes its own taxonomy.
    // `isRetryableError` may appear in client.ts exactly once — as the default
    // bound in the constructor — and never as a direct call.
    const source = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
    // Comment lines are dropped: the JSDoc legitimately NAMES the default
    // predicate, and a prose mention is not a call site.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
      .join("\n");

    expect(code.match(/isRetryableError\s*\(/g)).toBeNull();
    expect(code).toContain("config.shouldRetry ?? isRetryableError");
    expect((code.match(/this\.shouldRetry\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
