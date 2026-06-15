/**
 * Shimmers Resource Tests
 *
 * Covers each use-case method, the 409 SHIMMER_CAS_CONFLICT → ShimmerCasConflictError
 * mapping, the 503 SHIMMER_DISABLED → ShimmerDisabledError mapping, and that the
 * read shape never carries an ownerToken (engram-server #933 P1).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import {
  EngramError,
  ShimmerCasConflictError,
  ShimmerDisabledError,
} from "../../src/errors.js";
import type { Shimmer, ShimmerRead } from "../../src/types/shimmer.js";

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** The nested `{ error: { code, message } }` envelope engram emits on error. */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

// ============================================================================
// Fixtures
// ============================================================================

const baseRecord = {
  recordKey: "agent-42",
  value: { pid: 1234 },
  revision: 0,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
  fadesAt: "2026-06-15T00:01:00.000Z",
};

const lockRecord: Shimmer = {
  ...baseRecord,
  recordType: "lock",
  ownerToken: "owner-secret-token",
};

const heartbeatRecord: Shimmer = {
  ...baseRecord,
  recordType: "heartbeat",
  ownerToken: null,
};

const ipcRecord: Shimmer = {
  ...baseRecord,
  recordType: "ipc",
  ownerToken: null,
  value: { msg: "hello" },
};

const readRecord: ShimmerRead = {
  ...baseRecord,
  recordType: "lock",
  ownerToken: null,
};

// ============================================================================
// Test Setup
// ============================================================================

describe("ShimmersResource", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      retries: 1,
    });
    mockFetch = mockFetchResponse({});
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // heartbeat()
  // ==========================================================================

  describe("shimmers.heartbeat", () => {
    it("POSTs a heartbeat overwrite and returns the record", async () => {
      mockFetch = mockFetchResponse({ success: true, data: heartbeatRecord });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.heartbeat(
        "agent-42",
        { pid: 1234 },
        { ttlSeconds: 30 },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/shimmers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            recordType: "heartbeat",
            key: "agent-42",
            ttlSeconds: 30,
            value: { pid: 1234 },
          }),
        }),
      );
      expect(result.recordType).toBe("heartbeat");
      expect(result.ownerToken).toBeNull();
    });
  });

  // ==========================================================================
  // acquireLock()
  // ==========================================================================

  describe("shimmers.acquireLock", () => {
    it("POSTs a lock acquire and echoes back the caller's ownerToken", async () => {
      mockFetch = mockFetchResponse({ success: true, data: lockRecord });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.acquireLock("agent-42", {
        ownerToken: "owner-secret-token",
        ttlSeconds: 60,
        value: { pid: 1234 },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/shimmers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            recordType: "lock",
            key: "agent-42",
            ownerToken: "owner-secret-token",
            ttlSeconds: 60,
            value: { pid: 1234 },
          }),
        }),
      );
      expect(result.ownerToken).toBe("owner-secret-token");
      expect(result.revision).toBe(0);
    });

    it("throws ShimmerCasConflictError on 409", async () => {
      mockFetch = mockFetchResponse(
        errorBody("SHIMMER_CAS_CONFLICT", "Lock is already held by another live owner"),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.shimmers.acquireLock("agent-42", {
          ownerToken: "loser-token",
          ttlSeconds: 60,
        }),
      ).rejects.toBeInstanceOf(ShimmerCasConflictError);
    });

    it("does not expose the holder's ownerToken in the 409 error", async () => {
      mockFetch = mockFetchResponse(
        {
          error: {
            code: "SHIMMER_CAS_CONFLICT",
            message: "Lock is already held by another live owner",
            details: { current: { ...readRecord, ownerToken: null } },
          },
        },
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.shimmers
        .acquireLock("agent-42", { ownerToken: "loser-token", ttlSeconds: 60 })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ShimmerCasConflictError);
      // The SDK carries through the inner `error.details` object; the holder's
      // ownerToken is already redacted to null by the server (#933 P1).
      const details = (err as ShimmerCasConflictError).details as {
        current?: { ownerToken: unknown };
      };
      expect(details.current?.ownerToken).toBeNull();
    });
  });

  // ==========================================================================
  // renewLock()
  // ==========================================================================

  describe("shimmers.renewLock", () => {
    it("PUTs a lock renew/CAS with expectedRevision and ownerToken", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: { ...lockRecord, revision: 1 },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.renewLock("agent-42", {
        ownerToken: "owner-secret-token",
        expectedRevision: 0,
        ttlSeconds: 60,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/shimmers/agent-42",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            recordType: "lock",
            ownerToken: "owner-secret-token",
            expectedRevision: 0,
            ttlSeconds: 60,
            value: undefined,
          }),
        }),
      );
      expect(result.revision).toBe(1);
      expect(result.ownerToken).toBe("owner-secret-token");
    });

    it("throws ShimmerCasConflictError on a revision mismatch (409)", async () => {
      mockFetch = mockFetchResponse(
        errorBody(
          "SHIMMER_CAS_CONFLICT",
          "Lock CAS conflict — revision/owner did not match the live holder",
        ),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.shimmers.renewLock("agent-42", {
          ownerToken: "owner-secret-token",
          expectedRevision: 99,
          ttlSeconds: 60,
        }),
      ).rejects.toBeInstanceOf(ShimmerCasConflictError);
    });
  });

  // ==========================================================================
  // releaseLock()
  // ==========================================================================

  describe("shimmers.releaseLock", () => {
    it("DELETEs a lock with recordType=lock and ownerToken in the query", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: { released: true, consumed: null },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.releaseLock("agent-42", {
        ownerToken: "owner-secret-token",
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/shimmers/agent-42");
      expect(calledUrl).toContain("recordType=lock");
      expect(calledUrl).toContain("ownerToken=owner-secret-token");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(result.released).toBe(true);
      expect(result.consumed).toBeNull();
    });

    it("returns released:false for a non-holder (not an error)", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: { released: false, consumed: null },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.releaseLock("agent-42", {
        ownerToken: "not-the-holder",
      });
      expect(result.released).toBe(false);
    });
  });

  // ==========================================================================
  // emitIpc()
  // ==========================================================================

  describe("shimmers.emitIpc", () => {
    it("POSTs an ipc write-once message", async () => {
      mockFetch = mockFetchResponse({ success: true, data: ipcRecord });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.emitIpc(
        "agent-42",
        { msg: "hello" },
        { ttlSeconds: 120 },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/shimmers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            recordType: "ipc",
            key: "agent-42",
            ttlSeconds: 120,
            value: { msg: "hello" },
          }),
        }),
      );
      expect(result.recordType).toBe("ipc");
      expect(result.ownerToken).toBeNull();
    });

    it("throws ShimmerCasConflictError when a live message already exists (409)", async () => {
      mockFetch = mockFetchResponse(
        errorBody(
          "SHIMMER_CAS_CONFLICT",
          "A live IPC message already exists for this key (write-once)",
        ),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.shimmers.emitIpc("agent-42", { msg: "dup" }, { ttlSeconds: 120 }),
      ).rejects.toBeInstanceOf(ShimmerCasConflictError);
    });
  });

  // ==========================================================================
  // consumeIpc()
  // ==========================================================================

  describe("shimmers.consumeIpc", () => {
    it("DELETEs (consume) and returns the consumed record", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: { released: true, consumed: { ...ipcRecord, ownerToken: null } },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.consumeIpc("agent-42");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/shimmers/agent-42");
      expect(calledUrl).toContain("recordType=ipc");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(result).not.toBeNull();
      expect(result?.value).toEqual({ msg: "hello" });
      expect(result?.ownerToken).toBeNull();
    });

    it("returns null when no live message existed", async () => {
      mockFetch = mockFetchResponse({
        success: true,
        data: { released: false, consumed: null },
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.consumeIpc("agent-42");
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // get()
  // ==========================================================================

  describe("shimmers.get", () => {
    it("GETs a live shimmer with recordType in the query; result has no ownerToken", async () => {
      mockFetch = mockFetchResponse({ success: true, data: readRecord });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.shimmers.get("agent-42", "lock");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/shimmers/agent-42");
      expect(calledUrl).toContain("recordType=lock");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "GET" }),
      );
      // Read shape NEVER carries a non-null ownerToken (engram-server #933 P1).
      expect(result.ownerToken).toBeNull();
      expect(result.recordKey).toBe("agent-42");
    });

    it("throws a 404 EngramError on an absent or faded read (RES_NOT_FOUND)", async () => {
      mockFetch = mockFetchResponse(
        errorBody("RES_NOT_FOUND", "No live shimmer for this (recordType, key)"),
        404,
      );
      vi.stubGlobal("fetch", mockFetch);

      // engram emits the nested `{ error: { code, message } }` envelope, which
      // the SDK maps to a typed EngramError carrying the server code + 404 status
      // (the legacy NotFoundError switch only fires on a bare `{ code, message }`).
      const err = await client.shimmers.get("missing", "heartbeat").catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("RES_NOT_FOUND");
      expect((err as EngramError).statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // 503 SHIMMER_DISABLED mapping (whole surface)
  // ==========================================================================

  describe("SHIMMER_DISABLED mapping", () => {
    it("maps 503 SHIMMER_DISABLED to ShimmerDisabledError", async () => {
      mockFetch = mockFetchResponse(
        errorBody(
          "SHIMMER_DISABLED",
          "Shimmers are not enabled on this deployment. Set ENGRAM_SHIMMER_ENABLED=true to enable /v1/shimmers.",
        ),
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.shimmers.heartbeat("agent-42", {}, { ttlSeconds: 30 }),
      ).rejects.toBeInstanceOf(ShimmerDisabledError);
    });

    it("surfaces SHIMMER_DISABLED on a read too (whole surface gated)", async () => {
      mockFetch = mockFetchResponse(
        errorBody("SHIMMER_DISABLED", "Shimmers are not enabled on this deployment."),
        503,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.shimmers.get("agent-42", "lock"),
      ).rejects.toBeInstanceOf(ShimmerDisabledError);
    });
  });
});
