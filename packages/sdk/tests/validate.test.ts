/**
 * Runtime response-shape validation tests (issue #62).
 *
 * Three suites:
 *  1. Unit tests for the `validate.ts` envelope-family guards (standard
 *     `{data,meta}` envelope, sync `{success,data}` envelope, bare bodies).
 *  2. Table-driven integration: feed truncated/null/wrong-typed bodies through
 *     a mocked `fetch` per family and assert the typed `ResponseShapeError`.
 *  3. Non-retryability: a malformed body triggers exactly ONE `fetch` call even
 *     when `retries > 1` (deterministic-failure rule, #76).
 *
 * Plus a happy-path smoke assertion per representative resource (one per
 * family) proving the validator does not reject valid payloads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient } from "../src/client.js";
import { ResponseShapeError, EngramError } from "../src/errors.js";
import {
  requireObject,
  unwrapData,
  unwrapDataObject,
  unwrapNullableData,
  requireField,
  requireArray,
  assertArray,
  isString,
  isNumber,
  isBoolean,
  isNullableString,
} from "../src/validate.js";

// ============================================================================
// Helpers
// ============================================================================

/** A mocked `fetch` returning `data` as a 2xx JSON body. */
function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ "content-type": "application/json" }),
  });
}

// ============================================================================
// 1. Unit tests — the guards in isolation
// ============================================================================

describe("validate.ts guards", () => {
  const PATH = "GET /v1/thing";
  const RES = "thing";

  describe("requireObject", () => {
    it("returns the object for a valid body", () => {
      const obj = { a: 1 };
      expect(requireObject(obj, PATH, RES)).toBe(obj);
    });

    it.each<[string, unknown]>([
      ["null", null],
      ["undefined", undefined],
      ["array", [1, 2]],
      ["string", "nope"],
      ["number", 42],
    ])("throws ResponseShapeError for %s", (_label, body) => {
      expect(() => requireObject(body, PATH, RES)).toThrow(ResponseShapeError);
    });
  });

  describe("unwrapData (standard / sync envelope)", () => {
    it("unwraps a valid { data } envelope", () => {
      expect(unwrapData({ data: { id: "x" } }, PATH, RES)).toEqual({ id: "x" });
    });

    it("unwraps a { success, data } sync envelope", () => {
      expect(unwrapData({ success: true, data: { ok: 1 } }, PATH, RES)).toEqual({ ok: 1 });
    });

    it.each<[string, unknown]>([
      ["missing data key", { meta: {} }],
      ["null data", { data: null }],
      ["primitive data", { data: 5 }],
      ["success=false", { success: false, data: { id: "x" } }],
      ["non-object envelope", "garbled"],
    ])("throws ResponseShapeError for %s", (_label, body) => {
      expect(() => unwrapData(body, PATH, RES)).toThrow(ResponseShapeError);
    });

    it("accepts an array data payload (list endpoints)", () => {
      expect(unwrapData({ data: [1, 2] }, PATH, RES)).toEqual([1, 2]);
    });
  });

  describe("unwrapDataObject", () => {
    it("rejects an array data payload (object expected)", () => {
      expect(() => unwrapDataObject({ data: [1, 2] }, PATH, RES)).toThrow(ResponseShapeError);
    });
    it("returns the object data payload", () => {
      expect(unwrapDataObject({ data: { k: 1 } }, PATH, RES)).toEqual({ k: 1 });
    });
  });

  describe("unwrapNullableData", () => {
    it("allows a null data payload", () => {
      expect(unwrapNullableData({ data: null }, PATH, RES)).toBeNull();
    });
    it("returns a present object payload", () => {
      expect(unwrapNullableData({ data: { x: 1 } }, PATH, RES)).toEqual({ x: 1 });
    });
    it("still rejects a missing envelope key", () => {
      expect(() => unwrapNullableData({ meta: {} }, PATH, RES)).toThrow(ResponseShapeError);
    });
  });

  describe("requireField", () => {
    const obj = { s: "a", n: 1, b: true, maybe: null };
    it("passes for satisfied predicates", () => {
      expect(() => requireField(obj, "s", isString, PATH, RES)).not.toThrow();
      expect(() => requireField(obj, "n", isNumber, PATH, RES)).not.toThrow();
      expect(() => requireField(obj, "b", isBoolean, PATH, RES)).not.toThrow();
      expect(() => requireField(obj, "maybe", isNullableString, PATH, RES)).not.toThrow();
    });
    it("throws naming the failing key", () => {
      expect(() => requireField(obj, "n", isString, PATH, RES)).toThrow(/field "n"/);
    });
    it("rejects NaN as a number", () => {
      expect(() => requireField({ n: NaN }, "n", isNumber, PATH, RES)).toThrow(ResponseShapeError);
    });
  });

  describe("requireArray / assertArray", () => {
    it("requireArray returns the array", () => {
      expect(requireArray([1, 2], PATH, RES)).toEqual([1, 2]);
    });
    it("requireArray throws for a non-array", () => {
      expect(() => requireArray({ not: "array" }, PATH, RES)).toThrow(ResponseShapeError);
    });
    it("assertArray narrows without throwing for arrays", () => {
      expect(() => assertArray([], PATH, RES)).not.toThrow();
    });
    it("assertArray throws for a non-array", () => {
      expect(() => assertArray(7, PATH, RES)).toThrow(ResponseShapeError);
    });
  });

  describe("ResponseShapeError shape", () => {
    it("carries path + resource and is an EngramError", () => {
      try {
        requireObject(null, "GET /v1/x", "x-resource");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ResponseShapeError);
        expect(err).toBeInstanceOf(EngramError);
        const e = err as ResponseShapeError;
        expect(e.name).toBe("ResponseShapeError");
        expect(e.path).toBe("GET /v1/x");
        expect(e.resource).toBe("x-resource");
        // Non-retryable: no 5xx statusCode that would re-enter the retry path.
        expect(e.statusCode).toBeUndefined();
      }
    });

    it("does not leak the offending value into the message", () => {
      try {
        requireObject("super-secret-token", "GET /v1/x", "x");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as Error).message).not.toContain("super-secret-token");
        expect((err as Error).message).toContain("string");
      }
    });
  });
});

// ============================================================================
// 2 + 3. End-to-end through the client (mocked fetch), table-driven per family
// ============================================================================

describe("response-shape validation through resources", () => {
  let client: EngramClient;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      // retries > 1 so the no-retry assertion is meaningful for a malformed body.
      retries: 3,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // --- Standard { data, meta } envelope family (edges resource) ----------
  describe("standard { data } envelope (edges.get)", () => {
    const malformed: Array<[string, unknown]> = [
      ["null data", { data: null }],
      ["missing data key", { meta: {} }],
      ["primitive data", { data: 7 }],
      ["truncated (empty object)", {}],
    ];

    it.each(malformed)("throws ResponseShapeError on %s", async (_label, body) => {
      const mockFetch = mockFetchResponse(body);
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.edges.get("edge-1")).rejects.toBeInstanceOf(ResponseShapeError);
      // Non-retryable: malformed body is deterministic, exactly one fetch.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses a valid envelope", async () => {
      const edge = {
        id: "edge-1",
        sourceId: "a",
        targetId: "b",
        relationship: "related_to",
      };
      vi.stubGlobal("fetch", mockFetchResponse({ data: edge }));
      await expect(client.edges.get("edge-1")).resolves.toMatchObject({ id: "edge-1" });
    });
  });

  // --- Sync { success, data } envelope family (sync.getStatus) ------------
  describe("sync { success, data } envelope (sync.getStatus)", () => {
    const malformed: Array<[string, unknown]> = [
      ["null data", { success: true, data: null }],
      ["success=false", { success: false, data: { instanceId: "i" } }],
      ["wrong-typed field", {
        data: {
          instanceId: "i",
          schemaVersion: "1",
          peersCount: "not-a-number",
          activeLinksCount: 0,
          changelogSize: 0,
        },
      }],
      ["truncated (missing fields)", { data: { instanceId: "i" } }],
    ];

    it.each(malformed)("throws ResponseShapeError on %s", async (_label, body) => {
      const mockFetch = mockFetchResponse(body);
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.sync.getStatus()).rejects.toBeInstanceOf(ResponseShapeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses a valid sync status", async () => {
      const status = {
        instanceId: "i",
        schemaVersion: "1.0",
        peersCount: 2,
        activeLinksCount: 1,
        changelogSize: 10,
      };
      vi.stubGlobal("fetch", mockFetchResponse({ success: true, data: status }));
      await expect(client.sync.getStatus()).resolves.toEqual(status);
    });
  });

  // --- Bare body family (maintenance.vacuum) -----------------------------
  describe("bare body (maintenance.vacuum)", () => {
    const malformed: Array<[string, unknown]> = [
      ["null body", null],
      ["missing vacuumed", { full: false }],
      ["wrong-typed full", { vacuumed: [], full: "yes" }],
      ["vacuumed not an array", { vacuumed: "all", full: false }],
    ];

    it.each(malformed)("throws ResponseShapeError on %s", async (_label, body) => {
      const mockFetch = mockFetchResponse(body);
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.maintenance.vacuum()).rejects.toBeInstanceOf(ResponseShapeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses a valid bare vacuum body", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ vacuumed: ["t1", "t2"], full: false }));
      await expect(client.maintenance.vacuum()).resolves.toEqual({
        vacuumed: ["t1", "t2"],
        full: false,
      });
    });
  });

  // --- Bare peers body (sync.peers.get) ----------------------------------
  describe("bare peers body (sync.peers.get)", () => {
    it("throws ResponseShapeError on { peer: null }", async () => {
      const mockFetch = mockFetchResponse({ peer: null });
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.sync.peers.get("p1")).rejects.toBeInstanceOf(ResponseShapeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses a valid bare peer", async () => {
      const peer = { id: "p1", name: "peer", url: "http://p" };
      vi.stubGlobal("fetch", mockFetchResponse({ peer }));
      await expect(client.sync.peers.get("p1")).resolves.toMatchObject({ id: "p1" });
    });
  });

  // --- Nested data field family (agents.get) -----------------------------
  describe("nested { data: { agent } } (agents.get)", () => {
    it("throws ResponseShapeError when agent is missing", async () => {
      const mockFetch = mockFetchResponse({ data: {} });
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.agents.get("a1")).rejects.toBeInstanceOf(ResponseShapeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses a nested agent", async () => {
      const agent = { agentId: "a1", externalId: "ext", displayName: "A", role: "dev", permissions: [] };
      vi.stubGlobal("fetch", mockFetchResponse({ data: { agent } }));
      await expect(client.agents.get("a1")).resolves.toMatchObject({ agentId: "a1" });
    });
  });

  // --- List endpoint smoke (edges.list — array data) ---------------------
  describe("list endpoint (edges.list)", () => {
    it("throws ResponseShapeError when data is not an array", async () => {
      const mockFetch = mockFetchResponse({ data: { not: "array" } });
      vi.stubGlobal("fetch", mockFetch);
      await expect(client.edges.list()).rejects.toBeInstanceOf(ResponseShapeError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("happy path parses an array envelope", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ data: [{ id: "e1" }], meta: { pagination: { total: 1 } } }));
      const result = await client.edges.list();
      expect(result.edges).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });
});
