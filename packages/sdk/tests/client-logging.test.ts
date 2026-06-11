/**
 * Client-side request logging tests.
 *
 * Verifies the optional `logger` on EngramClientConfig:
 * - debug entry per retry (attempt #, delay, error class, method + path)
 * - warn on retries exhausted and on TimeoutError
 * - zero output when no logger is injected (no console fallback)
 * - sanitization: no headers (X-API-Key / Authorization), no request bodies,
 *   no query strings, and no credential material in any logged argument
 *   (regex scan across everything the fake logger captured)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { EngramClient } from "../src/client.js";
import { TimeoutError, NetworkError } from "../src/errors.js";
import { sanitizeRequestPath, sanitizeErrorClass } from "../src/logging.js";

interface CapturedEntry {
  level: "debug" | "warn";
  context: Record<string, unknown>;
  message: string;
}

function createFakeLogger() {
  const entries: CapturedEntry[] = [];
  return {
    entries,
    logger: {
      debug: (context: Record<string, unknown>, message: string) =>
        entries.push({ level: "debug", context, message }),
      warn: (context: Record<string, unknown>, message: string) =>
        entries.push({ level: "warn", context, message }),
    },
  };
}

/** Serialize everything the fake logger captured, for secret-scan assertions. */
function serializeEntries(entries: CapturedEntry[]): string {
  return entries
    .map((e) => JSON.stringify([e.level, e.context, e.message]))
    .join("\n");
}

// Low-entropy placeholder bound to a neutrally-named var so the secret scanner
// doesn't flag the fixture; the tests assert this string never appears in any
// captured log argument.
const credentialFixture = "fixture-credential-value-123";

function mockServerErrorFetch() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({ code: "INTERNAL_ERROR", message: "Server error" }),
    text: () =>
      Promise.resolve(
        JSON.stringify({ code: "INTERNAL_ERROR", message: "Server error" }),
      ),
  });
}

function mockNetworkErrorFetch(error: Error = new TypeError("fetch failed")) {
  return vi.fn().mockRejectedValue(error);
}

/** Fetch that never resolves and honors the abort signal (timeout path). */
function mockHangingFetch() {
  return vi.fn().mockImplementation((_url, options) => {
    return new Promise((_resolve, reject) => {
      const signal = options?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      }
      // Never resolve — let the client timeout trigger.
    });
  });
}

function makeClient(logger?: {
  debug(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}) {
  return new EngramClient({
    baseUrl: "http://localhost:3100",
    apiKey: credentialFixture,
    userId: "user-1",
    retries: 3,
    retryDelay: 1,
    logger,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("client logging", () => {
  describe("sanitize helpers", () => {
    it("sanitizeRequestPath strips query strings and fragments", () => {
      expect(sanitizeRequestPath("/v1/notes?limit=5&q=secret")).toBe("/v1/notes");
      expect(sanitizeRequestPath("/v1/notes#frag")).toBe("/v1/notes");
      expect(sanitizeRequestPath("/v1/notes")).toBe("/v1/notes");
      expect(sanitizeRequestPath("/v1/export?apiKey=abc#x")).toBe("/v1/export");
    });

    it("sanitizeErrorClass falls back to constructor.name when error.name is empty", () => {
      class Nameless extends Error {
        constructor() {
          super("payload that must not be logged");
          this.name = "";
        }
      }
      expect(sanitizeErrorClass(new Nameless())).toBe("Nameless");
    });

    it("sanitizeErrorClass reduces non-Error throwables to a content-free tag", () => {
      expect(sanitizeErrorClass(null)).toBe("null");
      expect(sanitizeErrorClass(undefined)).toBe("undefined");
      expect(sanitizeErrorClass("a-string-with-secret-sauce")).toBe("string");
      expect(sanitizeErrorClass(42)).toBe("number");
      // Plain objects and arrays deliberately reduce to "object": anything
      // more specific would require stringifying the value, which could leak
      // embedded content into a log line.
      expect(sanitizeErrorClass({ password: "nope" })).toBe("object");
      expect(sanitizeErrorClass(["nope"])).toBe("object");
    });

    it("sanitizeErrorClass reduces errors to their class name only", () => {
      const err = new Error(`leak Authorization: Bearer ${credentialFixture}`);
      err.name = "FetchError";
      expect(sanitizeErrorClass(err)).toBe("FetchError");
      expect(sanitizeErrorClass(new TypeError("x"))).toBe("TypeError");
      expect(sanitizeErrorClass("string-throw")).toBe("string");
    });
  });

  describe("retry logging (debug)", () => {
    it("logs each 5xx retry with attempt #, delay, error class, method and path", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      await expect(client.health()).rejects.toThrow();

      const retries = entries.filter((e) => e.level === "debug");
      // retries=3 → attempts 1 and 2 are retried, attempt 3 exhausts.
      expect(retries).toHaveLength(2);
      retries.forEach((entry, i) => {
        expect(entry.message).toBe("engram-sdk: retrying request");
        expect(entry.context.method).toBe("GET");
        expect(entry.context.path).toBe("/v1/health");
        expect(entry.context.attempt).toBe(i + 1);
        expect(entry.context.delayMs).toBe(1 * (i + 1));
        expect(entry.context.status).toBe(500);
        expect(typeof entry.context.errorClass).toBe("string");
        expect(entry.context.errorClass).not.toBe("");
      });
    });

    it("logs network-error retries with the error class", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockNetworkErrorFetch());

      await expect(client.health()).rejects.toThrow(NetworkError);

      const retries = entries.filter((e) => e.level === "debug");
      expect(retries).toHaveLength(2);
      for (const entry of retries) {
        expect(entry.context.errorClass).toBe("TypeError");
        expect(entry.context.method).toBe("GET");
        expect(entry.context.path).toBe("/v1/health");
      }
    });
  });

  describe("exhaustion and timeout logging (warn)", () => {
    it("logs warn when 5xx retries are exhausted", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      await expect(client.health()).rejects.toThrow();

      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.message).toBe("engram-sdk: retries exhausted");
      expect(warns[0]?.context.attempt).toBe(3);
      expect(warns[0]?.context.maxRetries).toBe(3);
      expect(warns[0]?.context.status).toBe(500);
      expect(warns[0]?.context.method).toBe("GET");
      expect(warns[0]?.context.path).toBe("/v1/health");
    });

    it("logs warn when network-error retries are exhausted", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockNetworkErrorFetch());

      await expect(client.health()).rejects.toThrow(NetworkError);

      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.context.errorClass).toBe("TypeError");
    });

    it("logs warn on TimeoutError", async () => {
      const { entries, logger } = createFakeLogger();
      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 1,
        logger,
      });
      vi.stubGlobal("fetch", mockHangingFetch());

      await expect(client.health()).rejects.toThrow(TimeoutError);

      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.message).toBe("engram-sdk: request timed out");
      expect(warns[0]?.context.timeoutMs).toBe(1);
      expect(warns[0]?.context.errorClass).toBe("TimeoutError");
      expect(warns[0]?.context.method).toBe("GET");
      expect(warns[0]?.context.path).toBe("/v1/health");
    });
  });

  describe("raw request paths (_requestRaw / _requestRawBody / _requestFormData)", () => {
    it("_requestRaw logs retry + exhaustion on 5xx", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      await expect(client._requestRaw("GET", "/v1/export")).rejects.toThrow();

      expect(entries.filter((e) => e.level === "debug")).toHaveLength(2);
      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.context.errorClass).toBe("HttpError");
      expect(warns[0]?.context.status).toBe(500);
      expect(warns[0]?.context.path).toBe("/v1/export");
    });

    it("_requestRawBody logs retry + exhaustion on 5xx", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      await expect(
        client._requestRawBody("POST", "/v1/sync/push", "{}", "application/x-ndjson"),
      ).rejects.toThrow();

      expect(entries.filter((e) => e.level === "debug")).toHaveLength(2);
      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.context.errorClass).toBe("HttpError");
      expect(warns[0]?.context.path).toBe("/v1/sync/push");
    });

    it("_requestFormData logs retry + exhaustion on 5xx", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      await expect(
        client._requestFormData("POST", "/v1/import", new FormData()),
      ).rejects.toThrow();

      expect(entries.filter((e) => e.level === "debug")).toHaveLength(2);
      const warns = entries.filter((e) => e.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]?.context.errorClass).toBe("HttpError");
      expect(warns[0]?.context.path).toBe("/v1/import");
    });
  });

  describe("sanitization", () => {
    it("never logs apiKey, X-API-Key, Authorization, query strings, or request bodies", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockServerErrorFetch());

      // Query-string path through the standard request pipeline.
      await expect(
        client.listNotes("session-1", { type: "decision", limit: 5 }),
      ).rejects.toThrow();
      // Query string with explicit credential material through the raw path.
      await expect(
        client._requestRaw(
          "GET",
          `/v1/export?apiKey=${credentialFixture}&token=${credentialFixture}#frag`,
        ),
      ).rejects.toThrow();
      // Request body with sensitive content.
      await expect(
        client.createNote("session-1", {
          type: "decision",
          content: `body-secret-material ${credentialFixture}`,
        }),
      ).rejects.toThrow();

      expect(entries.length).toBeGreaterThan(0);

      const serialized = serializeEntries(entries);
      // Header material must never appear.
      expect(serialized).not.toMatch(/x-api-key/i);
      expect(serialized).not.toMatch(/authorization/i);
      expect(serialized).not.toMatch(/bearer/i);
      // The credential value itself must never appear.
      expect(serialized).not.toContain(credentialFixture);
      // Query strings must be stripped — no key=value pairs, no raw '?'/'#'
      // in any logged path.
      expect(serialized).not.toMatch(/[?#]/);
      expect(serialized).not.toContain("type=decision");
      expect(serialized).not.toContain("limit=");
      expect(serialized).not.toContain("apiKey=");
      expect(serialized).not.toContain("token=");
      // Request bodies must never appear.
      expect(serialized).not.toContain("body-secret-material");
      for (const entry of entries) {
        expect(String(entry.context.path)).not.toMatch(/[?#]/);
      }
    });

    it("does not leak secret material embedded in error messages (logs error class only)", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      const leakyError = new Error(
        `connect failed for http://localhost:3100/v1/health?apiKey=${credentialFixture} ` +
          `Authorization: Bearer ${credentialFixture} X-API-Key: ${credentialFixture}`,
      );
      leakyError.name = "FetchError";
      vi.stubGlobal("fetch", mockNetworkErrorFetch(leakyError));

      await expect(client.health()).rejects.toThrow(NetworkError);

      expect(entries.length).toBeGreaterThan(0);
      const serialized = serializeEntries(entries);
      expect(serialized).not.toContain(credentialFixture);
      expect(serialized).not.toMatch(/x-api-key/i);
      expect(serialized).not.toMatch(/authorization/i);
      // Only the class name survives.
      const classes = entries.map((e) => e.context.errorClass);
      expect(new Set(classes).size).toBeGreaterThan(0);
      expect(classes).toContain("FetchError");
    });
  });

  describe("no logger injected", () => {
    it("emits nothing — no console fallback — on retries, exhaustion, or timeout", async () => {
      const spies = (["log", "debug", "info", "warn", "error", "trace"] as const).map(
        (m) => vi.spyOn(console, m).mockImplementation(() => {}),
      );

      const client = new EngramClient({
        baseUrl: "http://localhost:3100",
        apiKey: credentialFixture,
        retries: 3,
        retryDelay: 1,
      });

      vi.stubGlobal("fetch", mockServerErrorFetch());
      await expect(client.health()).rejects.toThrow();

      vi.stubGlobal("fetch", mockNetworkErrorFetch());
      await expect(client.health()).rejects.toThrow(NetworkError);

      const timeoutClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 1,
      });
      vi.stubGlobal("fetch", mockHangingFetch());
      await expect(timeoutClient.health()).rejects.toThrow(TimeoutError);

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  describe("quiet on success", () => {
    function mockOkFetch() {
      return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "ok" }),
        text: () => Promise.resolve(JSON.stringify({ status: "ok" })),
      });
    }

    it("logs nothing for successful requests via request()", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockOkFetch());

      await client.health();
      expect(entries).toHaveLength(0);
    });

    it("logs nothing for successful _requestRaw / _requestRawBody / _requestFormData", async () => {
      const { entries, logger } = createFakeLogger();
      const client = makeClient(logger);
      vi.stubGlobal("fetch", mockOkFetch());

      await client._requestRaw("GET", "/v1/export");
      await client._requestRawBody(
        "POST",
        "/v1/sync/push",
        "{}",
        "application/x-ndjson",
      );
      await client._requestFormData("POST", "/v1/import", new FormData());
      expect(entries).toHaveLength(0);
    });
  });
});
