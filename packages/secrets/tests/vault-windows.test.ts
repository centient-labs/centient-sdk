/**
 * WindowsVault — listKeys tests
 *
 * Mocks `child_process.spawnSync` so powershell.exe is never invoked.
 * Exercises the parser that extracts the `UserName` lines returned by
 * `PasswordVault.FindAllByResource('centient')` and confirms prefix
 * filtering, empty-result handling, and transient-failure propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawnSync: mockSpawnSync,
}));

const { WindowsVault } = await import("../src/vault/vault-windows.js");

function okResult(stdout: string): {
  error: null;
  status: 0;
  stdout: string;
  stderr: string;
} {
  return { error: null, status: 0, stdout, stderr: "" };
}

function psFailure(): {
  error: Error;
  status: number;
  stdout: string;
  stderr: string;
} {
  return {
    error: new Error("powershell.exe not found"),
    status: -1,
    stdout: "",
    stderr: "",
  };
}

beforeEach(() => {
  mockSpawnSync.mockReset();
});

describe("WindowsVault.listKeys", () => {
  it("returns every UserName emitted by FindAllByResource", async () => {
    mockSpawnSync.mockReturnValue(
      okResult("auth-token\nrefresh-token\nsoma-anthropic-token1\n"),
    );
    const vault = new WindowsVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "refresh-token",
      "soma-anthropic-token1",
    ]);
  });

  it("filters by prefix", async () => {
    mockSpawnSync.mockReturnValue(
      okResult(
        "auth-token\nsoma-anthropic-token1\nsoma-anthropic-token2\nrefresh-token\n",
      ),
    );
    const vault = new WindowsVault();
    const result = await vault.listKeys("soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("auth-token");
  });

  it("returns [] when the PowerShell block emits no output (empty resource)", async () => {
    mockSpawnSync.mockReturnValue(okResult(""));
    const vault = new WindowsVault();
    await expect(vault.listKeys()).resolves.toEqual([]);
  });

  it("ignores blank lines in the output", async () => {
    mockSpawnSync.mockReturnValue(
      okResult("auth-token\n\n\nsoma-anthropic-token1\n"),
    );
    const vault = new WindowsVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual(["auth-token", "soma-anthropic-token1"]);
  });

  it("handles CRLF line endings from powershell.exe", async () => {
    mockSpawnSync.mockReturnValue(
      okResult("auth-token\r\nrefresh-token\r\nsoma-anthropic-token1\r\n"),
    );
    const vault = new WindowsVault();
    const result = await vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "refresh-token",
      "soma-anthropic-token1",
    ]);
  });

  it("throws when powershell.exe itself fails to run", async () => {
    mockSpawnSync.mockReturnValue(psFailure());
    const vault = new WindowsVault();
    await expect(vault.listKeys()).rejects.toThrow(
      /Windows Credential Manager enumeration failed/,
    );
  });
});
