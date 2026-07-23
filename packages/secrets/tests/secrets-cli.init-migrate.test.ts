/**
 * secrets-cli — init and migrate subcommands
 *
 * Verifies the PR #67 CLI integration paths:
 *   1. init with a deriving provider (setupKey) bootstraps the vault under
 *      the derived key, opens the session, and zeroes the local key copy
 *   2. init surfaces the provider's getLastError() and writes nothing when
 *      setupKey fails
 *   3. init still uses the random-key storeKey branch for storing providers,
 *      including the failure path (error surfaced, key zeroed, no vault file)
 *   4. migrate accepts "passphrase" as a known provider but refuses it with
 *      the re-encryption follow-up message, before touching any provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockRealpathSync = vi.hoisted(() => vi.fn((p: string) => p));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    realpathSync: mockRealpathSync,
  };
});

const mockResolveKeyProvider = vi.hoisted(() => vi.fn());
const mockGetProviderByType = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn(() => ({ secrets: {} })));
const mockSaveSecretsConfig = vi.hoisted(() => vi.fn(() => true));

vi.mock("../src/key-providers/index.js", () => ({
  resolveKeyProvider: mockResolveKeyProvider,
  getProviderByType: mockGetProviderByType,
  loadConfig: mockLoadConfig,
  saveSecretsConfig: mockSaveSecretsConfig,
}));

const mockOpenVault = vi.hoisted(() => vi.fn());
const mockRekeyVault = vi.hoisted(() => vi.fn());
const MOCK_SIDECAR_PATH = "/tmp/secrets-cli-init-test-sidecar.json";

vi.mock("../src/vault/session-vault.js", () => ({
  openVault: mockOpenVault,
  rekeyVault: mockRekeyVault,
  VAULT_SCHEMA_VERSION: 1,
  VAULT_AAD_PREFIX: "centient-vault",
  DEFAULT_SIDECAR_PATH: MOCK_SIDECAR_PATH,
}));

const mockEncryptObject = vi.hoisted(() =>
  vi.fn(() => Buffer.from("encrypted-bootstrap")),
);

vi.mock("../src/crypto/vault-common.js", () => ({
  encryptObject: mockEncryptObject,
}));

vi.mock("../src/vault/vault.js", () => ({
  listCredentials: vi.fn(),
  getActiveVaultType: vi.fn(() => "keychain"),
  storeCredential: vi.fn(),
  getCredential: vi.fn(),
  deleteCredential: vi.fn(),
  isSessionValid: vi.fn(),
}));

const { runSecrets } = await import("../src/cli/secrets-cli.js");

// -----------------------------------------------------------------------------
// Env snapshot / restore (agent detection must not trip inside test runners)
// -----------------------------------------------------------------------------

const AGENT_VARS = [
  "CLAUDE_PROJECT_DIR",
  "MCP_CONTEXT",
  "CLAUDE_CODE_SESSION",
  "CLAUDE_CODE_ENTRY_POINT",
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const name of AGENT_VARS) {
  originalEnv[name] = process.env[name];
}

function clearAgentEnv(): void {
  for (const name of AGENT_VARS) {
    delete process.env[name];
  }
}

function restoreAgentEnv(): void {
  for (const name of AGENT_VARS) {
    const v = originalEnv[name];
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  }
}

// -----------------------------------------------------------------------------
// Helpers: capture stdout/stderr
// -----------------------------------------------------------------------------

interface Captured {
  stdout: string;
  stderr: string;
}

function capture(): { captured: Captured; restore: () => void } {
  const captured: Captured = { stdout: "", stderr: "" };

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origConsoleError = console.error;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.stdout += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  console.error = (...args: unknown[]) => {
    captured.stderr += args.map((a) => String(a)).join(" ") + "\n";
  };

  const restore = (): void => {
    process.stdout.write = origStdoutWrite;
    console.error = origConsoleError;
  };

  return { captured, restore };
}

interface FakeProviderOptions {
  setupKey?: (() => Buffer | null) | undefined;
  storeKey?: (key: Buffer) => boolean;
  getKey?: () => Buffer | null;
  deleteKey?: () => boolean;
  lastError?: { code: string; message: string } | null;
}

function fakeProvider(name: string, options: FakeProviderOptions = {}) {
  const provider: Record<string, unknown> = {
    name,
    getKey: vi.fn(options.getKey ?? (() => null)),
    storeKey: vi.fn(options.storeKey ?? (() => false)),
    deleteKey: vi.fn(options.deleteKey ?? (() => true)),
    getLastError: vi.fn(() => options.lastError ?? null),
  };
  if (options.setupKey) provider.setupKey = vi.fn(options.setupKey);
  return provider;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockRealpathSync.mockImplementation((p: string) => p);
  mockEncryptObject.mockReturnValue(Buffer.from("encrypted-bootstrap"));
  mockLoadConfig.mockReturnValue({ secrets: {} });
  mockSaveSecretsConfig.mockReturnValue(true);
  mockRekeyVault.mockImplementation(async (opts: { commit?: () => void }) => {
    await opts.commit?.();
    return {
      secretCount: 3,
      vaultVersion: 5,
      upgradedFromLegacy: false,
      sidecarPublished: true,
    };
  });
  mockOpenVault.mockResolvedValue({
    provider: "passphrase",
    path: "/resolved/vault.enc",
    vaultVersion: 1,
    close: vi.fn(),
    list: vi.fn(async () => []),
  });
  clearAgentEnv();
});

afterEach(() => {
  restoreAgentEnv();
});

// -----------------------------------------------------------------------------
// init — deriving provider (setupKey)
// -----------------------------------------------------------------------------

describe("runSecrets init with a deriving provider", () => {
  it("bootstraps the vault under the setupKey-derived key and zeroes the local copy", async () => {
    const derivedKey = Buffer.alloc(32, 7);
    const provider = fakeProvider("passphrase", {
      setupKey: () => derivedKey,
    });
    mockResolveKeyProvider.mockReturnValue({
      ok: true,
      provider,
      method: "auto",
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "init" });
    } finally {
      restore();
    }

    expect(provider.setupKey).toHaveBeenCalledOnce();
    // Deriving providers must NOT receive a random key via storeKey.
    expect(provider.storeKey).not.toHaveBeenCalled();

    // Bootstrap blob encrypted under the derived key (still live at encrypt
    // time), then written 0600, followed by the sidecar.
    expect(mockEncryptObject).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    const [vaultCall, sidecarCall] = mockWriteFileSync.mock.calls;
    expect(String(vaultCall[0])).toMatch(/vault\.enc$/);
    expect(vaultCall[2]).toEqual({ mode: 0o600 });
    expect(String(sidecarCall[0])).toBe(MOCK_SIDECAR_PATH);

    // Session auto-unlocked via the shared openVault path.
    expect(mockOpenVault).toHaveBeenCalledOnce();
    expect(captured.stdout).toContain("Vault initialized successfully");

    // The CLI's local key copy is zeroed in the finally block.
    expect(derivedKey.every((b) => b === 0)).toBe(true);
  });

  it("surfaces getLastError and writes nothing when setupKey fails", async () => {
    const provider = fakeProvider("passphrase", {
      setupKey: () => null,
      lastError: {
        code: "PASSPHRASE_MISMATCH",
        message: "Passphrases did not match; passphrase metadata was not written.",
      },
    });
    mockResolveKeyProvider.mockReturnValue({
      ok: true,
      provider,
      method: "auto",
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "init" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Failed to configure key via passphrase");
    expect(captured.stderr).toContain("Passphrases did not match");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockOpenVault).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// init — storing provider (storeKey branch unchanged)
// -----------------------------------------------------------------------------

describe("runSecrets init with a storing provider", () => {
  it("stores a random key via storeKey and bootstraps the vault", async () => {
    const provider = fakeProvider("keychain", { storeKey: () => true });
    mockResolveKeyProvider.mockReturnValue({
      ok: true,
      provider,
      method: "auto",
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "init" });
    } finally {
      restore();
    }

    expect(provider.storeKey).toHaveBeenCalledOnce();
    const storedKey = (provider.storeKey as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Buffer;
    expect(storedKey.length).toBe(32);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(captured.stdout).toContain("Vault initialized successfully");
    // Local copy zeroed after openVault fetched its own.
    expect(storedKey.every((b) => b === 0)).toBe(true);
  });

  it("surfaces getLastError, zeroes the key, and writes nothing when storeKey fails", async () => {
    const provider = fakeProvider("keychain", {
      storeKey: () => false,
      lastError: { code: "KEYCHAIN_DENIED", message: "keychain access denied" },
    });
    mockResolveKeyProvider.mockReturnValue({
      ok: true,
      provider,
      method: "auto",
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "init" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Failed to store key via keychain");
    expect(captured.stderr).toContain("keychain access denied");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockOpenVault).not.toHaveBeenCalled();

    const attemptedKey = (provider.storeKey as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Buffer;
    expect(attemptedKey.every((b) => b === 0)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// migrate — passphrase target (issue #122 / ADR-001 Amendment 1)
// -----------------------------------------------------------------------------

/**
 * Wire up a keychain → passphrase migration. Returns both providers so tests
 * can assert on which methods the CLI reached for.
 */
function stagePassphraseMigration(
  overrides: {
    currentKey?: Buffer;
    setupKey?: (() => Buffer | null) | undefined;
    deleteKey?: () => boolean;
    targetLastError?: { code: string; message: string } | null;
    targetAvailable?: boolean;
  } = {},
) {
  const currentKey = overrides.currentKey ?? Buffer.alloc(32, 1);
  const derivedKey = Buffer.alloc(32, 2);
  const source = fakeProvider("keychain", { getKey: () => currentKey });
  const target = fakeProvider("passphrase", {
    setupKey: overrides.setupKey ?? (() => derivedKey),
    ...(overrides.deleteKey ? { deleteKey: overrides.deleteKey } : {}),
    ...(overrides.targetLastError !== undefined
      ? { lastError: overrides.targetLastError }
      : {}),
  });
  mockResolveKeyProvider.mockReturnValue({ ok: true, provider: source, method: "config" });
  mockGetProviderByType.mockReturnValue(
    overrides.targetAvailable === false ? null : target,
  );
  // The vault file must exist for a rekey to be possible.
  mockExistsSync.mockReturnValue(true);
  return { source, target, currentKey, derivedKey };
}

describe("runSecrets migrate passphrase", () => {
  it("routes through setupKey and rekeys the vault, committing the config inside the rekey", async () => {
    const { source, target, currentKey, derivedKey } = stagePassphraseMigration();

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    // ADR-001 Amendment 1: the passphrase route is setupKey(), never storeKey().
    expect(target.setupKey).toHaveBeenCalledOnce();
    expect(target.storeKey).not.toHaveBeenCalled();

    expect(mockRekeyVault).toHaveBeenCalledOnce();
    const rekeyArgs = mockRekeyVault.mock.calls[0][0] as {
      currentKey: Buffer;
      nextKey: Buffer;
      commit: () => void;
    };
    // Keys are handed over live and zeroed only after the rekey returns; the
    // mock captured the buffers, so compare against copies taken at stage time.
    expect(rekeyArgs.currentKey).toBe(currentKey);
    expect(rekeyArgs.nextKey).toBe(derivedKey);
    expect(typeof rekeyArgs.commit).toBe("function");

    // The config write is the rekey's commit step, not a separate later call.
    expect(mockSaveSecretsConfig).toHaveBeenCalledWith({ provider: "passphrase" });

    expect(captured.stdout).toContain('Provider set to "passphrase"');
    expect(captured.stdout).toContain("3 secrets");
    expect(captured.stdout).toContain("version 5");
    expect(captured.stdout).toContain("no longer opens this vault");
    expect(captured.stderr).toBe("");

    // Both key copies zeroed once the migration finished.
    expect(currentKey.every((b) => b === 0)).toBe(true);
    expect(derivedKey.every((b) => b === 0)).toBe(true);
    expect(source.getKey).toHaveBeenCalledOnce();
  });

  it("reports the legacy upgrade when the rekey upgraded an AAD-less vault", async () => {
    stagePassphraseMigration();
    mockRekeyVault.mockImplementation(async (opts: { commit?: () => void }) => {
      await opts.commit?.();
      return { secretCount: 1, vaultVersion: 1, upgradedFromLegacy: true };
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stdout).toContain("1 secret,");
    expect(captured.stdout).toContain("upgraded to schema 1");
  });

  it("leaves the vault untouched and surfaces the provider error when setupKey fails", async () => {
    const { target } = stagePassphraseMigration({
      setupKey: () => null,
      targetLastError: { code: "PASSPHRASE_MISMATCH", message: "Passphrases did not match" },
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Failed to derive a passphrase key");
    expect(captured.stderr).toContain("Passphrases did not match");
    expect(mockRekeyVault).not.toHaveBeenCalled();
    expect(mockSaveSecretsConfig).not.toHaveBeenCalled();
    // Nothing was written, so there is no metadata to clean up.
    expect(target.deleteKey).not.toHaveBeenCalled();
  });

  it("KEEPS the passphrase metadata when a failure lands after the config commit", async () => {
    // The unrecoverable case: the config already says "passphrase" and the
    // vault is encrypted under the derived key, so deleting the metadata
    // would destroy the salt and brick the vault. rekeyVault promises not to
    // throw past a successful commit; this asserts the CLI does not depend on
    // that promise holding.
    const { target } = stagePassphraseMigration();
    mockRekeyVault.mockImplementation(async (opts: { commit?: () => void }) => {
      await opts.commit?.();
      throw new Error("sidecar publish failed");
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(mockSaveSecretsConfig).toHaveBeenCalledWith({ provider: "passphrase" });
    expect(target.deleteKey).not.toHaveBeenCalled();
    expect(captured.stderr).toContain("metadata has been KEPT");
    expect(captured.stderr).toContain("already updated");
    // Must not claim the vault is still under the original key — it isn't.
    expect(captured.stderr).not.toContain("left under the original key");
  });

  it("warns when the migration succeeded but the sidecar bump did not land", async () => {
    stagePassphraseMigration();
    mockRekeyVault.mockImplementation(async (opts: { commit?: () => void }) => {
      await opts.commit?.();
      return {
        secretCount: 2,
        vaultVersion: 7,
        upgradedFromLegacy: false,
        sidecarPublished: false,
      };
    });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    // Succeeded, but the degradation is surfaced rather than swallowed.
    expect(captured.stdout).toContain("Migration complete");
    expect(captured.stderr).toContain("rollback-protection sidecar");
    expect(captured.stderr).toContain("migration itself succeeded");
  });

  it("removes the passphrase metadata when the rekey itself fails", async () => {
    const { target } = stagePassphraseMigration();
    mockRekeyVault.mockRejectedValue(new Error("wrong key, corrupted file, or AAD mismatch"));

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Re-encryption failed");
    expect(captured.stderr).toContain("left under the original key");
    expect(target.deleteKey).toHaveBeenCalledOnce();
    expect(captured.stdout).not.toContain("Migration complete");
  });

  it("reports the restore and clears metadata when the config commit fails", async () => {
    const { target } = stagePassphraseMigration();
    mockSaveSecretsConfig.mockReturnValue(false);

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Could not update");
    expect(captured.stderr).toContain("vault restored under the original key");
    // The failure is attributed to the config write, not misreported as a
    // generic re-encryption error.
    expect(captured.stderr).not.toContain("Re-encryption failed");
    expect(target.deleteKey).toHaveBeenCalledOnce();
    expect(captured.stdout).not.toContain("Migration complete");
  });

  it("surfaces a missing vault before prompting for a passphrase", async () => {
    const { target } = stagePassphraseMigration();
    mockExistsSync.mockReturnValue(false);

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain("Vault not found");
    expect(target.setupKey).not.toHaveBeenCalled();
    expect(mockRekeyVault).not.toHaveBeenCalled();
  });

  it("explains the TTY requirement when the passphrase provider is unavailable", async () => {
    const { currentKey } = stagePassphraseMigration({ targetAvailable: false });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain('Provider "passphrase" is not available');
    expect(captured.stderr).toContain("interactive terminal");
    expect(mockRekeyVault).not.toHaveBeenCalled();
    // The key read from the source is zeroed on this early-return path too.
    expect(currentKey.every((b) => b === 0)).toBe(true);
  });

  it("short-circuits when passphrase is already the active provider", async () => {
    const source = fakeProvider("passphrase", { getKey: () => Buffer.alloc(32, 1) });
    mockResolveKeyProvider.mockReturnValue({ ok: true, provider: source, method: "config" });

    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "passphrase" });
    } finally {
      restore();
    }

    expect(captured.stdout).toContain("Already using passphrase");
    expect(source.getKey).not.toHaveBeenCalled();
    expect(mockRekeyVault).not.toHaveBeenCalled();
  });

  it("still rejects genuinely unknown providers", async () => {
    const { captured, restore } = capture();
    try {
      await runSecrets({ command: "migrate", secretName: "gpg-card" });
    } finally {
      restore();
    }

    expect(captured.stderr).toContain('Unknown provider "gpg-card"');
    expect(mockResolveKeyProvider).not.toHaveBeenCalled();
  });
});
