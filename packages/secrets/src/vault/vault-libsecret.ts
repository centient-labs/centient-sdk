/**
 * Auth Vault — Credential Storage (Linux libsecret via secret-tool)
 *
 * Provides secure storage for auth tokens on Linux systems using the
 * GNOME libsecret service via the `secret-tool` CLI. Credentials are
 * stored under a fixed service attribute (`centient`) and a per-key
 * attribute (`key`).
 *
 * Error handling: all functions return null/false on failure — never throw.
 */

import { execSync } from "child_process";
import type { VaultBackend } from "./types.js";
import { isValidKey } from "./vault-utils.js";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_ATTR = "centient";
const LABEL = "centient-auth";

// =============================================================================
// LibsecretVault
// =============================================================================

/**
 * Vault backend that uses the `secret-tool` CLI to interact with the
 * system's libsecret / GNOME Keyring service on Linux.
 *
 * Usage:
 *   if (LibsecretVault.detect()) {
 *     const vault = new LibsecretVault();
 *     vault.store("auth-token", token);
 *   }
 */
export class LibsecretVault implements VaultBackend {
  /**
   * Returns true if `secret-tool` is available on this system.
   * Uses `which secret-tool` — returns false if not found or command fails.
   */
  static detect(): boolean {
    try {
      execSync("which secret-tool", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store a credential value in the libsecret keyring.
   *
   * @param key   - Logical key name (e.g. 'auth-token', 'refresh-token')
   * @param value - The credential value to store (passed via stdin)
   * @returns true on success, false if the write fails
   */
  store(key: string, value: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      execSync(
        `secret-tool store --label "${LABEL}" service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          input: value,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve a credential value from the libsecret keyring.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns The stored value, or null if not found / lookup fails
   */
  retrieve(key: string): string | null {
    if (!isValidKey(key)) return null;
    try {
      const result = execSync(
        `secret-tool lookup service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const trimmed = result.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Delete a credential from the libsecret keyring.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns true on success (including "already deleted"), false on unexpected error
   */
  delete(key: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      execSync(
        `secret-tool clear service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return true;
    } catch {
      // secret-tool clear exits 0 even if item does not exist;
      // any non-zero exit indicates an unexpected error — still return true
      // to match the "already deleted" semantic of other backends.
      return true;
    }
  }

  /**
   * Enumerate credential keys stored under the `centient` service in
   * libsecret.
   *
   * Primary path: connects to the session D-Bus and calls the
   * `org.freedesktop.secrets` SearchItems API, which returns item
   * object paths without decrypting secret values — eliminating the
   * transient in-process exposure that the old `secret-tool search
   * --all` approach had.
   *
   * Fallback: if the D-Bus connection fails (e.g. SSH session without
   * `DBUS_SESSION_BUS_ADDRESS`, headless server), falls back to
   * `secret-tool search --all` and parses `attribute.key` lines.
   * The fallback still briefly materializes secret values on stdout;
   * the JSDoc on the `secret-tool` path in the fallback documents
   * this trade-off.
   *
   * No results -> empty list. A transient failure from both paths is
   * propagated per the VaultBackend contract so the caller can retry.
   */
  async listKeys(prefix?: string): Promise<string[]> {
    try {
      return await this.listKeysViaDbus(prefix);
    } catch {
      return this.listKeysViaSecretTool(prefix);
    }
  }

  /**
   * D-Bus primary path for listKeys — no secret values cross process
   * memory. Uses dynamic import so `dbus-next` is only loaded on
   * Linux when actually needed.
   */
  private async listKeysViaDbus(prefix?: string): Promise<string[]> {
    const dbus = await import("dbus-next");
    const bus = dbus.sessionBus();

    try {
      const serviceObj = await bus.getProxyObject(
        "org.freedesktop.secrets",
        "/org/freedesktop/secrets",
      );
      // dbus-next generates method stubs dynamically from introspection —
      // TypeScript cannot know about SearchItems / Get at compile time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = serviceObj.getInterface("org.freedesktop.Secret.Service") as any;

      const [unlocked, locked] = await service.SearchItems(
        { service: SERVICE_ATTR },
      ) as [string[], string[]];

      const allPaths = [...unlocked, ...locked];
      const keys: string[] = [];

      for (const itemPath of allPaths) {
        const itemObj = await bus.getProxyObject(
          "org.freedesktop.secrets",
          itemPath,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = itemObj.getInterface("org.freedesktop.DBus.Properties") as any;
        const attrs = await props.Get(
          "org.freedesktop.Secret.Item",
          "Attributes",
        ) as { value: Array<[{ value: string }, { value: string }]> };

        let keyVal: string | undefined;
        for (const [attrName, attrValue] of attrs.value) {
          if (attrName.value === "key") {
            keyVal = attrValue.value;
            break;
          }
        }
        if (keyVal === undefined) continue;
        if (prefix !== undefined && !keyVal.startsWith(prefix)) continue;
        keys.push(keyVal);
      }

      return keys;
    } finally {
      bus.disconnect();
    }
  }

  /**
   * Fallback: parse `secret-tool search --all` output. Secret values
   * are emitted on stdout by secret-tool and briefly live in the Node
   * string buffer before GC — only `attribute.key` lines are parsed,
   * but the transient exposure exists.
   */
  private listKeysViaSecretTool(prefix?: string): string[] {
    let output: string;
    try {
      output = execSync(
        `secret-tool search --all service ${SERVICE_ATTR}`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 1) return [];
      throw err;
    }

    const keys: string[] = [];
    for (const line of output.split("\n")) {
      const match = /^attribute\.key\s*=\s*(.+)$/.exec(line);
      if (match === null || match[1] === undefined) continue;
      const key = match[1].trim();
      if (key.length === 0) continue;
      if (prefix !== undefined && !key.startsWith(prefix)) continue;
      keys.push(key);
    }
    return keys;
  }
}
