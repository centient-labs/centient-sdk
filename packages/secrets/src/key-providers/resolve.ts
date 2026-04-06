/**
 * Key Provider — Resolution & Configuration
 *
 * Loads provider configuration from ~/.centient/config.json and resolves
 * the appropriate KeyProvider implementation. Supports explicit config
 * and auto-detection fallback.
 *
 * Resolution order:
 *   1. Explicit config (secrets.provider field) — use it; fail if unavailable
 *   2. Auto-detection — 1Password if `op` is available, else Keychain on macOS
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { KeychainProvider } from "./keychain-provider.js";
import { OnePasswordProvider } from "./onepassword-provider.js";
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
export function resolveKeyProvider(): {
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
    return resolveExplicit(secretsConfig.provider, secretsConfig);
  }

  // Auto-detection fallback
  return resolveAuto(secretsConfig);
}

/**
 * Resolve an explicitly configured provider.
 * Fails if the provider is not available on this system.
 */
function resolveExplicit(
  type: KeyProviderType,
  config?: SecretsConfig,
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
      return { ok: true, provider: new KeychainProvider(), method: "config" };
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
    default: {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_PROVIDER",
          message: `Unknown key provider "${type as string}". Supported: keychain, 1password.`,
        },
      };
    }
  }
}

/**
 * Auto-detect the best available provider.
 * Prefers 1Password (enables headless), falls back to Keychain on macOS.
 */
function resolveAuto(
  config?: SecretsConfig,
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
    return { ok: true, provider: new KeychainProvider(), method: "auto" };
  }

  return {
    ok: false,
    error: {
      code: "NO_PROVIDER",
      message:
        "No key provider available. " +
        "Install the 1Password CLI (`op`) for headless support, " +
        "or run on macOS for Keychain support.",
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
): KeyProvider | null {
  switch (type) {
    case "keychain":
      return KeychainProvider.detect() ? new KeychainProvider() : null;
    case "1password":
      return OnePasswordProvider.detect()
        ? new OnePasswordProvider(config?.onePassword)
        : null;
    default:
      return null;
  }
}
