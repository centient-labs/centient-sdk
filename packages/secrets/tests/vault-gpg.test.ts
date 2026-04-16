/**
 * GpgVault — listKeys tests
 *
 * Exercises the filename-based enumeration in `~/.centient/auth/` by
 * redirecting HOME to a deterministic tmp directory BEFORE the module
 * under test is imported (its `AUTH_DIR` constant is computed from
 * `homedir()` at import time). The tests do not invoke `gpg` itself —
 * only the directory scan.
 *
 * IMPORTANT: the HOME override lives inside `vi.hoisted` so that vitest
 * runs it before any `import` statement in this file. Do NOT add a
 * top-level import of anything that transitively loads `vault-gpg.js`
 * outside the path below — that would capture the wrong HOME.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const { tmpHome, originalHome } = vi.hoisted(() => {
  // Cannot import fs/os inside a hoisted block — they are not yet
  // available. Compose a deterministic path from globally-available
  // pieces (process.pid + Date.now) that the test body will create
  // and clean up using fs primitives after imports complete.
  const path = `/tmp/centient-gpg-test-${process.pid}-${Date.now()}`;
  const original = process.env["HOME"];
  process.env["HOME"] = path;
  return { tmpHome: path, originalHome: original };
});

// Import AFTER the hoisted HOME override so GpgVault's AUTH_DIR picks up
// the tmp path when the module is first evaluated.
// eslint-disable-next-line import/order
import { GpgVault } from "../src/vault/vault-gpg.js";

// Reference the standard tmpdir import so it's not flagged as unused;
// kept available for any future tests that need to materialize helper
// files outside the tmpHome tree.
void tmpdir;

const AUTH_DIR = join(tmpHome, ".centient", "auth");

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("GpgVault.listKeys", () => {
  beforeEach(() => {
    rmSync(AUTH_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(AUTH_DIR, { recursive: true, force: true });
  });

  it("returns [] when the auth directory does not exist", async () => {
    const vault = new GpgVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("returns [] when the auth directory exists but is empty", async () => {
    mkdirSync(AUTH_DIR, { recursive: true });
    const vault = new GpgVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("returns every stored key when no prefix is supplied", async () => {
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(join(AUTH_DIR, "credentials-auth-token.gpg"), "fake");
    writeFileSync(join(AUTH_DIR, "credentials-refresh-token.gpg"), "fake");
    writeFileSync(
      join(AUTH_DIR, "credentials-soma-anthropic-token1.gpg"),
      "fake",
    );
    writeFileSync(join(AUTH_DIR, "something-else.txt"), "fake");

    const vault = new GpgVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "refresh-token",
      "soma-anthropic-token1",
    ]);
  });

  it("filters by prefix — includes matches, excludes non-matches", async () => {
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(join(AUTH_DIR, "credentials-auth-token.gpg"), "fake");
    writeFileSync(
      join(AUTH_DIR, "credentials-soma-anthropic-token1.gpg"),
      "fake",
    );
    writeFileSync(
      join(AUTH_DIR, "credentials-soma-anthropic-token2.gpg"),
      "fake",
    );

    const vault = new GpgVault();
    const result = await vault.listKeys("soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("auth-token");
  });

  it("ignores files that don't match the credentials-*.gpg naming scheme", async () => {
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(join(AUTH_DIR, "credentials-auth-token.gpg"), "fake");
    writeFileSync(join(AUTH_DIR, "credentials-auth-token.gpg.bak"), "fake");
    writeFileSync(join(AUTH_DIR, "credentials.gpg"), "fake");
    writeFileSync(join(AUTH_DIR, "README"), "fake");

    const vault = new GpgVault();
    await expect(vault.listKeys()).resolves.toEqual(["auth-token"]);
  });
});
