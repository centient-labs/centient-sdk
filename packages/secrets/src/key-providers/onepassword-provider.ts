/**
 * Key Provider — 1Password
 *
 * Stores and retrieves the vault encryption key via the 1Password `op` CLI.
 * Supports three auth modes transparently:
 *
 *   1. Desktop app integration — user has 1Password running with CLI enabled
 *   2. Service account — OP_SERVICE_ACCOUNT_TOKEN env var (headless/CI)
 *   3. CLI session — user ran `op signin` (OP_SESSION_* env var)
 *
 * The `op` CLI handles auth selection internally; this provider just
 * shells out to `op read` / `op item create` / `op item edit`.
 *
 * No dependency on @1password/sdk — uses execFileSync only.
 */

import { execFileSync } from "child_process";
import type { KeyProvider, KeyProviderType, OnePasswordConfig } from "./types.js";

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_VAULT = "Private";
const DEFAULT_ITEM = "centient-vault-key";
const FIELD_NAME = "password";

// =============================================================================
// Implementation
// =============================================================================

export class OnePasswordProvider implements KeyProvider {
  readonly name: KeyProviderType = "1password";
  private readonly vault: string;
  private readonly item: string;

  constructor(config?: OnePasswordConfig) {
    this.vault = config?.vault || DEFAULT_VAULT;
    this.item = config?.item || DEFAULT_ITEM;
  }

  /**
   * Detect whether 1Password CLI is available and authenticated.
   *
   * Returns true if:
   *   - `op` binary is in PATH, AND
   *   - Either OP_SERVICE_ACCOUNT_TOKEN is set, or at least one account
   *     is configured (desktop app / prior sign-in).
   */
  static detect(): boolean {
    // Check op binary exists
    try {
      execFileSync("op", ["--version"], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
    } catch {
      return false;
    }

    // Service account mode — no further checks needed
    if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
      return true;
    }

    // Interactive mode — check for configured accounts
    try {
      const output = execFileSync(
        "op",
        ["account", "list", "--format=json"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
      ).trim();
      // Returns "[]" when no accounts are configured
      return output !== "[]" && output.length > 2;
    } catch {
      return false;
    }
  }

  getKey(): Buffer | null {
    try {
      const ref = `op://${this.vault}/${this.item}/${FIELD_NAME}`;
      const result = execFileSync("op", ["read", ref], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
      }).trim();
      if (!result) return null;
      const buf = Buffer.from(result, "hex");
      // Sanity check: vault key must be exactly 32 bytes
      if (buf.length !== 32) return null;
      return buf;
    } catch {
      return null;
    }
  }

  storeKey(key: Buffer): boolean {
    const keyHex = key.toString("hex");

    // Check if item already exists
    if (this.itemExists()) {
      return this.updateItem(keyHex);
    }
    return this.createItem(keyHex);
  }

  deleteKey(): boolean {
    try {
      execFileSync(
        "op",
        ["item", "delete", this.item, "--vault", this.vault],
        { stdio: ["pipe", "pipe", "pipe"], timeout: 30000 },
      );
      return true;
    } catch {
      // Item may not exist — treat as success
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private itemExists(): boolean {
    try {
      execFileSync(
        "op",
        ["item", "get", this.item, "--vault", this.vault, "--format=json"],
        { stdio: ["pipe", "pipe", "pipe"], timeout: 15000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  private createItem(keyHex: string): boolean {
    try {
      execFileSync(
        "op",
        [
          "item", "create",
          "--category", "Password",
          "--title", this.item,
          "--vault", this.vault,
          `${FIELD_NAME}=${keyHex}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"], timeout: 30000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  private updateItem(keyHex: string): boolean {
    try {
      execFileSync(
        "op",
        [
          "item", "edit", this.item,
          "--vault", this.vault,
          `${FIELD_NAME}=${keyHex}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"], timeout: 30000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
