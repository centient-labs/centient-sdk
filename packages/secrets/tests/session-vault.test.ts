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
  utimesSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as pathMod from "path";
import { randomBytes } from "crypto";

// =============================================================================
// Mock the KeyProvider resolver to return a deterministic test key
// =============================================================================

const TEST_KEY = randomBytes(32);

// Mutable mock state so individual tests can override the resolver behaviour
// without juggling vi.doMock / module cache resets.
const mockState: {
  providerResult:
    | { ok: true; provider: { name: string; getKey: () => Buffer | null; storeKey: () => boolean } }
    | { ok: false; error: { message: string } };
} = {
  providerResult: {
    ok: true,
    provider: {
      name: "keychain",
      getKey: () => Buffer.from(TEST_KEY),
      storeKey: () => true,
    },
  },
};

function resetMockState(): void {
  mockState.providerResult = {
    ok: true,
    provider: {
      name: "keychain",
      getKey: () => Buffer.from(TEST_KEY),
      storeKey: () => true,
    },
  };
}

vi.mock("../src/key-providers/resolve.js", () => ({
  resolveKeyProvider: () => mockState.providerResult,
}));

// Import AFTER mocking.
import {
  openVault,
  VAULT_SCHEMA_VERSION,
  VaultClosedError,
  VaultRollbackError,
  VaultDecryptError,
  VaultUnlockError,
  VaultLockError,
  VaultError,
  type SessionVault,
} from "../src/vault/session-vault.js";
import { encryptObject } from "../src/crypto/vault-common.js";
import { setSecretsPolicies, type SecretsEvent, type SecretsOperation } from "../src/vault/policy.js";
import { createHash } from "crypto";

// =============================================================================
// Test harness
// =============================================================================

let tmpDir: string;
let vaultPath: string;
let sidecarPath: string;

function makeAad(path: string, schema: number = VAULT_SCHEMA_VERSION): Buffer {
  // Production code binds AAD to the realpath of the vault so symlinks don't
  // produce duplicate AADs. On macOS, `os.tmpdir()` is typically a symlink
  // (`/var/folders/...` → `/private/var/folders/...`), so test fixtures must
  // resolve the vault file's realpath to match. The file may not exist yet;
  // resolve the parent dir and rejoin.
  const { dirname: _d, basename: _b } = pathMod;
  const parent = realpathSync(_d(path));
  const resolved = `${parent}/${_b(path)}`;
  return createHash("sha256")
    .update(`centient-secrets-vault:v${schema}:${resolved}`)
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
  resetMockState();
  setSecretsPolicies([]);
  vi.useRealTimers();
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

describe("openVault — missing sidecar (refuse-by-default)", () => {
  it("refuses to open when sidecar is absent and acceptMissingSidecar is not passed", async () => {
    seedVault(vaultPath, { "k": "v" }, 7);
    expect(existsSync(sidecarPath)).toBe(false);
    // New default: refuse. Rollback protection must be in effect always.
    await expect(openVault({ path: vaultPath, sidecarPath })).rejects.toMatchObject({
      code: "VAULT_SIDECAR_MISSING",
    });
    // Sidecar was not silently created.
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("opens and auto-initializes sidecar when acceptMissingSidecar: true", async () => {
    seedVault(vaultPath, { "k": "v" }, 7);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({
      path: vaultPath,
      sidecarPath,
      acceptMissingSidecar: true,
    });
    vault.close();
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.highestSeenVersion).toBe(7);
    // Warning is still emitted even with opt-in, so operators see the
    // auto-init event in logs.
    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/sidecar file .* is missing/i);
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
    // Deterministic timing via fake timers — avoids real-clock flake under CI.
    vi.useFakeTimers();
    const vault = await openVault({ path: vaultPath, sidecarPath, ttlMs: 50 });
    expect(await vault.get("k")).toBe("v");
    // Advance past the TTL to trigger the auto-close timer.
    vi.advanceTimersByTime(100);
    await expect(vault.get("k")).rejects.toBeInstanceOf(VaultClosedError);
    vi.useRealTimers();
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

  // T7. Name-length boundary.
  it("accepts exactly-256-char names and rejects 257-char names", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    const ok = "a".repeat(256);
    const bad = "a".repeat(257);
    await expect(vault.set(ok, "v")).resolves.toBeUndefined();
    await expect(vault.set(bad, "v")).rejects.toThrow(/256 characters or fewer/);
    vault.close();
  });
});

// =============================================================================
// T1. Strict coherence — external write invalidates in-memory snapshot
// =============================================================================

describe("openVault — strict coherence", () => {
  it("throws VAULT_STALE_SNAPSHOT when external write advances mtime", async () => {
    seedVault(vaultPath, { "k": "v1" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({
      path: vaultPath,
      sidecarPath,
      coherence: "strict",
    });
    // Baseline read works.
    expect(await vault.get("k")).toBe("v1");

    // External writer advances the vault (and mtime) on disk.
    await new Promise((r) => setTimeout(r, 25));
    seedVault(vaultPath, { "k": "v2" }, 2);
    seedSidecar(sidecarPath, 2);

    // Next read in strict mode must refuse to silently serve stale state.
    try {
      await vault.get("k");
      throw new Error("expected VAULT_STALE_SNAPSHOT rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultError);
      expect((err as VaultError).code).toBe("VAULT_STALE_SNAPSHOT");
    }

    // reload() unblocks reads; next get returns the refreshed value.
    await vault.reload();
    expect(await vault.get("k")).toBe("v2");
    vault.close();
  });
});

// =============================================================================
// T2. KeyProvider failure paths
// =============================================================================

describe("openVault — KeyProvider failures", () => {
  it("throws VaultUnlockError when resolveKeyProvider returns {ok: false}", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    mockState.providerResult = {
      ok: false,
      error: { message: "no provider configured" },
    };
    await expect(openVault({ path: vaultPath, sidecarPath })).rejects.toBeInstanceOf(
      VaultUnlockError,
    );
  });

  it("throws VaultUnlockError when provider.getKey returns null", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    mockState.providerResult = {
      ok: true,
      provider: {
        name: "keychain",
        getKey: () => null,
        storeKey: () => true,
      },
    };
    await expect(openVault({ path: vaultPath, sidecarPath })).rejects.toBeInstanceOf(
      VaultUnlockError,
    );
  });
});

// =============================================================================
// T3. Lock timeout
// =============================================================================

describe("openVault — lock timeout", () => {
  it("throws VaultLockError when lock is held past LOCK_TIMEOUT_MS", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    // Pre-create a fresh lock file so stale-lock stealing (>30s) does not
    // steal it. acquireWriteLock() uses a synchronous-busy-wait; we can't
    // yield via fake timers, so we stub Date.now() to advance monotonically
    // past LOCK_TIMEOUT_MS (5000ms) without actually sleeping. Monotonic
    // advance is required so the inner `while (Date.now() < sleepUntil)`
    // busy-wait also terminates.
    const lockPath = `${vaultPath}.lock`;
    writeFileSync(lockPath, "held", { mode: 0o600 });

    const realNow = Date.now.bind(Date);
    const start = realNow();
    let tick = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      // Strictly monotonic. First call = start (establishes deadline at
      // start+5000); subsequent calls jump forward by 1000ms each, so we
      // cross the deadline on the second call and keep advancing past any
      // internal sleepUntil target inside the busy-wait.
      const value = start + tick * 1_000;
      tick += 1;
      return value;
    });

    try {
      await expect(vault.set("a", "b")).rejects.toBeInstanceOf(VaultLockError);
    } finally {
      nowSpy.mockRestore();
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // ignore
      }
      vault.close();
    }
  });
});

// =============================================================================
// T4. Stale-lock detection
// =============================================================================

describe("openVault — stale lock detection", () => {
  it("steals a lock older than LOCK_STALE_MS (30s)", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });

    // Pre-create a stale lock file (mtime 31s in the past).
    const lockPath = `${vaultPath}.lock`;
    writeFileSync(lockPath, "stale", { mode: 0o600 });
    const pastSeconds = Math.floor(Date.now() / 1000) - 31;
    utimesSync(lockPath, pastSeconds, pastSeconds);

    // Write succeeds — stale lock was stolen by acquireWriteLock().
    await expect(vault.set("a", "b")).resolves.toBeUndefined();
    expect(await vault.get("a")).toBe("b");

    // And the lockfile was released (deleted) after the critical section.
    expect(existsSync(lockPath)).toBe(false);
    vault.close();
  });
});

// =============================================================================
// T5. Decrypt error on corrupt vault
// =============================================================================

describe("openVault — corrupt vault", () => {
  it("throws VaultDecryptError when vault file contains garbage", async () => {
    // Write random bytes that aren't a valid AEAD blob.
    writeFileSync(vaultPath, randomBytes(100), { mode: 0o600 });
    seedSidecar(sidecarPath, 1);
    await expect(openVault({ path: vaultPath, sidecarPath })).rejects.toBeInstanceOf(
      VaultDecryptError,
    );
  });
});

// =============================================================================
// T6. SecretsPolicy integration
// =============================================================================

describe("SessionVault — policy integration", () => {
  it("emits SecretsEvent with backend: 'session-vault' for get/set/list/delete", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const events: SecretsEvent[] = [];
    setSecretsPolicies([
      {
        name: "test",
        after: (e) => {
          events.push(e);
        },
      },
    ]);

    const vault = await openVault({ path: vaultPath, sidecarPath });
    await vault.set("k", "v");
    await vault.get("k");
    await vault.list();
    await vault.delete("k");
    vault.close();

    // All four operations emit their success-path event. Order matches call order.
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "credential_written",
      "credential_read",
      "credential_enumerated",
      "credential_deleted",
    ]);
    for (const e of events) {
      expect(e.backend).toBe("session-vault");
    }
  });

  it("runs before hooks and can reject operations", async () => {
    seedVault(vaultPath, { "existing": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    setSecretsPolicies([
      {
        name: "no-writes",
        before: (op: SecretsOperation): void => {
          if (op.type === "write") {
            throw new Error("writes blocked by policy");
          }
        },
      },
    ]);

    const vault = await openVault({ path: vaultPath, sidecarPath });
    // set() is rejected by the before-hook; reads still work.
    await expect(vault.set("k", "v")).rejects.toThrow(/writes blocked by policy/);
    expect(await vault.get("existing")).toBe("v");
    vault.close();
  });

  it("emits credential_read_missing for a non-existent key", async () => {
    seedVault(vaultPath, {}, 1);
    seedSidecar(sidecarPath, 1);
    const events: SecretsEvent[] = [];
    setSecretsPolicies([
      {
        name: "observe",
        after: (e) => {
          events.push(e);
        },
      },
    ]);

    const vault = await openVault({ path: vaultPath, sidecarPath });
    const value = await vault.get("nonexistent");
    vault.close();

    expect(value).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("credential_read_missing");
    expect(events[0]!.backend).toBe("session-vault");
    expect(events[0]!.key).toBe("nonexistent");
  });
});

// =============================================================================
// T8. Empty vault (vaultVersion 0)
// =============================================================================

describe("openVault — empty vault", () => {
  it("opens a vault initialized with vaultVersion 0", async () => {
    seedVault(vaultPath, {}, 0);
    seedSidecar(sidecarPath, 0);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(vault.vaultVersion).toBe(0);
    expect(await vault.list()).toEqual([]);
    await vault.set("a", "b");
    expect(vault.vaultVersion).toBe(1);
    vault.close();
  });
});

// =============================================================================
// T9. reload() after close()
// =============================================================================

describe("SessionVault.reload() — closed-vault semantics", () => {
  it("reload() after close() throws VaultClosedError", async () => {
    seedVault(vaultPath, { "k": "v" }, 1);
    seedSidecar(sidecarPath, 1);
    const vault = await openVault({ path: vaultPath, sidecarPath });
    vault.close();
    await expect(vault.reload()).rejects.toBeInstanceOf(VaultClosedError);
  });
});

// =============================================================================
// T10. acceptRollback + missing sidecar
// =============================================================================

describe("openVault — missing sidecar + acceptRollback", () => {
  it("missing sidecar is checked before rollback; auto-init runs", async () => {
    // Seed vault v3, no sidecar on disk. With acceptMissingSidecar: true,
    // opening succeeds (with a warning about auto-init); acceptRollback: true
    // is a no-op because there is no sidecar to compare against.
    seedVault(vaultPath, { "k": "v" }, 3);
    expect(existsSync(sidecarPath)).toBe(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const vault = await openVault({
      path: vaultPath,
      sidecarPath,
      acceptRollback: true,
      acceptMissingSidecar: true,
    });
    vault.close();

    // Missing-sidecar warning IS emitted (auto-init event is visible);
    // no rollback warning because there was nothing to roll back against.
    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/sidecar file .* is missing/i);
    expect(warningText).not.toMatch(/accepting intentional rollback/i);
    stderrSpy.mockRestore();

    // Sidecar was created with the vault's current version.
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.highestSeenVersion).toBe(3);
  });
});

// =============================================================================
// T13. Legacy (pre-openVault CLI) vault format upgrade
// =============================================================================

describe("openVault — legacy AAD-less vault migration", () => {
  /**
   * Seed a vault written by a pre-openVault CLI: no AAD, flat `{name: value}`
   * top-level object. This is what every existing CLI-written vault looks
   * like on disk. openVault must open it, auto-upgrade on first write, and
   * round-trip correctly thereafter.
   */
  function seedLegacyVault(path: string, secrets: Record<string, string>): void {
    const encrypted = encryptObject(secrets as Record<string, unknown>, Buffer.from(TEST_KEY));
    if (!encrypted) throw new Error("test setup: legacy encryption failed");
    writeFileSync(path, encrypted, { mode: 0o600 });
  }

  it("opens a legacy AAD-less vault (no sidecar required)", async () => {
    seedLegacyVault(vaultPath, { "anthropic.key": "sk-legacy-value" });
    expect(existsSync(sidecarPath)).toBe(false);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Legacy vaults bypass the missing-sidecar refuse — rollback protection
    // is bootstrapped at migration time.
    const vault = await openVault({ path: vaultPath, sidecarPath });
    expect(await vault.get("anthropic.key")).toBe("sk-legacy-value");
    expect(vault.vaultVersion).toBe(0); // legacy is version 0
    vault.close();

    const warningText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warningText).toMatch(/legacy .* vault/i);
    stderrSpy.mockRestore();
  });

  it("auto-upgrades the legacy vault to schema 1 on first write", async () => {
    seedLegacyVault(vaultPath, { "app.key": "v0" });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const vault = await openVault({ path: vaultPath, sidecarPath });
    await vault.set("app.key", "v1"); // triggers the upgrade
    expect(vault.vaultVersion).toBe(1); // was 0 (legacy), now 1 (upgraded)
    vault.close();

    // Re-opening should now work on the v1 path (WITH AAD).
    const v2 = await openVault({ path: vaultPath, sidecarPath });
    expect(await v2.get("app.key")).toBe("v1");
    expect(v2.vaultVersion).toBe(1);
    v2.close();

    vi.restoreAllMocks();
  });
});
