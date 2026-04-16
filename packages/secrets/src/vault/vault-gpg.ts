/**
 * Auth Vault — GPG Backend
 *
 * Implements the VaultBackend interface using GPG-encrypted files stored at
 * ~/.centient/auth/credentials-<key>.gpg. Falls back gracefully when GPG is
 * not installed or no keys are configured.
 *
 * Error handling: all methods return false/null on failure — never throw.
 */

import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { VaultBackend } from "./types.js";
import { isValidKey } from "./vault-utils.js";

// =============================================================================
// Constants
// =============================================================================

const AUTH_DIR = join(homedir(), ".centient", "auth");

// =============================================================================
// Helpers
// =============================================================================

/**
 * Returns the path to the GPG-encrypted credential file for the given key.
 */
function credentialPath(key: string): string {
  return join(AUTH_DIR, `credentials-${key}.gpg`);
}

/**
 * Ensures ~/.centient/auth/ exists.
 */
function ensureAuthDir(): void {
  mkdirSync(AUTH_DIR, { recursive: true });
}

/**
 * Parses `gpg --list-keys --with-colons` output and returns the fingerprint
 * of the first available public key, or null if none found.
 */
function getFirstGpgKeyId(): string | null {
  try {
    const output = execFileSync(
      "gpg",
      ["--list-keys", "--with-colons"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.startsWith("fpr:")) {
        // fpr lines have the fingerprint in the 10th colon-delimited field (index 9)
        const parts = line.split(":");
        const fingerprint = parts[9];
        if (!fingerprint || !/^[0-9A-Fa-f]{40}$/.test(fingerprint.trim())) continue;
        if (fingerprint && fingerprint.trim().length > 0) {
          return fingerprint.trim();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// GpgVault
// =============================================================================

/**
 * Vault backend that stores credentials as GPG-encrypted files.
 *
 * Use `GpgVault.detect()` before instantiating to verify availability.
 */
export class GpgVault implements VaultBackend {
  /**
   * Returns true if GPG is installed and at least one public key is available.
   */
  static detect(): boolean {
    try {
      execFileSync("which", ["gpg"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return false;
    }
    return getFirstGpgKeyId() !== null;
  }

  /**
   * Encrypts and stores `value` under `key` using the first available GPG key.
   *
   * @returns true on success, false if GPG is unavailable or encryption fails
   */
  store(key: string, value: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      const keyId = getFirstGpgKeyId();
      if (keyId === null) return false;

      ensureAuthDir();

      const outPath = credentialPath(key);
      execFileSync(
        "gpg",
        ["--batch", "--yes", "-e", "-r", keyId, "-o", outPath],
        {
          input: value,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decrypts and returns the stored credential for `key`.
   *
   * @returns the plaintext credential, or null if not found / decryption fails
   */
  retrieve(key: string): string | null {
    if (!isValidKey(key)) return null;
    try {
      const filePath = credentialPath(key);
      const result = execFileSync(
        "gpg",
        ["--batch", "--quiet", "-d", filePath],
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return result ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Deletes the GPG-encrypted credential file for `key`.
   *
   * @returns true if the file was deleted or did not exist, false on unexpected error
   */
  delete(key: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      unlinkSync(credentialPath(key));
      return true;
    } catch (err) {
      // ENOENT means file did not exist — treat as success
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return true;
      }
      return false;
    }
  }

  /**
   * Enumerate credential keys stored as `credentials-<key>.gpg` files in
   * `~/.centient/auth/`.
   *
   * Missing directory -> empty list (nothing stored yet). Any other
   * filesystem error (e.g. EACCES) is propagated so the caller can retry
   * or surface the problem, per the VaultBackend contract.
   */
  async listKeys(prefix?: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = readdirSync(AUTH_DIR);
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw err;
    }

    const keys: string[] = [];
    for (const entry of entries) {
      const match = /^credentials-(.+)\.gpg$/.exec(entry);
      if (match === null || match[1] === undefined) continue;
      const key = match[1];
      if (prefix !== undefined && !key.startsWith(prefix)) continue;
      keys.push(key);
    }
    return keys;
  }
}
