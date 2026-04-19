/**
 * SessionVault — integration tests.
 *
 * Exercises the full encrypt/decrypt + sidecar + file-lock path against
 * real filesystem operations in a per-test temp directory. The KeyProvider
 * is mocked to return a deterministic key so we don't hit the OS keychain.
 *
 * Covers issue #40 acceptance criteria:
 *   - encrypt / decrypt round-trip (AAD binding)
 *   - rollback detection via sidecar
 *   - missing sidecar auto-init with/without acceptMissingSidecar
 *   - concurrent reads see each other's writes (mtime-check coherence)
 *   - close() + read throws VaultClosedError
 *   - nonce uniqueness across N writes
 *   - AAD tampering (path-swap) fails decryption
 *   - crash-between-vault-and-sidecar recovery
 *   - vault-file permission warning on 0644 vault
 *   - sidecar permission warning on 0644 sidecar
 *   - name validation (control chars, slashes, null bytes)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

// =============================================================================
// Mock the KeyProvider resolver to return a deterministic test key
// =============================================================================

const TEST_KEY = randomBytes(32);

vi.mock("../src/key-providers/resolve.js", () => ({
  resolveKeyProvider: () => ({
    ok: true,
    provider: {
      name: "keychain",
      getKey: () => Buffer.from(TEST_KEY),
      storeKey: () => true,
    },
  }),
}));

// Import AFTER mocking.
import {
  openVault,
  VAULT_SCHEMA_VERSION,
  VaultClosedError,
  VaultRollbackError,
  VaultDecryptError,
  type SessionVault,
} from "../src/vault/session-vault.js";
import { encryptObject } from "../src/crypto/vault-common.js";
import { createHash } from "crypto";

// =============================================================================
// Test harness
// =============================================================================

let tmpDir: string;
let vaultPath: string;
let sidecarPath: string;

function makeAad(path: string, schema: number = VAULT_SCHEMA_VERSION): Buffer {
  return createHash("sha256")
    .update(`centient-secrets-vault:v${schema}:${path}`)
    .digest();
}

function seedVault(
  path: string,
  secrets: Record<string, string>,
  vaultVersion: number = 1,
): void {
  const payload = { schema: VAULT_SCHEMA_VERSION, vaultVersion, secrets };
  const aad = makeAad(path);
  const encrypted = encryptObject(payload as unknown as Record<string, unknown>, Buffer.from(TEST_KEY), aad);
  if (!encrypted) throw new Error("test setup: encryption failed");
  writeFileSync(path, encrypted, { mode: 0o600 });
}

function seedSidecar(path: string, highestSeenVersion: number): void {
  writeFileSync(path, JSON.stringify({ highestSeenVersion }), { mode: 0o600 });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-vault-test-"));
  vaultPath = join(tmpDir, "vault.enc");
  sidecarPath = join(tmpDir, "vault.seen-version");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Core round-trip
// =============================================================================

describe("openVault — round trip", () => {
  it("reads a seeded vault and returns decrypted values", async () => {
    seedVault(vaultPath, { "api-key": "secret-value" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("api-key")).toBe("secret-value");
    expect(await vault.get("missing")).toBeNull();
    vault.close();
  });

  it("writes a new secret and persists it across a close+reopen", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const v1 = await openVault({ path: vaultPath, sidecarPath });
    await v1.set("new-key", "hello");
    v1.close();

    const v2 = await openVault({ path: vaultPath, sidecarPath });
    expect(await v2.get("new-key")).toBe("hello");
    v2.close();
  });

  it("lists secrets sorted and prefix-filtered", async () => {
    seedVault(vaultPath, { "app.a": "1", "app.b": "2", "other": "3" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    expect(await vault.list()).toEqual(["app.a", "app.b", "other"]);
    expect(await vault.list("app.")).toEqual(["app.a", "app.b"]);
    vault.close();
  });

  it("delete removes a key and returns true; returns false on missing key", async () => {
    seedVault(vaultPath, { "a": "1", "b": "2" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    expect(await vault.delete("a")).toBe(true);
    expect(await vault.get("a")).toBeNull();
    expect(await vault.delete("nonexistent")).toBe(false);
    vault.close();
  });

  it("increments vaultVersion on every successful write", async () => {
    seedVault(vaultPath, {}, 5);
    seedSidecar(sidecarPath, 5);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    expect(vault.vaultVersion).toBe(5);
    await vault.set("a", "1");
    expect(vault.vaultVersion).toBe(6);
    await vault.set("b", "2");
    expect(vault.vaultVersion).toBe(7);
    await vault.delete("a");
    expect(vault.vaultVersion).toBe(8);
    vault.close();
  });
});

// =============================================================================
// Rollback detection
// =============================================================================

describe("openVault — rollback detection", () => {
  it("throws VaultRollbackError when vault version < sidecar highestSeenVersion", async () => {
    seedVault(vaultPath, { "k": "v" }, 3);
    seedSidecar(sidecarPath, 10);
    await expect(openVault({ path: vaultPath, sidecarPath })).rejects.toBeInstanceOf(VaultRollbackError);
  });

  it("includes expected and actual versions on the error", async () => {
    seedVault(vaultPath, { "k": "v" }, 3);
    seedSidecar(sidecarPath, 10);
    try {
      await openVault({ path: vaultPath, sidecarPath });
      throw new Error("expected VaultRollbackError");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultRollbackError);
      const e = err as VaultRollbackError;
      expect(e.expected).toBe(10);
      expect(e.actual).toBe(3);
    }
  });

  it("allows rollback when acceptRollback: true is passed (with warning)", async () => {
    seedVault(vaultPath, { "k": "v" }, 3);
    seedSidecar(sidecarPath, 10);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({ path: vaultPath, sidecarPath, acceptRollback: true });
    expect(await vault.get("k")).toBe("v");
    expect(stderrSpy).toHaveBeenCalled();
    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/accepting intentional rollback/i);
    stderrSpy.mockRestore();
    vault.close();
  });

  it("updates sidecar to vault version after accepted rollback", async () => {
    seedVault(vaultPath, { "k": "v" }, 3);
    seedSidecar(sidecarPath, 10);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({ path: vaultPath, sidecarPath, acceptRollback: true });
    vault.close();
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.highestSeenVersion).toBe(3);
    vi.restoreAllMocks();
  });
});

// =============================================================================
// Missing sidecar
// =============================================================================

describe("openVault — missing sidecar", () => {
  it("auto-initializes sidecar and warns on stderr when sidecar is absent", async () => {
    seedVault(vaultPath, { "k": "v" }, 7);
    expect(existsSync(sidecarPath)).toBe(false);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.highestSeenVersion).toBe(7);
    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/sidecar file .* is missing/i);
    stderrSpy.mockRestore();
  });

  it("suppresses the missing-sidecar warning when acceptMissingSidecar: true", async () => {
    seedVault(vaultPath, { "k": "v" }, 7);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({
      path: vaultPath,
      sidecarPath,
      acceptMissingSidecar: true,
    });
    vault.close();
    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).not.toMatch(/sidecar file .* is missing/i);
    stderrSpy.mockRestore();
  });
});

// =============================================================================
// Cross-process coherence (mtime-check)
// =============================================================================

describe("openVault — mtime-check coherence", () => {
  it("picks up external writes between reads", async () => {
    seedVault(vaultPath, { "a": "1" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("a")).toBe("1");

    // Simulate an external writer (e.g. the CLI) modifying the vault.
    // Advance the mtime by a detectable margin.
    await new Promise((r) => setTimeout(r, 25));
    seedVault(vaultPath, { "a": "2", "b": "new" }, 2);
    seedSidecar(sidecarPath, 2);

    expect(await vault.get("a")).toBe("2");
    expect(await vault.get("b")).toBe("new");
    vault.close();
  });

  it("best-effort coherence ignores external writes until reload()", async () => {
    seedVault(vaultPath, { "a": "1" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({
      path: vaultPath,
      sidecarPath,
      coherence: "best-effort",
    });

    await new Promise((r) => setTimeout(r, 25));
    seedVault(vaultPath, { "a": "2" }, 2);
    seedSidecar(sidecarPath, 2);

    expect(await vault.get("a")).toBe("1"); // stale on purpose
    await vault.reload();
    expect(await vault.get("a")).toBe("2");
    vault.close();
  });
});

// =============================================================================
// close() semantics
// =============================================================================

describe("SessionVault.close()", () => {
  it("subsequent reads throw VaultClosedError", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();
    await expect(vault.get("k")).rejects.toBeInstanceOf(VaultClosedError);
    await expect(vault.list()).rejects.toBeInstanceOf(VaultClosedError);
    await expect(vault.set("a", "b")).rejects.toBeInstanceOf(VaultClosedError);
    await expect(vault.delete("a")).rejects.toBeInstanceOf(VaultClosedError);
  });

  it("close is idempotent", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();
    vault.close(); // should not throw
    vault.close();
  });

  it("auto-closes after ttlMs elapses", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath, ttlMs: 50 });
    expect(await vault.get("k")).toBe("v");
    await new Promise((r) => setTimeout(r, 80));
    await expect(vault.get("k")).rejects.toBeInstanceOf(VaultClosedError);
  });
});

// =============================================================================
// AAD binding
// =============================================================================

describe("AAD binding", () => {
  it("decryption fails when the vault file is moved to a different path (AAD mismatch)", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    // Copy the ciphertext to a different path — AAD will not match.
    const otherPath = join(tmpDir, "other-vault.enc");
    writeFileSync(otherPath, readFileSync(vaultPath), { mode: 0o600 });

    await expect(
      openVault({ path: otherPath, sidecarPath }),
    ).rejects.toBeInstanceOf(VaultDecryptError);
  });
});

// =============================================================================
// Nonce uniqueness
// =============================================================================

describe("nonce uniqueness", () => {
  it("produces unique IVs across many writes", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    const ivs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await vault.set("k", `value-${i}`);
      const bytes = readFileSync(vaultPath);
      // IV is first 12 bytes of the payload.
      ivs.add(bytes.subarray(0, 12).toString("hex"));
    }
    expect(ivs.size).toBe(20);
    vault.close();
  });
});

// =============================================================================
// Concurrent writers via file lock
// =============================================================================

describe("concurrent writes — file lock", () => {
  it("serializes two concurrent set() calls without loss", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);

    const v1 = await openVault({ path: vaultPath, sidecarPath });
    const v2 = await openVault({ path: vaultPath, sidecarPath });

    // Fire two writes "in parallel" — the file lock serializes them.
    await Promise.all([v1.set("a", "from-v1"), v2.set("b", "from-v2")]);

    // Both writes should be reflected in the final vault state.
    v1.close();
    v2.close();
    const v3 = await openVault({ path: vaultPath, sidecarPath });
    expect(await v3.get("a")).toBe("from-v1");
    expect(await v3.get("b")).toBe("from-v2");
    expect(v3.vaultVersion).toBeGreaterThanOrEqual(3);
    v3.close();
  });
});

// =============================================================================
// Permission checks
// =============================================================================

describe("permission warnings", () => {
  it("warns on stderr when vault file is world-readable", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    chmodSync(vaultPath, 0o644);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();

    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/vault file .* has permissive mode/i);
    stderrSpy.mockRestore();
  });

  it("warns on stderr when sidecar file is world-readable", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    chmodSync(sidecarPath, 0o644);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();

    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/sidecar file .* has permissive mode/i);
    stderrSpy.mockRestore();
  });
});

// =============================================================================
// Crash recovery — vault committed, sidecar not yet updated
// =============================================================================

describe("crash recovery", () => {
  it("recovers cleanly when vault is ahead of sidecar (crash between writes)", async () => {
    // Simulate: vault was written to version 5, but process crashed before
    // sidecar update. Reopening should bless the vault version (since the
    // sidecar is "lagging, will catch up") rather than error.
    seedVault(vaultPath, { "a": "1" }, 5);
    seedSidecar(sidecarPath, 4);

    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(vault.vaultVersion).toBe(5);
    vault.close();

    // Sidecar should have been caught up to 5.
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.highestSeenVersion).toBe(5);
  });
});

// =============================================================================
// Name validation
// =============================================================================

describe("name validation", () => {
  it.each([
    ["empty string", ""],
    ["contains slash", "path/to/key"],
    ["contains backslash", "path\\to\\key"],
    ["contains null byte", "key\u0000name"],
    ["contains newline", "key\nname"],
    ["contains DEL", "key\u007fname"],
  ])("rejects name with %s", async (_label, name) => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    await expect(vault.set(name, "value")).rejects.toThrow(/invalid characters|non-empty/i);
    vault.close();
  });

  it("accepts normal dotted/hyphenated names", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    await vault.set("app.api-key_123", "value");
    expect(await vault.get("app.api-key_123")).toBe("value");
    vault.close();
  });
});
