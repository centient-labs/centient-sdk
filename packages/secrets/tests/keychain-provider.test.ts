/**
 * KeychainProvider — per-consumer key tests (issue #80).
 *
 * Verifies:
 *   - Default construction targets the historical centient-vault/vault-key
 *     item (existing vaults keep opening — default-unchanged guarantee).
 *   - Constructor options name a per-consumer Keychain item so each consumer
 *     can encrypt with its own master key.
 *   - resolveKeyProvider threads `keychain` coordinates through to the
 *     KeychainProvider it constructs, and the default resolution still targets
 *     the historical item.
 *
 * The underlying `security` CLI wrappers in vault-common.ts are mocked so the
 * tests assert which (service, account) pair the provider reaches for, without
 * touching the real macOS Keychain.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the keychain CLI wrappers so we can assert the (service, account) args.
const getKeyMock = vi.fn<(service: string, account: string) => Buffer | null>();
const storeKeyMock = vi.fn<(service: string, account: string, key: Buffer) => boolean>();
const deleteMock = vi.fn<(service: string, account: string) => boolean>();

vi.mock("../src/crypto/vault-common.js", () => ({
  getKeyFromKeychain: (service: string, account: string) => getKeyMock(service, account),
  storeKeyInKeychain: (service: string, account: string, key: Buffer) =>
    storeKeyMock(service, account, key),
  deleteFromKeychain: (service: string, account: string) => deleteMock(service, account),
}));

import {
  KeychainProvider,
  DEFAULT_KEYCHAIN_SERVICE,
  DEFAULT_KEYCHAIN_ACCOUNT,
} from "../src/key-providers/keychain-provider.js";
import { resolveKeyProvider, getProviderByType } from "../src/key-providers/resolve.js";

// Stub config loading so resolution is deterministic regardless of the host's
// ~/.centient/config.json.
vi.mock("../src/key-providers/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/key-providers/resolve.js")>();
  return { ...actual, loadConfig: () => ({ secrets: { provider: "keychain" } }) };
});

const masterKeyBytes = Buffer.alloc(32, 7);

beforeEach(() => {
  getKeyMock.mockReset();
  storeKeyMock.mockReset();
  deleteMock.mockReset();
  getKeyMock.mockReturnValue(masterKeyBytes);
  storeKeyMock.mockReturnValue(true);
  deleteMock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KeychainProvider — default coordinates (default-unchanged)", () => {
  it("targets centient-vault/vault-key with no options", () => {
    const provider = new KeychainProvider();
    provider.getKey();
    provider.storeKey(masterKeyBytes);
    provider.deleteKey();

    expect(getKeyMock).toHaveBeenCalledWith("centient-vault", "vault-key");
    expect(storeKeyMock).toHaveBeenCalledWith("centient-vault", "vault-key", masterKeyBytes);
    expect(deleteMock).toHaveBeenCalledWith("centient-vault", "vault-key");
  });

  it("exposes the historical defaults as named constants", () => {
    expect(DEFAULT_KEYCHAIN_SERVICE).toBe("centient-vault");
    expect(DEFAULT_KEYCHAIN_ACCOUNT).toBe("vault-key");
  });

  it("empty options object is identical to no options", () => {
    new KeychainProvider({}).getKey();
    expect(getKeyMock).toHaveBeenCalledWith("centient-vault", "vault-key");
  });
});

describe("KeychainProvider — per-consumer naming", () => {
  it("targets the named Keychain item from constructor options", () => {
    const provider = new KeychainProvider({ service: "foo-vault", account: "k" });
    provider.getKey();
    provider.storeKey(masterKeyBytes);
    provider.deleteKey();

    expect(getKeyMock).toHaveBeenCalledWith("foo-vault", "k");
    expect(storeKeyMock).toHaveBeenCalledWith("foo-vault", "k", masterKeyBytes);
    expect(deleteMock).toHaveBeenCalledWith("foo-vault", "k");
  });

  it("falls back to default account when only service is named", () => {
    new KeychainProvider({ service: "burnrate-vault" }).getKey();
    expect(getKeyMock).toHaveBeenCalledWith("burnrate-vault", DEFAULT_KEYCHAIN_ACCOUNT);
  });

  it("falls back to default service when only account is named", () => {
    new KeychainProvider({ account: "alt-key" }).getKey();
    expect(getKeyMock).toHaveBeenCalledWith(DEFAULT_KEYCHAIN_SERVICE, "alt-key");
  });
});

// Resolution only constructs a real KeychainProvider on macOS (detect() gate).
const onMac = process.platform === "darwin";
const describeMac = onMac ? describe : describe.skip;

describeMac("resolveKeyProvider — threads keychain coordinates (macOS)", () => {
  it("default resolution targets centient-vault/vault-key", () => {
    const result = resolveKeyProvider({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.provider.getKey();
    expect(getKeyMock).toHaveBeenCalledWith("centient-vault", "vault-key");
  });

  it("passes per-consumer keychain coordinates to the provider", () => {
    const result = resolveKeyProvider({ keychain: { service: "burnrate-vault", account: "k" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.provider.getKey();
    expect(getKeyMock).toHaveBeenCalledWith("burnrate-vault", "k");
  });

  it("getProviderByType also threads keychain coordinates", () => {
    const provider = getProviderByType("keychain", undefined, {
      keychain: { service: "other-vault" },
    });
    expect(provider).not.toBeNull();
    provider?.getKey();
    expect(getKeyMock).toHaveBeenCalledWith("other-vault", DEFAULT_KEYCHAIN_ACCOUNT);
  });
});
