import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EngramClient, MIN_SERVER_VERSION } from "../src/client.js";

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

describe("EngramClient.checkCompatibility", () => {
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

  it("should return compatible: true for server >= MIN_SERVER_VERSION", async () => {
    mockFetch = mockFetchResponse({ version: "0.30.0" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.checkCompatibility();
    expect(result.compatible).toBe(true);
    expect(result.serverVersion).toBe("0.30.0");
    expect(result.minRequired).toBe(MIN_SERVER_VERSION);
  });

  it("should return compatible: false for older server", async () => {
    mockFetch = mockFetchResponse({ version: "0.29.0" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.checkCompatibility();
    expect(result.compatible).toBe(false);
    expect(result.serverVersion).toBe("0.29.0");
  });

  it("should return compatible: false when version is missing", async () => {
    mockFetch = mockFetchResponse({ status: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.checkCompatibility();
    expect(result.compatible).toBe(false);
    expect(result.serverVersion).toBe("unknown");
  });

  it("should compare patch versions correctly", async () => {
    mockFetch = mockFetchResponse({ version: "0.29.99" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.checkCompatibility();
    // 0.29.99 < 0.30.0 (MIN_SERVER_VERSION)
    expect(result.compatible).toBe(false);
  });

  it("should return compatible: true for higher minor version", async () => {
    mockFetch = mockFetchResponse({ version: "0.31.0" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.checkCompatibility();
    expect(result.compatible).toBe(true);
  });
});

describe("MIN_SERVER_VERSION", () => {
  it("should be a valid semver string", () => {
    expect(MIN_SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
