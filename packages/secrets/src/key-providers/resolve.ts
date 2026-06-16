/**
 * Key Provider — Resolution & Configuration
 *
 * Loads provider configuration from ~/.centient/config.json and resolves
 * the appropriate KeyProvider implementation. Supports explicit config
 * and auto-detection fallback.
 *
 * Resolution order:
 *   1. Explicit config (secrets.provider field) — use it; fail if unavailable
 *   2. Auto-detection — 1Password if `op` is available, else Keychain on macOS,
 *      else passphrase when an interactive TTY is available
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { KeychainProvider } from "./keychain-provider.js";
import type { KeychainProviderOptions } from "./keychain-provider.js";
import { OnePasswordProvider } from "./onepassword-provider.js";
import { PassphraseProvider } from "./passphrase-provider.js";
import type {
  KeyProvider,
  KeyProviderType,
  CentientConfig,
  SecretsConfig,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const CONFIG_PATH = join(homedir(), ".centient", "config.json");
const SUPPORTED_PROVIDERS = "keychain, 1password, passphrase";

export interface ResolveKeyProviderOptions {
  /** Vault path used by providers with per-vault metadata. */
  vaultPath?: string;
  /**
   * Per-consumer Keychain item coordinates. When the resolved provider is the
   * macOS Keychain, these name the Keychain item so a consumer can use its own
   * master key (e.g. `{ service: "burnrate-vault" }`) instead of sharing the
   * global `centient-vault`/`vault-key` item with every other consumer on the
   * machine. Omitted/undefined fields fall back to the historical defaults,
   * so the no-options path is byte-identical to before.
   */
  keychain?: KeychainProviderOptions;
}

// =============================================================================
// Config I/O
// =============================================================================

/**
 * Load the global centient config file.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export function loadConfig(): CentientConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as CentientConfig;
  } catch {
    return {};
  }
}

/**
 * Write the global centient config file.
 * Merges the secrets section into any existing config.
 * Returns true on success.
 */
export function saveSecretsConfig(secrets: SecretsConfig): boolean {
  try {
    const existing = loadConfig();
    const merged: CentientConfig = { ...existing, secrets };
    const dir = join(homedir(), ".centient");
    mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Provider Resolution
// =============================================================================

/**
 * Resolve the active KeyProvider based on config and environment.
 *
 * @returns An object with the resolved provider, or an error message
 *          if the explicitly configured provider is unavailable.
 */
export function resolveKeyProvider(options: ResolveKeyProviderOptions = {}): {
  ok: true;
  provider: KeyProvider;
  method: "config" | "auto";
} | {
  ok: false;
  error: { code: string; message: string };
} {
  const config = loadConfig();
  const secretsConfig = config.secrets;

  // Explicit config — honor it strictly
  if (secretsConfig?.provider) {
    return resolveExplicit(secretsConfig.provider, secretsConfig, options);
  }

  // Auto-detection fallback
  return resolveAuto(secretsConfig, options);
}

/**
 * Resolve an explicitly configured provider.
 * Fails if the provider is not available on this system.
 */
function resolveExplicit(
  type: KeyProviderType,
  config?: SecretsConfig,
  options: ResolveKeyProviderOptions = {},
): ReturnType<typeof resolveKeyProvider> {
  switch (type) {
    case "keychain": {
      if (!KeychainProvider.detect()) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message:
              'Key provider "keychain" is configured but macOS Keychain is not available on this platform.',
          },
        };
      }
      return {
        ok: true,
        provider: new KeychainProvider(options.keychain),
        method: "config",
      };
    }
    case "1password": {
      if (!OnePasswordProvider.detect()) {
        const hasToken = !!process.env.OP_SERVICE_ACCOUNT_TOKEN;
        const hint = hasToken
          ? "OP_SERVICE_ACCOUNT_TOKEN is set but the `op` CLI binary was not found in PATH."
          : "Install the 1Password CLI (`op`) and either enable desktop app integration or set OP_SERVICE_ACCOUNT_TOKEN.";
        return {
          ok: false,
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: `Key provider "1password" is configured but not available. ${hint}`,
          },
        };
      }
      return {
        ok: true,
        provider: new OnePasswordProvider(config?.onePassword),
        method: "config",
      };
    }
    case "passphrase": {
      return {
        ok: true,
        provider: new PassphraseProvider({ vaultPath: options.vaultPath }),
        method: "config",
      };
    }
    default: {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_PROVIDER",
          message: `Unknown key provider "${type as string}". Supported: ${SUPPORTED_PROVIDERS}.`,
        },
      };
    }
  }
}

/**
 * Auto-detect the best available provider.
 * Prefers 1Password (enables headless), falls back to Keychain on macOS,
 * then passphrase for interactive headless/Linux operators.
 */
function resolveAuto(
  config?: SecretsConfig,
  options: ResolveKeyProviderOptions = {},
): ReturnType<typeof resolveKeyProvider> {
  // Prefer 1Password if available (enables headless use case)
  if (OnePasswordProvider.detect()) {
    return {
      ok: true,
      provider: new OnePasswordProvider(config?.onePassword),
      method: "auto",
    };
  }

  // Fall back to Keychain on macOS
  if (KeychainProvider.detect()) {
    return {
      ok: true,
      provider: new KeychainProvider(options.keychain),
      method: "auto",
    };
  }

  // Interactive fallback for headless/Linux hosts without OS key storage.
  if (PassphraseProvider.detect()) {
    return {
      ok: true,
      provider: new PassphraseProvider({ vaultPath: options.vaultPath }),
      method: "auto",
    };
  }

  return {
    ok: false,
    error: {
      code: "NO_PROVIDER",
      message:
        "No key provider available. " +
        "Install the 1Password CLI (`op`) for headless support, " +
        "run on macOS for Keychain support, " +
        "or run from an interactive terminal to use the passphrase provider.",
    },
  };
}

/**
 * Get a specific provider by type, regardless of config.
 * Used by the migrate command to construct source/target providers.
 */
export function getProviderByType(
  type: KeyProviderType,
  config?: SecretsConfig,
  options: ResolveKeyProviderOptions = {},
): KeyProvider | null {
  switch (type) {
    case "keychain":
      return KeychainProvider.detect()
        ? new KeychainProvider(options.keychain)
        : null;
    case "1password":
      return OnePasswordProvider.detect()
        ? new OnePasswordProvider(config?.onePassword)
        : null;
    case "passphrase":
      return PassphraseProvider.detect()
        ? new PassphraseProvider({ vaultPath: options.vaultPath })
        : null;
    default:
      return null;
  }
}
