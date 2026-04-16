/**
 * SecretsPolicy — integration tests
 *
 * Tests the policy middleware layer by configuring policies via
 * `setSecretsPolicies` and verifying that `before` / `after` hooks
 * fire on storeCredential, getCredential, deleteCredential, and
 * listCredentials. The Keychain backend is mocked (same pattern as
 * vault.test.ts) so no real keychain access occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import type { SecretsEvent, SecretsOperation } from "../src/vault/policy.js";

// =============================================================================
// Mock vault-common (same pattern as vault.test.ts)
// =============================================================================

const {
  mockStoreString,
  mockGetString,
  mockDelete,
  mockListAccounts,
  _originalPlatform,
} = vi.hoisted(() => {
  const _originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin", writable: true });
  return {
    mockStoreString: vi.fn(),
    mockGetString: vi.fn(),
    mockDelete: vi.fn(),
    mockListAccounts: vi.fn(),
    _originalPlatform,
  };
});

vi.mock("../src/crypto/vault-common.js", () => ({
  storeStringInKeychain: mockStoreString,
  getStringFromKeychain: mockGetString,
  deleteFromKeychain: mockDelete,
  listAccountsInKeychain: mockListAccounts,
  invalidateKeychainListCache: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  encryptObject: vi.fn(),
  decryptObject: vi.fn(),
  getKeyFromKeychain: vi.fn(),
  storeKeyInKeychain: vi.fn(),
  ALGORITHM: "aes-256-gcm",
  IV_LENGTH: 12,
  AUTH_TAG_LENGTH: 16,
  KEY_LENGTH: 32,
}));

const {
  storeCredential,
  getCredential,
  deleteCredential,
  listCredentials,
} = await import("../src/vault/vault.js");

const {
  setSecretsPolicies,
  auditTrail,
} = await import("../src/vault/policy.js");

// =============================================================================
// Setup / teardown
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  setSecretsPolicies([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  setSecretsPolicies([]);
});

afterAll(() => {
  Object.defineProperty(process, "platform", { value: _originalPlatform, writable: true });
});

// =============================================================================
// after hooks — event emission
// =============================================================================

describe("policy after hooks", () => {
  it("emits credential_written on successful store", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockStoreString.mockReturnValue(true);

    await storeCredential("auth-token", "value");

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("credential_written");
    expect(events[0]!.key).toBe("auth-token");
    expect(events[0]!.backend).toBe("keychain");
    expect(typeof events[0]!.durationMs).toBe("number");
    expect(typeof events[0]!.timestamp).toBe("string");
  });

  it("emits credential_write_failed on failed store", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockStoreString.mockReturnValue(false);

    await storeCredential("auth-token", "value");

    expect(events[0]!.type).toBe("credential_write_failed");
  });

  it("emits credential_read on successful get", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockGetString.mockReturnValue("secret-value");

    await getCredential("auth-token");

    expect(events[0]!.type).toBe("credential_read");
    expect(events[0]!.key).toBe("auth-token");
  });

  it("emits credential_read_missing when key not found", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockGetString.mockReturnValue(null);

    await getCredential("auth-token");

    expect(events[0]!.type).toBe("credential_read_missing");
  });

  it("emits credential_read_failed when backend throws", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockGetString.mockImplementation(() => { throw new Error("keychain locked"); });

    await expect(getCredential("auth-token")).rejects.toThrow("keychain locked");
    expect(events[0]!.type).toBe("credential_read_failed");
    expect(events[0]!.error).toBe("keychain locked");
  });

  it("emits credential_deleted on successful delete", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockDelete.mockReturnValue(true);

    await deleteCredential("auth-token");

    expect(events[0]!.type).toBe("credential_deleted");
    expect(events[0]!.key).toBe("auth-token");
  });

  it("emits credential_enumerated on successful list", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockListAccounts.mockReturnValue(["auth-token", "refresh-token"]);

    await listCredentials();

    expect(events[0]!.type).toBe("credential_enumerated");
    expect(events[0]!.keyCount).toBe(2);
  });

  it("emits credential_enumerate_failed when list throws", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([{ name: "test", after: (e) => events.push(e) }]);
    mockListAccounts.mockImplementation(() => { throw new Error("access denied"); });

    await expect(listCredentials()).rejects.toThrow("access denied");
    expect(events[0]!.type).toBe("credential_enumerate_failed");
    expect(events[0]!.error).toBe("access denied");
  });
});

// =============================================================================
// before hooks — operation gating
// =============================================================================

describe("policy before hooks", () => {
  it("runs before hooks before the backend operation", async () => {
    const order: string[] = [];
    setSecretsPolicies([{
      name: "test",
      before: () => { order.push("before"); },
      after: () => { order.push("after"); },
    }]);
    mockGetString.mockImplementation(() => {
      order.push("backend");
      return "value";
    });

    await getCredential("auth-token");

    expect(order).toEqual(["before", "backend", "after"]);
  });

  it("supports async before hooks (Promise-returning)", async () => {
    const order: string[] = [];
    setSecretsPolicies([{
      name: "async-gate",
      async before() {
        await new Promise((r) => setTimeout(r, 1));
        order.push("async-before");
      },
      after: () => { order.push("after"); },
    }]);
    mockGetString.mockImplementation(() => {
      order.push("backend");
      return "value";
    });

    await getCredential("auth-token");

    expect(order).toEqual(["async-before", "backend", "after"]);
  });

  it("aborts the operation when a before hook throws", async () => {
    setSecretsPolicies([{
      name: "acl",
      before: () => { throw new Error("access denied by policy"); },
    }]);

    await expect(getCredential("auth-token")).rejects.toThrow("access denied by policy");
    expect(mockGetString).not.toHaveBeenCalled();
  });

  it("receives the correct operation descriptor", async () => {
    const ops: SecretsOperation[] = [];
    setSecretsPolicies([{
      name: "test",
      before: (op) => { ops.push({ ...op }); },
    }]);

    mockStoreString.mockReturnValue(true);
    mockGetString.mockReturnValue(null);
    mockDelete.mockReturnValue(true);
    mockListAccounts.mockReturnValue([]);

    await storeCredential("key1", "val");
    await getCredential("key2");
    await deleteCredential("key3");
    await listCredentials("prefix.");

    expect(ops).toEqual([
      { type: "write", key: "key1" },
      { type: "read", key: "key2" },
      { type: "delete", key: "key3" },
      { type: "enumerate", prefix: "prefix." },
    ]);
  });
});

// =============================================================================
// Multiple policies compose
// =============================================================================

describe("policy composition", () => {
  it("runs before hooks top-to-bottom and after hooks bottom-to-top", async () => {
    const order: string[] = [];
    setSecretsPolicies([
      { name: "a", before: () => { order.push("a-before"); }, after: () => { order.push("a-after"); } },
      { name: "b", before: () => { order.push("b-before"); }, after: () => { order.push("b-after"); } },
    ]);
    mockGetString.mockReturnValue("val");

    await getCredential("auth-token");

    expect(order).toEqual(["a-before", "b-before", "b-after", "a-after"]);
  });
});

// =============================================================================
// after hook exception handling
// =============================================================================

describe("after hook exception handling", () => {
  it("swallows exceptions from after hooks without breaking the operation", async () => {
    setSecretsPolicies([{
      name: "broken-auditor",
      after: () => { throw new Error("disk full"); },
    }]);
    mockGetString.mockReturnValue("secret");

    const result = await getCredential("auth-token");
    expect(result).toBe("secret");
  });

  it("emits a one-time warning to stderr on first after-hook failure", async () => {
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setSecretsPolicies([{
      name: "broken-auditor",
      after: () => { throw new Error("disk full"); },
    }]);
    mockGetString.mockReturnValue("val");
    mockStoreString.mockReturnValue(true);

    await getCredential("auth-token");
    await storeCredential("auth-token", "val");

    const warnings = stderrWrite.mock.calls.map(([msg]) => String(msg));
    const policyWarnings = warnings.filter((w) => w.includes("[secrets] policy"));
    expect(policyWarnings).toHaveLength(1);
    expect(policyWarnings[0]).toContain("broken-auditor");
    expect(policyWarnings[0]).toContain("disk full");

    stderrWrite.mockRestore();
  });
});

// =============================================================================
// auditTrail built-in policy
// =============================================================================

describe("auditTrail policy", () => {
  it("emits all events to the sink by default", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([auditTrail({ sink: (e) => events.push(e) })]);

    mockStoreString.mockReturnValue(true);
    mockGetString.mockReturnValue("val");
    mockDelete.mockReturnValue(true);
    mockListAccounts.mockReturnValue(["k1"]);

    await storeCredential("k1", "v1");
    await getCredential("k1");
    await deleteCredential("k1");
    await listCredentials();

    expect(events.map((e) => e.type)).toEqual([
      "credential_written",
      "credential_read",
      "credential_deleted",
      "credential_enumerated",
    ]);
  });

  it("excludes read events when includeReads=false", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([auditTrail({ sink: (e) => events.push(e), includeReads: false })]);

    mockStoreString.mockReturnValue(true);
    mockGetString.mockReturnValue("val");
    mockDelete.mockReturnValue(true);
    mockListAccounts.mockReturnValue(["k1"]);

    await storeCredential("k1", "v1");
    await getCredential("k1");
    await deleteCredential("k1");
    await listCredentials();

    expect(events.map((e) => e.type)).toEqual([
      "credential_written",
      "credential_deleted",
      "credential_enumerated",
    ]);
  });

  it("also excludes credential_read_missing when includeReads=false", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([auditTrail({ sink: (e) => events.push(e), includeReads: false })]);
    mockGetString.mockReturnValue(null);

    await getCredential("auth-token");

    expect(events).toHaveLength(0);
  });

  it("event objects have the correct shape", async () => {
    const events: SecretsEvent[] = [];
    setSecretsPolicies([auditTrail({ sink: (e) => events.push(e) })]);
    mockStoreString.mockReturnValue(true);

    await storeCredential("soma.anthropic.token1", "val");

    const event = events[0]!;
    expect(event.type).toBe("credential_written");
    expect(event.key).toBe("soma.anthropic.token1");
    expect(event.backend).toBe("keychain");
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.error).toBeUndefined();
    expect(event.keyCount).toBeUndefined();
    expect(event.prefix).toBeUndefined();
  });
});

// =============================================================================
// No-policy fast path
// =============================================================================

describe("no policies configured", () => {
  it("operations work normally with no policies installed", async () => {
    setSecretsPolicies([]);
    mockGetString.mockReturnValue("secret");

    const result = await getCredential("auth-token");
    expect(result).toBe("secret");
  });
});
