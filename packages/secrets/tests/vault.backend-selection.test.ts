/**
 * Credential-backend selection seam (ADR-004 §1).
 *
 * `vault.ts` picks its backend once at module load, so each case re-imports the
 * module with fresh mocks via `vi.resetModules()`.
 *
 * The property under test is that an **explicit** backend choice is never
 * silently substituted. Falling through to the auto-cascade when the named
 * backend is unusable would store credentials somewhere other than where the
 * operator said — the exact surprise the opt-in model exists to prevent (P2).
 * The mirror property matters just as much: 1Password must never be reachable
 * from the auto-cascade, so having `op` installed is not consent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["CENTIENT_SECRETS_BACKEND", "CENTIENT_OP_VAULT"] as const;
const savedEnv: Record<string, string | undefined> = {};

/**
 * Load a fresh copy of vault.ts with the config + op availability mocked.
 * Returns the module, or the error module init threw (the fail-closed cases).
 */
async function loadVault(opts: {
  config?: Record<string, unknown>;
  opAvailable?: boolean;
  platform?: string;
}): Promise<{ mod?: typeof import("../src/vault/vault.js"); err?: Error }> {
  vi.resetModules();

  vi.doMock("../src/key-providers/resolve.js", () => ({
    loadConfig: () => ({ secrets: opts.config ?? {} }),
    resolveKeyProvider: vi.fn(),
    getProviderByType: vi.fn(),
    saveSecretsConfig: vi.fn(() => true),
  }));

  vi.doMock("../src/key-providers/op-cli.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/key-providers/op-cli.js")>();
    return { ...actual, detectOpCli: () => opts.opAvailable ?? true, runOp: vi.fn(() => "") };
  });

  const platform = opts.platform ?? "linux";
  const spy = vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform);
  try {
    const mod = await import("../src/vault/vault.js");
    return { mod };
  } catch (err) {
    return { err: err as Error };
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.doUnmock("../src/key-providers/resolve.js");
  vi.doUnmock("../src/key-providers/op-cli.js");
  vi.resetModules();
});

describe("backend selection — auto-cascade (unchanged)", () => {
  it("selects keychain on darwin when nothing is explicitly configured", async () => {
    const { mod, err } = await loadVault({ platform: "darwin" });
    expect(err).toBeUndefined();
    expect(mod!.getActiveVaultType()).toBe("keychain");
  });

  it("NEVER auto-selects 1password, even with op fully available", async () => {
    // The whole point of §1: `op` on the machine is not consent to route
    // credentials into someone's personal vault.
    const { mod, err } = await loadVault({
      opAvailable: true,
      config: { onePasswordBackend: { vault: "centient-credentials" } },
      platform: "darwin",
    });
    expect(err).toBeUndefined();
    expect(mod!.getActiveVaultType()).not.toBe("1password");
    expect(mod!.getActiveVaultType()).toBe("keychain");
  });
});

describe("backend selection — explicit opt-in", () => {
  it("selects 1password from config when op is available", async () => {
    const { mod, err } = await loadVault({
      config: { backend: "1password", onePasswordBackend: { vault: "centient-credentials" } },
      opAvailable: true,
      platform: "darwin",
    });
    expect(err).toBeUndefined();
    expect(mod!.getActiveVaultType()).toBe("1password");
  });

  it("selects 1password from env, which overrides config", async () => {
    process.env.CENTIENT_SECRETS_BACKEND = "1password";
    process.env.CENTIENT_OP_VAULT = "env-vault";
    const { mod, err } = await loadVault({ config: {}, opAvailable: true, platform: "darwin" });
    expect(err).toBeUndefined();
    expect(mod!.getActiveVaultType()).toBe("1password");
  });

  it("env vault name wins over the config vault name", async () => {
    process.env.CENTIENT_OP_VAULT = "env-wins";
    const { mod, err } = await loadVault({
      config: { backend: "1password", onePasswordBackend: { vault: "config-loses" } },
      opAvailable: true,
    });
    expect(err).toBeUndefined();
    expect(mod!.getActiveVaultType()).toBe("1password");
  });
});

describe("backend selection — fails closed, never substitutes", () => {
  it("throws rather than falling back when the vault name is missing", async () => {
    const { mod, err } = await loadVault({
      config: { backend: "1password" }, // no onePasswordBackend.vault
      opAvailable: true,
      platform: "darwin",
    });
    expect(mod).toBeUndefined();
    expect(err?.message).toMatch(/vault is required/i);
    // Critically: it did NOT quietly become keychain.
  });

  it("throws rather than falling back when op is unavailable", async () => {
    const { mod, err } = await loadVault({
      config: { backend: "1password", onePasswordBackend: { vault: "centient-credentials" } },
      opAvailable: false,
      platform: "darwin",
    });
    expect(mod).toBeUndefined();
    expect(err?.message).toMatch(/unavailable or not authenticated/i);
    expect(err?.message).toMatch(/never silently substituted/i);
  });

  it("rejects an unknown explicit backend name", async () => {
    process.env.CENTIENT_SECRETS_BACKEND = "hashicorp";
    const { mod, err } = await loadVault({ config: {}, platform: "darwin" });
    expect(mod).toBeUndefined();
    expect(err?.message).toMatch(/Unknown secrets backend "hashicorp"/);
  });
});
