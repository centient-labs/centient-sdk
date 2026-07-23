/**
 * Vault backend — 1Password credential storage (ADR-004).
 *
 * Stores credential **values** in a dedicated 1Password vault via the `op` CLI.
 * This is a different layer from ADR-001's `OnePasswordProvider`, which stores
 * the vault *encryption key*: an operator may keep the key in the Keychain and
 * the credentials in 1Password, or the reverse. The two carry separate config
 * blocks for exactly that reason (ADR-004 §1).
 *
 * ## Two properties this backend exists to hold
 *
 * 1. **Never auto-selected.** `op` being installed must not silently route
 *    credentials into someone's personal vault — surprising secret placement is
 *    a security defect (P15/P2). Selection is explicit opt-in, and
 *    {@link OnePasswordVault.detect} refuses without it.
 * 2. **Secret values never touch argv.** Writes build the item JSON in-process
 *    and pipe it to `op item create -`, so nothing readable in `ps` ever carries
 *    a secret. This is the pattern issue #102 wants retrofitted to the key
 *    provider, which still passes `field=value` on the command line.
 */

import type { VaultBackend } from "./types.js";
import { assertValidKey } from "./vault-utils.js";
import type { OnePasswordBackendConfig } from "../key-providers/types.js";
import {
  detectOpCli,
  runOp,
  OpCliError,
  OP_READ_TIMEOUT_MS,
  OP_WRITE_TIMEOUT_MS,
} from "../key-providers/op-cli.js";

// =============================================================================
// Constants
// =============================================================================

/** Default tag applied to every item this backend writes. */
export const DEFAULT_OP_TAG = "centient";

/** The 1Password field a credential value lives in. */
const FIELD_NAME = "password";

/**
 * List-cache TTL, mirroring `KEYCHAIN_LIST_CACHE_TTL_MS` (ADR-004 §8).
 *
 * Only key **names** are cached, never values: a cached value would both extend
 * how long plaintext sits in the heap and serve a rotated or revoked credential
 * until expiry. 1Password stays the source of truth for values.
 */
export const OP_LIST_CACHE_TTL_MS = 5_000;

// =============================================================================
// Options
// =============================================================================

/** Options for {@link OnePasswordVault}. */
export interface OnePasswordVaultOptions extends OnePasswordBackendConfig {
  /**
   * Injectable clock for the list cache, so tests can drive expiry without
   * sleeping. Defaults to `Date.now`.
   */
  now?: () => number;
}

// =============================================================================
// Implementation
// =============================================================================

export class OnePasswordVault implements VaultBackend {
  private readonly vault: string;
  private readonly tag: string;
  private readonly now: () => number;

  private listCache: { keys: string[]; expiresAt: number } | null = null;
  private warned = false;

  /**
   * @param config - must carry a `vault`; there is deliberately no default
   *   (ADR-004 §1 — guessing a vault name risks writing credentials somewhere
   *   the operator did not intend).
   * @throws {Error} when `vault` is missing or blank.
   */
  constructor(config: OnePasswordVaultOptions) {
    const vault = config.vault?.trim();
    if (!vault) {
      throw new Error(
        'secrets.onePasswordBackend.vault is required when backend is "1password" ' +
          "(or set CENTIENT_OP_VAULT). There is no default vault — see ADR-004 §1.",
      );
    }
    this.vault = vault;
    this.tag = config.tag?.trim() || DEFAULT_OP_TAG;
    this.now = config.now ?? Date.now;
  }

  /**
   * Whether this backend may be used.
   *
   * Requires **both** an explicit opt-in and a usable `op`. The opt-in half is
   * what keeps 1Password out of the auto-cascade: without it this returns false
   * even on a machine where `op` is installed and signed in.
   *
   * @param optedIn - true when config or env explicitly selected this backend.
   */
  static detect(optedIn: boolean): boolean {
    if (!optedIn) return false;
    return detectOpCli();
  }

  /**
   * Write a credential. The value travels on stdin and never appears in argv.
   *
   * Update is modeled as replace (delete-then-create) so create and update share
   * one argv-safe path rather than needing a separate `op item edit` form.
   */
  store(key: string, value: string): boolean {
    assertValidKey(key, "write");

    const item = {
      title: key,
      category: "PASSWORD",
      vault: { name: this.vault },
      tags: [this.tag],
      fields: [{ id: FIELD_NAME, type: "CONCEALED", value }],
    };

    try {
      // Replace semantics: drop any existing item first so `create` is always
      // the write path. delete() is idempotent, so a missing item is fine.
      this.deleteItem(key);
      runOp(["item", "create", "--format=json", "-"], {
        input: JSON.stringify(item),
        timeoutMs: OP_WRITE_TIMEOUT_MS,
      });
      this.invalidateListCache();
      return true;
    } catch (err) {
      this.warnOnce("store", key, err);
      return false;
    }
  }

  /**
   * Read a credential value. Returns null when absent or on failure.
   *
   * @throws {InvalidCredentialKeyError} for a key this backend could never
   *   have written — building an `op://` reference from it is exactly the
   *   misparse the key grammar exists to prevent, and `null` would report the
   *   impossible key as a merely absent one.
   */
  retrieve(key: string): string | null {
    assertValidKey(key, "read");

    try {
      const value = runOp(
        ["read", `op://${this.vault}/${key}/${FIELD_NAME}`],
        { timeoutMs: OP_WRITE_TIMEOUT_MS },
      );
      return value === "" ? null : value;
    } catch (err) {
      this.warnOnce("retrieve", key, err);
      return null;
    }
  }

  /**
   * Delete a credential. Idempotent — a missing item is success.
   *
   * @throws {InvalidCredentialKeyError} — deliberately NOT folded into the
   *   idempotent-success path. "Missing" and "impossible" are different
   *   answers: such a key was never storable here, so reporting success would
   *   assert something about a key this backend does not accept.
   */
  delete(key: string): boolean {
    assertValidKey(key, "delete");

    try {
      this.deleteItem(key);
      this.invalidateListCache();
      return true;
    } catch (err) {
      this.warnOnce("delete", key, err);
      return false;
    }
  }

  /**
   * Enumerate credential keys, optionally prefix-filtered.
   *
   * Per the {@link VaultBackend} contract this returns `[]` for a genuinely
   * empty vault but **throws** on a transient failure, so a caller can tell
   * "nothing stored" from "1Password did not answer" and retry the latter.
   * The `--tags` filter keeps unrelated items in a shared vault out of the
   * result; no secret values appear in `op item list` output.
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const cached = this.readListCache();
    const keys = cached ?? this.fetchKeys();
    if (cached === null) {
      this.listCache = {
        keys,
        expiresAt: this.now() + OP_LIST_CACHE_TTL_MS,
      };
    }
    return prefix === undefined ? [...keys] : keys.filter((k) => k.startsWith(prefix));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private fetchKeys(): string[] {
    let raw: string;
    try {
      raw = runOp(
        ["item", "list", "--vault", this.vault, "--tags", this.tag, "--format=json"],
        { timeoutMs: OP_READ_TIMEOUT_MS },
      );
    } catch (err) {
      // A missing/empty vault is an empty enumeration; anything else is
      // transient and must surface so the caller can retry (contract, §7).
      if (err instanceof OpCliError && err.isNotFound) return [];
      this.warnOnce("listKeys", null, err);
      throw err;
    }

    if (raw === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.warnOnce("listKeys", null, err);
      throw new Error(`op item list returned unparseable JSON: ${String(err)}`);
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) =>
        typeof item === "object" && item !== null
          ? (item as { title?: unknown }).title
          : undefined,
      )
      .filter((title): title is string => typeof title === "string" && title.length > 0);
  }

  // Key validation lives in `assertValidKey` (vault-utils), not in a private
  // `acceptKey` here.
  //
  // #167 had to enforce locally and quietly. This was the first backend where
  // the `op://<vault>/<key>/password` reference made the invariant
  // load-bearing — a key containing `/` stores fine (a 1Password title is just
  // a string) and then re-parses on read into a different item and field — but
  // the shared path enforced nothing, so a loud refusal here would have been
  // this backend alone diverging from the others. The compromise was a
  // warn-once that returned false/null.
  //
  // #168 removed the reason for it. `vault.ts` now rejects a non-conforming
  // key before any backend is reached, and every backend asserts the same
  // grammar with the same typed error. Keeping the warn-once as well would
  // leave two layers enforcing one rule with two different outcomes — a throw
  // from the cascade, a quiet `false`/`null` here — which is the divergence
  // #168 exists to remove. The stderr warning is redundant too:
  // `InvalidCredentialKeyError` names the key, the operation and the reason,
  // and unlike a warning it cannot be missed.

  private deleteItem(key: string): void {
    try {
      runOp(["item", "delete", key, "--vault", this.vault], {
        timeoutMs: OP_WRITE_TIMEOUT_MS,
      });
    } catch (err) {
      // Idempotent: the item not being there is the desired end state.
      if (err instanceof OpCliError && err.isNotFound) return;
      throw err;
    }
  }

  private readListCache(): string[] | null {
    if (this.listCache === null) return null;
    if (this.now() >= this.listCache.expiresAt) {
      this.listCache = null;
      return null;
    }
    return this.listCache.keys;
  }

  private invalidateListCache(): void {
    this.listCache = null;
  }

  /**
   * Surface an unexpected `op` failure once per instance (ADR-004 §7, the
   * libsecret lesson from #121).
   *
   * A not-found is normal and stays quiet. Anything else means we are
   * authenticated but the call still failed — a misconfiguration the operator
   * needs to see, since the non-throwing backend contract would otherwise
   * swallow it entirely. Once per instance keeps a hot loop from flooding
   * stderr while still making the first occurrence visible.
   */
  private warnOnce(op: string, key: string | null, err: unknown): void {
    if (err instanceof OpCliError && err.isNotFound) return;
    if (this.warned) return;
    this.warned = true;
    const target = key === null ? `vault ${this.vault}` : `${this.vault}/${key}`;
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[secrets] WARNING: 1Password backend ${op} failed on ${target}: ${detail}\n` +
        `[secrets] Further 1Password warnings from this instance are suppressed.\n`,
    );
  }
}
