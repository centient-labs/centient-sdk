/**
 * Auth Vault — Windows Credential Manager Backend (WSL)
 *
 * Implements the VaultBackend interface using the Windows Runtime PasswordVault
 * API accessed via powershell.exe. This backend is intended for use in WSL
 * (Windows Subsystem for Linux) environments where powershell.exe is reachable
 * from the Linux filesystem.
 *
 * Detection: checks for the WSL_DISTRO_NAME environment variable or the
 * presence of "microsoft" (case-insensitive) in /proc/version.
 *
 * Storage: credentials are stored in the Windows Credential Manager under the
 * resource name "centient", with the logical key as the username.
 *
 * Error handling: all methods return false/null on failure — never throw.
 */

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import type { VaultBackend } from "./types.js";
import { isValidKey } from "./vault-utils.js";

// =============================================================================
// Constants
// =============================================================================

/** Windows Credential Manager resource name used for all centient credentials. */
const RESOURCE_NAME = "centient";

// =============================================================================
// PowerShell helpers
// =============================================================================

/**
 * Escapes a string for safe embedding inside a PowerShell single-quoted string.
 * Single quotes are doubled per PowerShell escaping rules.
 */
function escapePsValue(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Executes a PowerShell command via powershell.exe with no profile and
 * non-interactive mode. Returns stdout trimmed, or null on error.
 *
 * Uses spawnSync to bypass the shell entirely, preventing shell injection
 * via credential values that contain double-quotes or shell metacharacters.
 */
function runPowershell(command: string): string | null {
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8" },
    );
    if (result.error || result.status !== 0) return null;
    return (result.stdout as string).trim();
  } catch {
    return null;
  }
}

// =============================================================================
// WindowsVault
// =============================================================================

/**
 * Vault backend that stores credentials in the Windows Credential Manager
 * using the Windows Runtime PasswordVault API via powershell.exe.
 *
 * This backend is only available in WSL environments. Use `WindowsVault.detect()`
 * before instantiating to verify availability.
 *
 * Usage:
 *   if (WindowsVault.detect()) {
 *     const vault = new WindowsVault();
 *     vault.store("auth-token", token);
 *   }
 */
export class WindowsVault implements VaultBackend {
  /**
   * Returns true if running inside a WSL environment where powershell.exe is
   * accessible.
   *
   * Detection order:
   *   1. WSL_DISTRO_NAME environment variable is set and non-empty
   *   2. /proc/version contains "microsoft" (case-insensitive)
   */
  static detect(): boolean {
    // Primary detection: WSL_DISTRO_NAME env var
    const wslDistro = process.env["WSL_DISTRO_NAME"];
    if (wslDistro !== undefined && wslDistro.length > 0) {
      return WindowsVault.isPowershellAvailable();
    }

    // Secondary detection: /proc/version content
    try {
      const procVersion = readFileSync("/proc/version", "utf8");
      if (/microsoft/i.test(procVersion)) {
        return WindowsVault.isPowershellAvailable();
      }
    } catch {
      // /proc/version not readable — not a Linux/WSL environment
    }

    return false;
  }

  /**
   * Verifies that powershell.exe is reachable on PATH.
   */
  private static isPowershellAvailable(): boolean {
    try {
      const result = spawnSync("which", ["powershell.exe"], {
        encoding: "utf8",
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Stores a credential in the Windows Credential Manager PasswordVault.
   *
   * The credential is stored under the resource name "centient" with `key`
   * as the username and `value` as the password.
   *
   * @param key   - Logical key name (e.g. 'auth-token', 'refresh-token')
   * @param value - The credential value to store
   * @returns true on success, false if storage fails
   */
  store(key: string, value: string): boolean {
    if (!isValidKey(key)) return false;

    const escapedKey = escapePsValue(key);
    const escapedValue = escapePsValue(value);

    const command = [
      "& {",
      "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault;",
      `$cred = New-Object Windows.Security.Credentials.PasswordCredential('${escapePsValue(RESOURCE_NAME)}', '${escapedKey}', '${escapedValue}');`,
      "$vault.Add($cred)",
      "}",
    ].join(" ");

    const result = runPowershell(command);
    return result !== null;
  }

  /**
   * Retrieves a credential from the Windows Credential Manager PasswordVault.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns The stored password, or null if not found / retrieval fails
   */
  retrieve(key: string): string | null {
    if (!isValidKey(key)) return null;

    const escapedKey = escapePsValue(key);

    const command = [
      "& {",
      "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault;",
      `$cred = $vault.Retrieve('${escapePsValue(RESOURCE_NAME)}', '${escapedKey}');`,
      "$cred.RetrievePassword();",
      "$cred.Password",
      "}",
    ].join(" ");

    const result = runPowershell(command);
    if (result === null || result.length === 0) return null;
    return result;
  }

  /**
   * Removes a credential from the Windows Credential Manager PasswordVault.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns true on success (including "not found"), false on unexpected error
   */
  delete(key: string): boolean {
    if (!isValidKey(key)) return false;

    const escapedKey = escapePsValue(key);

    const command = [
      "& {",
      "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault;",
      "try {",
      `$cred = $vault.Retrieve('${escapePsValue(RESOURCE_NAME)}', '${escapedKey}');`,
      "$vault.Remove($cred)",
      "} catch {}",
      "}",
    ].join(" ");

    // A null result from runPowershell means powershell.exe itself failed to
    // execute; swallowing "not found" errors is handled inside the PS try/catch.
    const result = runPowershell(command);
    return result !== null;
  }

  /**
   * Enumerate credential keys stored under the `centient` resource name
   * in the Windows Credential Manager PasswordVault. Each credential's
   * `UserName` is the logical key.
   *
   * The PowerShell `FindAllByResource` call throws when no credentials
   * are stored for the resource — that is surfaced as an empty list, not
   * an error, to match the `[]` semantics of other backends when nothing
   * has been stored yet.
   *
   * A null result from `runPowershell` (powershell.exe itself failed to
   * execute) is propagated as a thrown error per the VaultBackend contract.
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const command = [
      "& {",
      "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault;",
      "try {",
      `$creds = $vault.FindAllByResource('${escapePsValue(RESOURCE_NAME)}');`,
      "$creds | ForEach-Object { $_.UserName }",
      "} catch {}",
      "}",
    ].join(" ");

    const result = runPowershell(command);
    if (result === null) {
      throw new Error("Windows Credential Manager enumeration failed");
    }
    if (result.length === 0) return [];

    const keys: string[] = [];
    for (const line of result.split(/\r?\n/)) {
      const key = line.trim();
      if (key.length === 0) continue;
      if (prefix !== undefined && !key.startsWith(prefix)) continue;
      keys.push(key);
    }
    return keys;
  }
}
