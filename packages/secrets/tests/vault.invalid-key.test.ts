/**
 * Cascade key enforcement (#168)
 *
 * The key grammar was documented on `listCredentials` and enforced nowhere on
 * the shared path. `KeychainVault` (cascade position 1) and `EnvVault`
 * (position 5) accepted anything, so a non-conforming key stored fine on macOS
 * and was unreadable on every other backend.
 *
 * These tests pin the two properties that closes:
 *   1. every public cascade function refuses a non-conforming key, and the
 *      backend is never contacted — nothing is half-written;
 *   2. the refusal is DISTINGUISHABLE from "not found" / "write failed", which
 *      is what the previous `return null` / `return false` shape was not.
 *
 * The backend is mocked at `vault-common`, and the platform is forced to
 * darwin so `KeychainVault` — the non-enforcing position-1 backend that made
 * the gap reachable — is the one under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

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

// Import AFTER mocking
import {
  storeCredential,
  getCredential,
  deleteCredential,
  listCredentials,
} from "../src/vault/vault.js";
import { InvalidCredentialKeyError, VaultError } from "../src/vault/session-vault-errors.js";
import { setSecretsPolicies } from "../src/vault/policy.js";
import type { SecretsEvent, SecretsPolicy } from "../src/vault/policy.js";

/**
 * Keys the grammar rejects. Every one of these stores successfully on a Mac
 * today and is unaddressable on GPG / libsecret / Windows / 1Password — the
 * asymmetry being closed. `Auth_Token` is the shape the survey called out as
 * actually reachable: an operator typo through `centient secrets set`.
 */
const INVALID_KEYS = [
  "Auth_Token",
  "auth token",
  "service/api-key",
  "auth-",
  ".auth",
  "auth$token",
  "a",
  "",
  "x".repeat(65),
];

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
// The write path — one test per public function
// =============================================================================

describe("storeCredential — rejects a non-conforming key", () => {
  it.each(INVALID_KEYS)("refuses %j and never writes", async (key) => {
    mockStoreString.mockReturnValue(true);
    await expect(storeCredential(key, "eng_abc123")).rejects.toBeInstanceOf(
      InvalidCredentialKeyError,
    );
    // The decisive part: the backend was never asked to store anything.
    expect(mockStoreString).not.toHaveBeenCalled();
  });

  it("never puts the credential VALUE in the error", async () => {
    const CANARY = "canary-value-must-not-appear-in-the-error";
    const err = await storeCredential("Bad_Key", CANARY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidCredentialKeyError);
    expect((err as Error).message).not.toContain(CANARY);
    expect((err as Error).stack ?? "").not.toContain(CANARY);
  });
});

describe("getCredential — rejects a non-conforming key", () => {
  it.each(INVALID_KEYS)("refuses %j and never reads", async (key) => {
    mockGetString.mockReturnValue("some-token");
    await expect(getCredential(key)).rejects.toBeInstanceOf(InvalidCredentialKeyError);
    expect(mockGetString).not.toHaveBeenCalled();
  });
});

describe("deleteCredential — rejects a non-conforming key", () => {
  it.each(INVALID_KEYS)("refuses %j and never deletes", async (key) => {
    mockDelete.mockReturnValue(true);
    await expect(deleteCredential(key)).rejects.toBeInstanceOf(InvalidCredentialKeyError);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("listCredentials — rejects a prefix no valid key could start with", () => {
  it.each([
    "Auth_",
    "soma anthropic",
    "service/",
    ".soma",
    "-soma",
    "soma$",
    "x".repeat(65),
  ])("refuses prefix %j and never enumerates", async (prefix) => {
    mockListAccounts.mockReturnValue(["auth-token"]);
    await expect(listCredentials(prefix)).rejects.toBeInstanceOf(
      InvalidCredentialKeyError,
    );
    expect(mockListAccounts).not.toHaveBeenCalled();
  });

  it("still accepts a prefix ending on a separator — the documented usage", async () => {
    // "soma.anthropic." is not a valid KEY (it ends on a separator) but is the
    // intended way to scope an enumeration to a namespace. Validating the
    // prefix with isValidKey would have broken the documented example.
    mockListAccounts.mockReturnValue(["soma.anthropic.token1"]);
    await expect(listCredentials("soma.anthropic.")).resolves.toEqual([
      "soma.anthropic.token1",
    ]);
    expect(mockListAccounts).toHaveBeenCalledWith("centient-auth", "soma.anthropic.");
  });

  it("accepts an empty prefix and no prefix alike", async () => {
    mockListAccounts.mockReturnValue(["auth-token"]);
    await expect(listCredentials("")).resolves.toEqual(["auth-token"]);
    await expect(listCredentials()).resolves.toEqual(["auth-token"]);
  });
});

// =============================================================================
// Distinguishability — the P2 half (#168 defect 2)
// =============================================================================

describe("an invalid key is distinguishable from a genuine miss", () => {
  it("returns null for a VALID key that is absent, but throws for a malformed one", async () => {
    mockGetString.mockReturnValue(null);

    // Confirmed absence: the backend was consulted and had nothing.
    await expect(getCredential("auth-token")).resolves.toBeNull();
    expect(mockGetString).toHaveBeenCalledWith("centient-auth", "auth-token");

    // Malformed: not an absence claim at all. Before #168 this path returned
    // null on the enforcing backends — the same value as "not found".
    mockGetString.mockClear();
    await expect(getCredential("Auth_Token")).rejects.toBeInstanceOf(
      InvalidCredentialKeyError,
    );
    expect(mockGetString).not.toHaveBeenCalled();
  });

  it("carries a machine-readable code, the key, the operation and the reason", async () => {
    const err = await getCredential("Auth_Token").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidCredentialKeyError);
    expect(err).toBeInstanceOf(VaultError);
    expect(err).toBeInstanceOf(Error);

    const typed = err as InvalidCredentialKeyError;
    expect(typed.code).toBe("VAULT_INVALID_CREDENTIAL_KEY");
    expect(typed.name).toBe("InvalidCredentialKeyError");
    expect(typed.key).toBe("Auth_Token");
    expect(typed.operation).toBe("read");
    expect(typed.kind).toBe("key");
    expect(typed.message).toContain('"Auth_Token"');
    expect(typed.message).toContain("read");
  });

  it("reports the operation that was refused, per function", async () => {
    const ops = await Promise.all([
      storeCredential("Bad_Key", "v").catch((e: InvalidCredentialKeyError) => e.operation),
      getCredential("Bad_Key").catch((e: InvalidCredentialKeyError) => e.operation),
      deleteCredential("Bad_Key").catch((e: InvalidCredentialKeyError) => e.operation),
      listCredentials("Bad_").catch((e: InvalidCredentialKeyError) => e.operation),
    ]);
    expect(ops).toEqual(["write", "read", "delete", "enumerate"]);
  });

  it("does not report a malformed delete as idempotent success", async () => {
    mockDelete.mockReturnValue(true);
    // "Missing" and "impossible" are different answers — a key that was never
    // storable cannot honestly be reported as already deleted.
    await expect(deleteCredential("Bad_Key")).rejects.toBeInstanceOf(
      InvalidCredentialKeyError,
    );
  });
});

// =============================================================================
// Audit trail — a refused operation stays visible
// =============================================================================

describe("key rejection is audited", () => {
  function recorder(): { events: SecretsEvent[]; policy: SecretsPolicy } {
    const events: SecretsEvent[] = [];
    return {
      events,
      policy: {
        name: "recorder",
        after(event) {
          events.push(event);
        },
      },
    };
  }

  it("emits the same *_rejected events a policy denial produces", async () => {
    const { events, policy } = recorder();
    setSecretsPolicies([policy]);

    await storeCredential("Bad_Key", "v").catch(() => undefined);
    await getCredential("Bad_Key").catch(() => undefined);
    await deleteCredential("Bad_Key").catch(() => undefined);
    await listCredentials("Bad_").catch(() => undefined);

    expect(events.map((e) => e.type)).toEqual([
      "credential_write_rejected",
      "credential_read_rejected",
      "credential_delete_rejected",
      "credential_enumerate_rejected",
    ]);
    expect(events[0]?.key).toBe("Bad_Key");
    expect(events[3]?.prefix).toBe("Bad_");
    for (const event of events) {
      expect(event.error).toContain("key grammar");
      expect(event.backend).toBe("keychain");
    }
  });

  it("rejects before the policy `before` hooks run", async () => {
    // A malformed key is a caller-contract violation, not a policy decision:
    // an access-control hook should never be handed a key the storage layer
    // has already ruled out.
    const seen: string[] = [];
    setSecretsPolicies([
      {
        name: "spy",
        before(op) {
          seen.push(op.type);
        },
      },
    ]);

    await storeCredential("Bad_Key", "v").catch(() => undefined);
    expect(seen).toEqual([]);

    mockStoreString.mockReturnValue(true);
    await storeCredential("good-key", "v");
    expect(seen).toEqual(["write"]);
  });
});

// =============================================================================
// Conforming keys are untouched
// =============================================================================

describe("conforming keys pass through unchanged", () => {
  // The survey's finding: all four documented in-use keys (mbot's `maintainer.*`
  // set) already conform, so no documented consumer breaks.
  const VALID_KEYS = [
    "auth-token",
    "refresh-token",
    "maintainer.anthropic-oauth-token",
    "maintainer.github-app-private-key",
    "maintainer.ghpr-pat",
    "maintainer.registry-token",
    "soma.anthropic.token1",
    "a1",
  ];

  it.each(VALID_KEYS)("stores, reads and deletes %s", async (key) => {
    mockStoreString.mockReturnValue(true);
    mockGetString.mockReturnValue("value");
    mockDelete.mockReturnValue(true);

    await expect(storeCredential(key, "value")).resolves.toBe(true);
    await expect(getCredential(key)).resolves.toBe("value");
    await expect(deleteCredential(key)).resolves.toBe(true);

    expect(mockStoreString).toHaveBeenCalledWith("centient-auth", key, "value");
    expect(mockGetString).toHaveBeenCalledWith("centient-auth", key);
    expect(mockDelete).toHaveBeenCalledWith("centient-auth", key);
  });

  it("still reports an ordinary backend write failure as false, not a throw", async () => {
    mockStoreString.mockReturnValue(false);
    await expect(storeCredential("auth-token", "v")).resolves.toBe(false);
  });
});
