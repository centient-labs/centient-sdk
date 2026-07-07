/**
 * Health-route discriminated-union tests (engram-server 0.50.0 — #145).
 *
 * Covers, per endpoint, one test per union variant PLUS the 503-with-typed-body
 * path: since 0.50.0 the three health routes return the same union body on
 * HTTP 200 AND 503, so a 503 must resolve with the parsed variant (and must
 * NOT be retried) instead of being thrown as an opaque retryable error.
 * Also covers the ResponseShapeError guards (TS-bypassing / drifted bodies)
 * and checkCompatibility() against a degraded (503) server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient, MIN_SERVER_VERSION } from "../src/client.js";
import { EngramError, ResponseShapeError } from "../src/errors.js";
import type {
  DetailedHealthDegradedResponse,
  HealthDegradedResponse,
  ReadyFalseResponse,
  ReadyTrueResponse,
} from "../src/types.js";

// Helper to create mock fetch response (same shape as client.test.ts).
function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data) ?? ""),
  });
}

describe("health discriminated unions (0.50.0)", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  // Low-entropy placeholder bound to a neutrally-named var so the secret
  // scanner doesn't flag the fixture (same convention as client.test.ts and
  // client-logging.test.ts); the tests below exercise response parsing, not
  // the literal value.
  const placeholder = "test-api-key";

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: placeholder,
      timeout: 5000,
      retries: 3,
      retryDelay: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("health()", () => {
    it("resolves the ok variant on 200", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        clusterId: "c1",
        dataDirPresent: true,
        extensionsOk: true,
        pgChildAlive: true,
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.health();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/health",
        expect.any(Object),
      );
      expect(result.status).toBe("ok");
      expect(result.version).toBe("0.50.0");
    });

    it("resolves the degraded variant from a 503 typed body, without retrying", async () => {
      const body = {
        status: "degraded",
        version: "0.50.0",
        error: "postgres down",
        errorCode: "PG_UNAVAILABLE",
        recoveryHint: "restart the daemon",
        recovery: {
          active: true,
          attempts: 2,
          nextRetryAtIso: "2026-07-07T00:00:00Z",
          lastError: "connect ECONNREFUSED",
          disarmedReason: null,
        },
      };
      mockFetch = mockFetchResponse(body, 503);
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.health();

      // The 503 body is the answer — exactly one fetch, no retry burn.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("degraded");
      if (result.status !== "degraded") throw new Error("unreachable");
      // Narrowing on status reaches the variant-only fields.
      const degraded: HealthDegradedResponse = result;
      expect(degraded.error).toBe("postgres down");
      expect(degraded.errorCode).toBe("PG_UNAVAILABLE");
      expect(degraded.recovery?.active).toBe(true);
      expect(degraded.recovery?.disarmedReason).toBeNull();
    });

    it("resolves the unhealthy variant from a 503 typed body", async () => {
      mockFetch = mockFetchResponse(
        { status: "unhealthy", version: "0.50.0", error: "data dir missing" },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.health();

      expect(result.status).toBe("unhealthy");
      if (result.status !== "unhealthy") throw new Error("unreachable");
      expect(result.error).toBe("data dir missing");
    });

    it("throws ResponseShapeError when a degraded body is missing errorCode", async () => {
      mockFetch = mockFetchResponse(
        { status: "degraded", version: "0.50.0", error: "postgres down" },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.health()).rejects.toThrow(ResponseShapeError);
    });

    it("throws ResponseShapeError on an unknown status discriminant", async () => {
      mockFetch = mockFetchResponse({ status: "meh", version: "0.50.0" });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.health()).rejects.toThrow(ResponseShapeError);
    });
  });

  describe("healthDetailed()", () => {
    it("resolves the ok variant on 200 (postgres required, uptime is a string)", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: {
          status: "ok",
          type: "embedded",
          latencyMs: 3,
          idleInTransaction: { count: 0, oldestMs: 0 },
        },
        uptime: "3600s",
        embedding: "ready",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthDetailed();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/health/detailed",
        expect.any(Object),
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("unreachable");
      expect(result.postgres.status).toBe("ok");
      expect(result.uptime).toBe("3600s");
    });

    it("resolves the degraded variant from a 503 typed body, without retrying", async () => {
      const body: DetailedHealthDegradedResponse = {
        status: "degraded",
        version: "0.50.0",
        postgres: {
          status: "degraded",
          type: "embedded",
          error: "connection refused",
          errorCode: "PG_UNAVAILABLE",
          recoveryHint: "restart the daemon",
        },
        embedding: "degraded",
        recovery: {
          active: false,
          attempts: 5,
          nextRetryAtIso: null,
          lastError: "connect ECONNREFUSED",
          disarmedReason: "version mismatch",
        },
      };
      mockFetch = mockFetchResponse(body, 503);
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthDetailed();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("degraded");
      if (result.status === "ok") throw new Error("unreachable");
      expect(result.postgres.errorCode).toBe("PG_UNAVAILABLE");
      expect(result.recovery?.disarmedReason).toBe("version mismatch");
    });

    it("maps status 'unhealthy' onto the degraded variant (same union member)", async () => {
      mockFetch = mockFetchResponse(
        {
          status: "unhealthy",
          version: "0.50.0",
          postgres: { status: "unhealthy", type: "unavailable" },
        },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthDetailed();

      expect(result.status).toBe("unhealthy");
      if (result.status === "ok") throw new Error("unreachable");
      expect(result.postgres.status).toBe("unhealthy");
    });

    it("throws ResponseShapeError when postgres is missing (pre-0.50.0 flat shape)", async () => {
      // The pre-0.50.0 SDK modeling — a server that still returns it is drift.
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.49.0",
        uptime: 3600,
        dependencies: {},
        circuitBreakers: {},
        rateLimiters: {},
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("throws ResponseShapeError when uptime is a number (pre-0.50.0 type)", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "ok" },
        uptime: 3600,
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("keeps normal typed-error behavior for non-503 errors (401)", async () => {
      mockFetch = mockFetchResponse(
        { error: { code: "UNAUTHORIZED", message: "API key required" } },
        401,
      );
      vi.stubGlobal("fetch", mockFetch);

      const error = await client.healthDetailed().then(
        () => {
          throw new Error("expected healthDetailed() to reject");
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(EngramError);
      expect((error as EngramError).statusCode).toBe(401);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("healthReady()", () => {
    it("resolves the ready-true variant on 200 (all fields required)", async () => {
      mockFetch = mockFetchResponse({
        ready: true,
        version: "0.50.0",
        latencyMs: 2,
        embedding: "ready",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthReady();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/health/ready",
        expect.any(Object),
      );
      expect(result.ready).toBe(true);
      if (!result.ready) throw new Error("unreachable");
      const ready: ReadyTrueResponse = result;
      expect(ready.latencyMs).toBe(2);
      expect(ready.embedding).toBe("ready");
    });

    it("resolves the ready-false variant from a 503 typed body, without retrying", async () => {
      mockFetch = mockFetchResponse(
        { ready: false, reason: "embedding_warming", embedding: "warming" },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthReady();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.ready).toBe(false);
      if (result.ready) throw new Error("unreachable");
      const notReady: ReadyFalseResponse = result;
      expect(notReady.reason).toBe("embedding_warming");
      expect(notReady.embedding).toBe("warming");
    });

    it("throws ResponseShapeError when the true variant is missing latencyMs", async () => {
      mockFetch = mockFetchResponse({
        ready: true,
        version: "0.50.0",
        embedding: "ready",
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthReady()).rejects.toThrow(ResponseShapeError);
    });

    it("throws ResponseShapeError when the false variant is missing reason", async () => {
      mockFetch = mockFetchResponse({ ready: false }, 503);
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthReady()).rejects.toThrow(ResponseShapeError);
    });
  });

  describe("enum discriminants are guarded against exact union values (mbot #146 R2)", () => {
    it("healthDetailed(): rejects an invalid nested postgres.status under an ok parent", async () => {
      // The reported case: a string, but not a union member — must not pass.
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "meh" },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("healthDetailed(): rejects postgres.status 'ok' under a degraded parent (variant coupling)", async () => {
      // The exported types couple the nested block to the parent variant:
      // DetailedHealthDegradedResponse.postgres is PostgresHealthDegraded
      // ("degraded"|"unhealthy"), never PostgresHealthOk.
      mockFetch = mockFetchResponse(
        {
          status: "degraded",
          version: "0.50.0",
          postgres: { status: "ok" },
        },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("healthDetailed(): rejects an invalid postgres.type", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "ok", type: "sqlite" },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("healthDetailed(): rejects an invalid embedding state", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "ok" },
        embedding: "loading",
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("healthDetailed(): rejects an invalid migrations.lastErrorCode", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "ok" },
        migrations: {
          consecutiveFailures: 2,
          escalated: false,
          firstFailedAt: "2026-07-01T00:00:00Z",
          lastFailedAt: "2026-07-02T00:00:00Z",
          lastErrorCode: "disk_full",
          message: "migration apply loop failed",
          pendingIds: ["m1"],
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthDetailed()).rejects.toThrow(ResponseShapeError);
    });

    it("healthDetailed(): accepts a valid migrations block (bounded enum, nullable)", async () => {
      mockFetch = mockFetchResponse({
        status: "ok",
        version: "0.50.0",
        postgres: { status: "ok" },
        migrations: {
          consecutiveFailures: 1,
          escalated: false,
          firstFailedAt: "2026-07-01T00:00:00Z",
          lastFailedAt: "2026-07-02T00:00:00Z",
          lastErrorCode: "lock_held",
          message: "migration apply loop failed",
          pendingIds: ["m1"],
        },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.healthDetailed();
      expect(result.migrations?.lastErrorCode).toBe("lock_held");
    });

    it("healthReady(): rejects an invalid embedding state on the true variant", async () => {
      mockFetch = mockFetchResponse({
        ready: true,
        version: "0.50.0",
        latencyMs: 2,
        embedding: "loading",
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthReady()).rejects.toThrow(ResponseShapeError);
    });

    it("healthReady(): rejects an invalid embedding state on the false variant when present", async () => {
      mockFetch = mockFetchResponse(
        { ready: false, reason: "embedding_warming", embedding: "loading" },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.healthReady()).rejects.toThrow(ResponseShapeError);
    });
  });

  describe("checkCompatibility() against a degraded server", () => {
    it("calls /v1/health (not the retired /health alias)", async () => {
      mockFetch = mockFetchResponse({ status: "ok", version: "0.50.0" });
      vi.stubGlobal("fetch", mockFetch);

      await client.checkCompatibility();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/health",
        expect.any(Object),
      );
    });

    it("resolves the version from a degraded 503 typed body instead of throwing", async () => {
      mockFetch = mockFetchResponse(
        {
          status: "degraded",
          version: "0.50.0",
          error: "postgres down",
          errorCode: "PG_UNAVAILABLE",
        },
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.checkCompatibility();

      // Every 0.50.0 variant carries version, so the read stays safe across
      // the union — and a degraded server still answers the compat question.
      expect(result.serverVersion).toBe("0.50.0");
      expect(result.compatible).toBe(true);
      expect(result.minRequired).toBe(MIN_SERVER_VERSION);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
