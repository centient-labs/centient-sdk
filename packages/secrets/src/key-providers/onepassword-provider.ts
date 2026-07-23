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
 * shells out to `op read` / `op item create` / `op item edit` through the
 * shared `op-cli.ts` helper (ADR-004 §6), which it co-owns with the
 * credential-value backend `OnePasswordVault`.
 *
 * No dependency on @1password/sdk — `execFileSync` only.
 *
 * **Known gap (#102):** `createItem`/`updateItem` still pass `password=<hex>` in
 * **argv**, so the vault key is visible in `ps` for the life of the call. The
 * argv-safe replacement is the stdin pattern ADR-004 §4 specifies and
 * `OnePasswordVault.store` already uses — `runOp`'s `input` option is the seam
 * for it. Retrofitting this provider is tracked separately in #102 and is
 * deliberately not folded in here.
 */

import type { KeyProvider, KeyProviderType, OnePasswordConfig } from "./types.js";
import {
  detectOpCli,
  runOp,
  OP_READ_TIMEOUT_MS,
  OP_WRITE_TIMEOUT_MS,
} from "./op-cli.js";

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
    return detectOpCli();
  }

  getKey(): Buffer | null {
    try {
      const ref = `op://${this.vault}/${this.item}/${FIELD_NAME}`;
      const result = runOp(["read", ref], { timeoutMs: OP_WRITE_TIMEOUT_MS });
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
      runOp(["item", "delete", this.item, "--vault", this.vault], {
        timeoutMs: OP_WRITE_TIMEOUT_MS,
      });
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
      runOp(["item", "get", this.item, "--vault", this.vault, "--format=json"], {
        timeoutMs: OP_READ_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  private createItem(keyHex: string): boolean {
    try {
      runOp(
        [
          "item", "create",
          "--category", "Password",
          "--title", this.item,
          "--vault", this.vault,
          `${FIELD_NAME}=${keyHex}`,
        ],
        { timeoutMs: OP_WRITE_TIMEOUT_MS },
      );
      return true;
    } catch {
      return false;
    }
  }

  private updateItem(keyHex: string): boolean {
    try {
      runOp(
        [
          "item", "edit", this.item,
          "--vault", this.vault,
          `${FIELD_NAME}=${keyHex}`,
        ],
        { timeoutMs: OP_WRITE_TIMEOUT_MS },
      );
      return true;
    } catch {
      return false;
    }
  }
}
