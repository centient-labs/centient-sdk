/**
 * LibsecretVault — listKeys tests
 *
 * Tests both the D-Bus primary path (via mocked dbus-next) and the
 * secret-tool fallback path (via mocked child_process.execSync).
 *
 * The dbus-next mock simulates the freedesktop secrets service API:
 *   - sessionBus() → bus
 *   - bus.getProxyObject() → proxy with getInterface()
 *   - service.SearchItems() → [unlockedPaths, lockedPaths]
 *   - props.Get("...Item", "Attributes") → attribute dict
 *
 * When dbus-next throws (simulating no session bus), the fallback
 * exercises the secret-tool CLI parser — same as the pre-0.5.0 code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockSessionBus = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("dbus-next", () => ({
  sessionBus: mockSessionBus,
}));

const { LibsecretVault } = await import("../src/vault/vault-libsecret.js");

// ---------------------------------------------------------------------------
// D-Bus mock helpers
// ---------------------------------------------------------------------------

function makeDbusItem(key: string): {
  getInterface: (name: string) => {
    Get: (_iface: string, _prop: string) => Promise<{
      value: Array<[{ value: string }, { value: string }]>;
    }>;
  };
} {
  return {
    getInterface: (_name: string) => ({
      Get: async () => ({
        value: [
          [{ value: "service" }, { value: "centient" }],
          [{ value: "key" }, { value: key }],
        ],
      }),
    }),
  };
}

function setupDbusMock(keys: string[]): void {
  const itemPaths = keys.map((_, i) => `/org/freedesktop/secrets/collection/login/${i}`);
  const itemMap = new Map<string, ReturnType<typeof makeDbusItem>>();
  keys.forEach((key, i) => {
    itemMap.set(itemPaths[i]!, makeDbusItem(key));
  });

  const bus = {
    getProxyObject: vi.fn(async (_service: string, path: string) => {
      if (path === "/org/freedesktop/secrets") {
        return {
          getInterface: (_name: string) => ({
            SearchItems: async () => [itemPaths, []],
          }),
        };
      }
      const item = itemMap.get(path);
      if (!item) throw new Error(`Unknown path: ${path}`);
      return item;
    }),
    disconnect: vi.fn(),
  };

  mockSessionBus.mockReturnValue(bus);
}

// ---------------------------------------------------------------------------
// secret-tool fallback output fixture
// ---------------------------------------------------------------------------

const SAMPLE_SECRET_TOOL_OUTPUT = `[/org/freedesktop/secrets/collection/login/123]
label = centient-auth
secret = super-secret-value-should-not-be-returned
attribute.service = centient
attribute.key = auth-token

[/org/freedesktop/secrets/collection/login/124]
label = centient-auth
secret = another-secret-value
attribute.service = centient
attribute.key = soma-anthropic-token1

[/org/freedesktop/secrets/collection/login/125]
label = centient-auth
secret = yet-another
attribute.service = centient
attribute.key = soma-anthropic-token2
`;

beforeEach(() => {
  mockExecSync.mockReset();
  mockSessionBus.mockReset();
});

// ---------------------------------------------------------------------------
// D-Bus primary path
// ---------------------------------------------------------------------------

describe("LibsecretVault.listKeys — D-Bus path", () => {
  it("returns every key from the SearchItems results", async () => {
    setupDbusMock(["auth-token", "soma-anthropic-token1", "soma-anthropic-token2"]);
    const vault = new LibsecretVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
  });

  it("filters by prefix", async () => {
    setupDbusMock(["auth-token", "soma-anthropic-token1", "soma-anthropic-token2"]);
    const vault = new LibsecretVault();
    const result = await vault.listKeys("soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("auth-token");
  });

  it("returns [] when SearchItems returns no items", async () => {
    setupDbusMock([]);
    const vault = new LibsecretVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("disconnects the bus after successful enumeration", async () => {
    setupDbusMock(["auth-token"]);
    const vault = new LibsecretVault();
    await vault.listKeys();
    const bus = mockSessionBus.mock.results[0]!.value;
    expect(bus.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke secret-tool when D-Bus succeeds", async () => {
    setupDbusMock(["auth-token"]);
    const vault = new LibsecretVault();
    await vault.listKeys();
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// secret-tool fallback path
// ---------------------------------------------------------------------------

describe("LibsecretVault.listKeys — secret-tool fallback", () => {
  beforeEach(() => {
    mockSessionBus.mockImplementation(() => {
      throw new Error("no session bus available");
    });
  });

  it("falls back to secret-tool when D-Bus fails", async () => {
    mockExecSync.mockReturnValue(SAMPLE_SECRET_TOOL_OUTPUT);
    const vault = new LibsecretVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
  });

  it("filters by prefix in fallback mode", async () => {
    mockExecSync.mockReturnValue(SAMPLE_SECRET_TOOL_OUTPUT);
    const vault = new LibsecretVault();
    const result = await vault.listKeys("soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
  });

  it("returns [] when secret-tool exits status 1 (no matches)", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { status: number };
      err.status = 1;
      throw err;
    });
    const vault = new LibsecretVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("propagates other transient failures from secret-tool (status != 1)", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("secret-tool: timeout") as Error & { status: number };
      err.status = 127;
      throw err;
    });
    const vault = new LibsecretVault();
    await expect(vault.listKeys()).rejects.toThrow(/timeout/);
  });

  it("does NOT return secret values from secret-tool output", async () => {
    mockExecSync.mockReturnValue(SAMPLE_SECRET_TOOL_OUTPUT);
    const vault = new LibsecretVault();
    const result = await vault.listKeys();
    for (const key of result) {
      expect(key).not.toContain("secret");
      expect(key).not.toContain("super-secret-value");
    }
  });
});
