/**
 * EnvVault — listKeys tests
 *
 * EnvVault exposes a single logical key (`auth-token`) mapped to the
 * `ENGRAM_API_KEY` environment variable. listKeys should reflect this:
 * present when the env var is set, absent otherwise.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvVault } from "../src/vault/vault-env.js";

const ORIGINAL_ENV = process.env["ENGRAM_API_KEY"];

describe("EnvVault.listKeys", () => {
  beforeEach(() => {
    delete process.env["ENGRAM_API_KEY"];
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env["ENGRAM_API_KEY"];
    } else {
      process.env["ENGRAM_API_KEY"] = ORIGINAL_ENV;
    }
  });

  it("returns [] when ENGRAM_API_KEY is not set", async () => {
    const vault = new EnvVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("returns ['auth-token'] when ENGRAM_API_KEY is set (no prefix)", async () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    await expect(vault.listKeys()).resolves.toEqual(["auth-token"]);
  });

  it("returns ['auth-token'] when ENGRAM_API_KEY is set and prefix matches", async () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    await expect(vault.listKeys("auth")).resolves.toEqual(["auth-token"]);
    await expect(vault.listKeys("auth-token")).resolves.toEqual(["auth-token"]);
  });

  it("returns [] when the prefix doesn't match auth-token", async () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    await expect(vault.listKeys("refresh")).resolves.toEqual([]);
    await expect(vault.listKeys("soma-")).resolves.toEqual([]);
  });
});
