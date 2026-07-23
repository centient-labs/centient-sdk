/**
 * rekeyVault — integration tests.
 *
 * Exercises the re-encrypt-under-a-new-key path against real filesystem
 * operations in a per-test temp directory. This is the primitive behind
 * `centient secrets migrate passphrase` (issue #122 / ADR-001 Amendment 1):
 * a passphrase provider derives its key and cannot store a caller-supplied
 * one, so migrating to it means rewriting the ciphertext.
 *
 * Covers:
 *   - round trip: old key stops working, new key opens the same secrets
 *   - version bump stays above the sidecar high-water mark
 *   - legacy AAD-less flat vaults are upgraded to schema 1 in the same step
 *   - a throwing `commit` restores the prior ciphertext byte-for-byte and
 *     leaves the sidecar unmoved (the half-migrated state this exists to stop)
 *   - rollback / missing-sidecar refusal, matching openVault's invariant
 *   - wrong current key / missing vault fail loudly and change nothing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as pathMod from "path";
import { randomBytes, createHash } from "crypto";

// The resolver is never reached by rekeyVault (keys are passed in), but
// session-vault imports it at module load; mock it so nothing touches the OS
// keychain when openVault is used to verify the result.
const TEST_KEY = randomBytes(32);
const NEW_KEY = randomBytes(32);

const mockState: { key: Buffer } = { key: Buffer.from(TEST_KEY) };

vi.mock("../src/key-providers/resolve.js", () => ({
  resolveKeyProvider: () => ({
    ok: true,
    provider: {
      name: "keychain",
      getKey: () => Buffer.from(mockState.key),
      storeKey: () => true,
    },
  }),
}));

import {
  openVault,
  rekeyVault,
  VAULT_SCHEMA_VERSION,
  VaultDecryptError,
  VaultError,
  VaultRollbackError,
} from "../src/vault/session-vault.js";
import { encryptObject, decryptObject } from "../src/crypto/vault-common.js";

// =============================================================================
// Test harness
// =============================================================================

let tmpDir: string;
let vaultPath: string;
let sidecarPath: string;

function makeAad(path: string, schema: number = VAULT_SCHEMA_VERSION): Buffer {
  // Mirror production AAD derivation, which binds the vault's realpath (macOS
  // tmpdir is a symlink, so the fixture must resolve it too).
  const parent = realpathSync(pathMod.dirname(path));
  const resolved = `${parent}/${pathMod.basename(path)}`;
  return createHash("sha256")
    .update(`centient-secrets-vault:v${schema}:${resolved}`)
    .digest();
}

function seedVault(
  path: string,
  secrets: Record<string, string>,
  vaultVersion: number,
  key: Buffer = TEST_KEY,
): void {
  const payload = { schema: VAULT_SCHEMA_VERSION, vaultVersion, secrets };
  const encrypted = encryptObject(
    payload as unknown as Record<string, unknown>,
    Buffer.from(key),
    makeAad(path),
  );
  if (!encrypted) throw new Error("test setup: encryption failed");
  writeFileSync(path, encrypted, { mode: 0o600 });
}

/** Seed a pre-openVault CLI vault: flat `{name: value}`, no AAD, no schema. */
function seedLegacyVault(path: string, secrets: Record<string, string>): void {
  const encrypted = encryptObject(secrets, Buffer.from(TEST_KEY));
  if (!encrypted) throw new Error("test setup: encryption failed");
  writeFileSync(path, encrypted, { mode: 0o600 });
}

function seedSidecar(path: string, highestSeenVersion: number): void {
  writeFileSync(path, JSON.stringify({ highestSeenVersion }), { mode: 0o600 });
}

function readSidecarVersion(path: string): number | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")).highestSeenVersion as number;
}

/** Decrypt the vault file directly, bypassing openVault's sidecar checks. */
function decryptVault(path: string, key: Buffer): Record<string, unknown> | null {
  return decryptObject(readFileSync(path), Buffer.from(key), makeAad(path));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-vault-rekey-test-"));
  vaultPath = join(tmpDir, "vault.enc");
  sidecarPath = join(tmpDir, "vault.seen-version");
  mockState.key = Buffer.from(TEST_KEY);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Round trip
// =============================================================================

describe("rekeyVault — round trip", () => {
  it("re-encrypts under the new key and stops accepting the old one", async () => {
    seedVault(vaultPath, { "api-key": "secret-value", other: "2" }, 3);
    seedSidecar(sidecarPath, 3);

    const result = await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
    });

    expect(result).toEqual({
      secretCount: 2,
      vaultVersion: 4,
      upgradedFromLegacy: false,
    });

    // New key opens it; the payload survived intact.
    const decoded = decryptVault(vaultPath, NEW_KEY);
    expect(decoded).not.toBeNull();
    expect(decoded).toMatchObject({
      schema: VAULT_SCHEMA_VERSION,
      vaultVersion: 4,
      secrets: { "api-key": "secret-value", other: "2" },
    });

    // Old key no longer does — that is the point of a rekey.
    expect(decryptVault(vaultPath, TEST_KEY)).toBeNull();

    // Sidecar advanced to match, so the next open is clean.
    expect(readSidecarVersion(sidecarPath)).toBe(4);

    mockState.key = Buffer.from(NEW_KEY);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("api-key")).toBe("secret-value");
    expect(vault.vaultVersion).toBe(4);
    vault.close();
  });

  it("does not zero the caller's key buffers", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);

    const currentKey = Buffer.from(TEST_KEY);
    const nextKey = Buffer.from(NEW_KEY);
    await rekeyVault({ path: vaultPath, sidecarPath, currentKey, nextKey });

    expect(currentKey.equals(TEST_KEY)).toBe(true);
    expect(nextKey.equals(NEW_KEY)).toBe(true);
  });

  it("lands above the sidecar high-water mark when a rollback is explicitly accepted", async () => {
    // A vault whose payload version trails the sidecar. Writing
    // payloadVersion + 1 would land below the mark and trip rollback
    // detection on the very next open.
    seedVault(vaultPath, { a: "1" }, 2);
    seedSidecar(sidecarPath, 9);

    const result = await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
      acceptRollback: true,
    });

    expect(result.vaultVersion).toBe(10);
    expect(readSidecarVersion(sidecarPath)).toBe(10);

    // Proof it matters: the vault opens without a rollback error.
    mockState.key = Buffer.from(NEW_KEY);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("a")).toBe("1");
    vault.close();
  });

  it("upgrades a legacy AAD-less flat vault to schema 1 in the same step", async () => {
    seedLegacyVault(vaultPath, { "legacy-key": "legacy-value" });

    const result = await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
    });

    expect(result.upgradedFromLegacy).toBe(true);
    expect(result.secretCount).toBe(1);
    expect(result.vaultVersion).toBe(1);

    const decoded = decryptVault(vaultPath, NEW_KEY);
    expect(decoded).toMatchObject({
      schema: VAULT_SCHEMA_VERSION,
      vaultVersion: 1,
      secrets: { "legacy-key": "legacy-value" },
    });
    expect(readSidecarVersion(sidecarPath)).toBe(1);
  });
});

// =============================================================================
// commit seam
// =============================================================================

describe("rekeyVault — commit", () => {
  it("runs commit after the new ciphertext lands", async () => {
    seedVault(vaultPath, { a: "1" }, 1);
    seedSidecar(sidecarPath, 1);

    let sawNewCiphertext = false;
    let sidecarAtCommit: number | null = null;
    await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
      commit: () => {
        sawNewCiphertext = decryptVault(vaultPath, NEW_KEY) !== null;
        sidecarAtCommit = readSidecarVersion(sidecarPath);
      },
    });

    expect(sawNewCiphertext).toBe(true);
    // The version bump is published only after commit succeeds.
    expect(sidecarAtCommit).toBe(1);
    expect(readSidecarVersion(sidecarPath)).toBe(2);
  });

  it("restores the prior ciphertext byte-for-byte when commit throws", async () => {
    seedVault(vaultPath, { a: "1" }, 4);
    seedSidecar(sidecarPath, 4);
    const before = readFileSync(vaultPath);

    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: Buffer.from(TEST_KEY),
        nextKey: Buffer.from(NEW_KEY),
        commit: () => {
          throw new Error("failed to write config");
        },
      }),
    ).rejects.toThrow("failed to write config");

    expect(readFileSync(vaultPath).equals(before)).toBe(true);
    // Sidecar never advanced, so the restored version is still at the mark.
    expect(readSidecarVersion(sidecarPath)).toBe(4);
    expect(decryptVault(vaultPath, NEW_KEY)).toBeNull();

    // The original key still opens the vault — the operator is exactly where
    // they started.
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("a")).toBe("1");
    expect(vault.vaultVersion).toBe(4);
    vault.close();
  });

  it("propagates a rejected async commit and restores", async () => {
    seedVault(vaultPath, { a: "1" }, 1);
    seedSidecar(sidecarPath, 1);
    const before = readFileSync(vaultPath);

    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: Buffer.from(TEST_KEY),
        nextKey: Buffer.from(NEW_KEY),
        commit: async () => {
          await Promise.resolve();
          throw new Error("async commit failed");
        },
      }),
    ).rejects.toThrow("async commit failed");

    expect(readFileSync(vaultPath).equals(before)).toBe(true);
    expect(readSidecarVersion(sidecarPath)).toBe(1);
  });
});

// =============================================================================
// Failure modes
// =============================================================================

describe("rekeyVault — failures", () => {
  it("throws VAULT_NOT_FOUND when the vault file is absent", async () => {
    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: Buffer.from(TEST_KEY),
        nextKey: Buffer.from(NEW_KEY),
      }),
    ).rejects.toThrow(VaultError);
    expect(existsSync(vaultPath)).toBe(false);
  });

  it("refuses a rolled-back vault rather than re-publishing it at a fresh version", async () => {
    // Without this check a rekey would be strictly weaker than an open: it
    // would launder the stale secrets past every later rollback check.
    seedVault(vaultPath, { a: "stale" }, 2);
    seedSidecar(sidecarPath, 9);
    const before = readFileSync(vaultPath);

    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: Buffer.from(TEST_KEY),
        nextKey: Buffer.from(NEW_KEY),
      }),
    ).rejects.toThrow(VaultRollbackError);

    expect(readFileSync(vaultPath).equals(before)).toBe(true);
    expect(readSidecarVersion(sidecarPath)).toBe(9);
  });

  it("refuses a missing sidecar unless explicitly accepted", async () => {
    seedVault(vaultPath, { a: "1" }, 3);
    const before = readFileSync(vaultPath);

    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: Buffer.from(TEST_KEY),
        nextKey: Buffer.from(NEW_KEY),
      }),
    ).rejects.toThrow(/VAULT_SIDECAR_MISSING|Sidecar file/);
    expect(readFileSync(vaultPath).equals(before)).toBe(true);
    expect(existsSync(sidecarPath)).toBe(false);

    const result = await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
      acceptMissingSidecar: true,
    });
    expect(result.vaultVersion).toBe(4);
    expect(readSidecarVersion(sidecarPath)).toBe(4);
  });

  it("throws VaultDecryptError and changes nothing when the current key is wrong", async () => {
    seedVault(vaultPath, { a: "1" }, 2);
    seedSidecar(sidecarPath, 2);
    const before = readFileSync(vaultPath);

    await expect(
      rekeyVault({
        path: vaultPath,
        sidecarPath,
        currentKey: randomBytes(32),
        nextKey: Buffer.from(NEW_KEY),
      }),
    ).rejects.toThrow(VaultDecryptError);

    expect(readFileSync(vaultPath).equals(before)).toBe(true);
    expect(readSidecarVersion(sidecarPath)).toBe(2);
  });

  it("leaves no temp files behind on the success path", async () => {
    seedVault(vaultPath, { a: "1" }, 1);
    seedSidecar(sidecarPath, 1);

    await rekeyVault({
      path: vaultPath,
      sidecarPath,
      currentKey: Buffer.from(TEST_KEY),
      nextKey: Buffer.from(NEW_KEY),
    });

    const { readdirSync } = await import("fs");
    expect(readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
