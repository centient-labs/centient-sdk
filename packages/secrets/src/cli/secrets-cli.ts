/**
 * Secrets CLI Commands
 *
 * CLI commands for managing the encrypted secrets vault and environments.
 * These commands are only available to human operators (blocked from AI agents).
 *
 * Vault Commands:
 *   centient secrets init              Initialize a new encrypted vault
 *   centient secrets unlock            Unlock the vault (prompts biometric)
 *   centient secrets lock              Lock the vault
 *   centient secrets list              List secret names in the encrypted file vault (~/.centient/secrets/vault.enc)
 *   centient secrets list-backend-keys List keys in the active vault backend (keychain/libsecret/etc.) — used by library consumers
 *   centient secrets set <name>        Add/update a secret (prompts for value)
 *   centient secrets get <name>        Get a secret value
 *   centient secrets delete <name>     Delete a secret
 *   centient secrets status            Show vault status
 *   centient secrets migrate <provider> Migrate vault key to a different provider
 *
 * Environment Commands:
 *   centient secrets env-list          List all environments
 *   centient secrets env-switch <name> Switch to an environment
 *   centient secrets env-create <name> Create a new environment
 *   centient secrets env-current       Show current environment
 *
 * Security:
 *   - All commands check for AI agent environment and refuse to run
 *   - Vault is encrypted with AES-256-GCM
 *   - Key stored via pluggable provider (macOS Keychain or 1Password)
 *   - 4-hour session timeout
 */

import { createInterface } from "readline";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

// =============================================================================
// Types
// =============================================================================

export interface SecretsOptions {
  command:
    | "init"
    | "unlock"
    | "lock"
    | "list"
    | "list-backend-keys"
    | "set"
    | "get"
    | "delete"
    | "status"
    | "migrate"
    | "env-list"
    | "env-switch"
    | "env-create"
    | "env-current";
  secretName?: string;
  secretValue?: string;
  /** Optional prefix filter for `list-backend-keys`. */
  prefix?: string;
  /** Output JSON instead of human-readable text (`list-backend-keys --json`). */
  json?: boolean;
}

// =============================================================================
// Agent Detection (Local Implementation)
// =============================================================================

/**
 * Check if running in an AI agent environment.
 * If detected, refuse to run secrets commands.
 */
function isAgentEnvironment(): boolean {
  return !!(
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.MCP_CONTEXT ||
    process.env.CLAUDE_CODE_SESSION ||
    process.env.CLAUDE_CODE_ENTRY_POINT
  );
}

// =============================================================================
// Simple Encrypted Vault
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import {
  encryptObject,
  decryptObject,
} from "../crypto/vault-common.js";
import {
  resolveKeyProvider,
  getProviderByType,
  loadConfig,
  saveSecretsConfig,
} from "../key-providers/index.js";
import type { KeyProvider, KeyProviderType } from "../key-providers/types.js";
import { listCredentials, getActiveVaultType } from "../vault/vault.js";

const VAULT_PATH = join(homedir(), ".centient", "secrets", "vault.enc");
const KEY_LENGTH = 32;

// Session state
let sessionKey: Buffer | null = null;
let sessionUnlockedAt: number | null = null;
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

function isSessionValid(): boolean {
  if (!sessionKey || !sessionUnlockedAt) return false;
  return Date.now() - sessionUnlockedAt < SESSION_TTL;
}

function encrypt(data: Record<string, string>, key: Buffer): Buffer {
  const result = encryptObject(data as Record<string, unknown>, key);
  if (!result) throw new Error("Encryption failed");
  return result;
}

function decrypt(data: Buffer, key: Buffer): Record<string, string> | null {
  const parsed = decryptObject(data, key);
  if (!parsed) return null;
  // Validate all values are strings
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") return null;
    result[k] = v;
  }
  return result;
}

/**
 * Resolve the active key provider, printing an error if unavailable.
 */
function getProvider(): KeyProvider | null {
  const result = resolveKeyProvider();
  if (!result.ok) {
    console.error(`❌ ${result.error.message}`);
    return null;
  }
  return result.provider;
}

// =============================================================================
// CLI Handlers
// =============================================================================

import {
  advanceHiddenInput,
  createHiddenInputState,
  ENABLE_BRACKETED_PASTE,
  DISABLE_BRACKETED_PASTE,
} from "./hidden-input.js";

/**
 * Prompt for input (with optional hidden mode for passwords/secrets).
 *
 * Handles three input shapes correctly:
 *   1. **Piped stdin** (`echo "value" | centient secrets set ...`): reads the
 *      full stream to EOF, trims a single trailing newline (pipe artifact).
 *      Multi-line values pass through unchanged.
 *   2. **Interactive TTY with bracketed paste**: content wrapped in
 *      `\x1b[200~ ... \x1b[201~` is treated atomically; newlines inside a
 *      paste are literal content, not submit signals.
 *   3. **Interactive TTY without bracketed paste**: a single newline still
 *      submits (preserves single-line UX), and Ctrl-D is an escape hatch for
 *      submitting multi-line content on terminals that don't emit paste
 *      brackets.
 *
 * Regression hook for issue #37: the previous implementation resolved on the
 * first `\n` from a terminal paste and silently truncated PEM keys / other
 * multi-line secrets to their first line. The parsing state machine lives in
 * `./hidden-input.ts` so it can be unit-tested without stubbing process.stdin.
 */
async function prompt(message: string, hidden = false): Promise<string> {
  // Non-TTY stdin: don't touch raw mode, don't use readline. Read the whole
  // stream to EOF. This is the path for `cat key.pem | centient secrets set`
  // and the pattern most CLIs use for piped-value workflows.
  if (!process.stdin.isTTY) {
    process.stdout.write(message);
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    // Strip a single trailing newline — pipes and `<<<` heredocs typically
    // append one. Preserve any other trailing whitespace (matters for PEM).
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(message);
      const state = createHiddenInputState();

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode?.(true);
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      stdin.resume();
      stdin.setEncoding("utf8");

      const finish = (): void => {
        process.stdout.write(DISABLE_BRACKETED_PASTE);
        stdin.setRawMode?.(wasRaw || false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(state.input);
      };

      // Terminals can deliver a paste as one large chunk OR as many small
      // chunks; the state machine processes character-by-character so
      // escape-sequence state survives across chunk boundaries.
      const onData = (chunk: string): void => {
        const signal = advanceHiddenInput(state, chunk);
        if (signal === "ctrl-c") process.exit(0);
        if (signal === "submit") finish();
      };

      stdin.on("data", onData);
    } else {
      rl.question(message, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Initialize a new vault
 */
async function initVault(): Promise<void> {
  process.stdout.write("\n🔐 Initializing Centient Secrets Vault\n\n");

  if (existsSync(VAULT_PATH)) {
    const confirm = await prompt(
      "⚠️  Vault already exists. Overwrite? (yes/no): ",
    );
    if (confirm.toLowerCase() !== "yes") {
      process.stdout.write("Aborted.\n");
      return;
    }
  }

  // Generate key
  const key = randomBytes(KEY_LENGTH);

  // Store via key provider
  const provider = getProvider();
  if (!provider) return;
  process.stdout.write(`Storing encryption key via ${provider.name}...\n`);
  if (!provider.storeKey(key)) {
    console.error(`❌ Failed to store key via ${provider.name}`);
    return;
  }

  // Create empty vault
  const secrets: Record<string, string> = {};
  const encrypted = encrypt(secrets, key);

  // Ensure directory exists
  const dir = join(homedir(), ".centient", "secrets");
  mkdirSync(dir, { recursive: true });

  // Write vault
  writeFileSync(VAULT_PATH, encrypted);

  // Set session
  sessionKey = key;
  sessionUnlockedAt = Date.now();

  process.stdout.write("\n✅ Vault initialized successfully!\n");
  process.stdout.write(`   Location: ${VAULT_PATH}\n`);
  process.stdout.write("   The vault is now unlocked. Use 'centient secrets set' to add secrets.\n\n");
}

/**
 * Unlock the vault
 */
async function unlockVault(): Promise<boolean> {
  process.stdout.write("\n🔓 Unlocking vault...\n\n");

  if (!existsSync(VAULT_PATH)) {
    console.error("❌ Vault not found. Run 'centient secrets init' first.");
    return false;
  }

  // Get key from provider (may prompt for biometric/PIN depending on provider)
  const provider = getProvider();
  if (!provider) return false;
  process.stdout.write(`Retrieving key via ${provider.name}...\n`);
  const key = provider.getKey();

  if (!key) {
    console.error(`❌ Failed to retrieve key from ${provider.name}`);
    return false;
  }

  // Verify key works
  const data = readFileSync(VAULT_PATH);
  const secrets = decrypt(data, key);

  if (!secrets) {
    console.error("❌ Failed to decrypt vault - key may be incorrect");
    return false;
  }

  // Set session
  sessionKey = key;
  sessionUnlockedAt = Date.now();

  process.stdout.write("✅ Vault unlocked successfully!\n");
  process.stdout.write(`   Session valid for 4 hours.\n\n`);
  return true;
}

/**
 * Lock the vault
 */
function lockVault(): void {
  if (sessionKey) {
    sessionKey.fill(0);
  }
  sessionKey = null;
  sessionUnlockedAt = null;
  process.stdout.write("\n🔒 Vault locked.\n\n");
}

/**
 * List secrets
 */
async function listSecrets(): Promise<void> {
  if (!isSessionValid()) {
    process.stdout.write("\n🔒 Vault is locked. Unlocking...\n");
    if (!(await unlockVault())) return;
  }

  const data = readFileSync(VAULT_PATH);
  const secrets = decrypt(data, sessionKey!);

  if (!secrets) {
    console.error("❌ Failed to decrypt vault");
    return;
  }

  const names = Object.keys(secrets).sort();
  process.stdout.write(`\n📋 Secrets in vault (${names.length}):\n\n`);

  if (names.length === 0) {
    process.stdout.write("   (empty - use 'centient secrets set <name>' to add secrets)\n");
  } else {
    for (const name of names) {
      const value = secrets[name] ?? "";
      const preview = value.length > 0 ? "•".repeat(Math.min(value.length, 20)) : "(empty)";
      process.stdout.write(`   ${name.padEnd(30)} ${preview}\n`);
    }
  }
  process.stdout.write("\n");
}

/**
 * List keys stored in the active vault backend (keychain, libsecret,
 * Windows Credential Manager, GPG file vault, or env var).
 *
 * This is distinct from `listSecrets`, which reads the encrypted file
 * vault at `~/.centient/secrets/vault.enc`. The two storage paths are
 * separate in this release.
 */
async function listBackendKeys(
  prefix?: string,
  json?: boolean,
): Promise<void> {
  let keys: string[];
  try {
    keys = await listCredentials(prefix);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      process.stdout.write(JSON.stringify({ error: message }) + "\n");
    } else {
      console.error(`❌ Failed to enumerate backend keys: ${message}`);
    }
    process.exit(1);
  }

  const sorted = [...keys].sort();

  if (json) {
    process.stdout.write(JSON.stringify(sorted) + "\n");
    return;
  }

  const backendType = getActiveVaultType();
  const header = prefix !== undefined
    ? `\n🔑 Backend keys (${backendType}, prefix "${prefix}"):\n\n`
    : `\n🔑 Backend keys (${backendType}):\n\n`;
  process.stdout.write(header);

  if (sorted.length === 0) {
    process.stdout.write("   (no keys)\n\n");
    return;
  }

  for (const key of sorted) {
    process.stdout.write(`   ${key}\n`);
  }
  process.stdout.write(`\n(${sorted.length} ${sorted.length === 1 ? "key" : "keys"})\n\n`);
}

/**
 * Set a secret
 */
async function setSecret(name: string): Promise<void> {
  if (!name) {
    console.error("❌ Secret name required. Usage: centient secrets set <name>");
    return;
  }

  if (!isSessionValid()) {
    process.stdout.write("\n🔒 Vault is locked. Unlocking...\n");
    if (!(await unlockVault())) return;
  }

  const data = readFileSync(VAULT_PATH);
  const secrets = decrypt(data, sessionKey!);

  if (!secrets) {
    console.error("❌ Failed to decrypt vault");
    return;
  }

  const exists = name in secrets;
  const action = exists ? "update" : "add";

  process.stdout.write(`\n${exists ? "✏️  Updating" : "➕ Adding"} secret: ${name}\n\n`);

  const value = await prompt(`Enter value for ${name}: `, true);

  if (!value) {
    process.stdout.write("Aborted - empty value.\n");
    return;
  }

  secrets[name] = value;

  // Re-encrypt and save
  const encrypted = encrypt(secrets, sessionKey!);
  writeFileSync(VAULT_PATH, encrypted);

  process.stdout.write(`\n✅ Secret '${name}' ${action}d successfully!\n\n`);
}

/**
 * Get a secret
 */
async function getSecret(name: string): Promise<void> {
  if (!name) {
    console.error("❌ Secret name required. Usage: centient secrets get <name>");
    return;
  }

  if (!isSessionValid()) {
    process.stdout.write("\n🔒 Vault is locked. Unlocking...\n");
    if (!(await unlockVault())) return;
  }

  const data = readFileSync(VAULT_PATH);
  const secrets = decrypt(data, sessionKey!);

  if (!secrets) {
    console.error("❌ Failed to decrypt vault");
    return;
  }

  if (!(name in secrets)) {
    console.error(`❌ Secret '${name}' not found`);
    return;
  }

  // Print without newline for piping
  const secretValue = secrets[name];
  if (secretValue !== undefined) {
    process.stdout.write(secretValue);
  }
  process.stdout.write("\n");
}

/**
 * Delete a secret
 */
async function deleteSecret(name: string): Promise<void> {
  if (!name) {
    console.error("❌ Secret name required. Usage: centient secrets delete <name>");
    return;
  }

  if (!isSessionValid()) {
    process.stdout.write("\n🔒 Vault is locked. Unlocking...\n");
    if (!(await unlockVault())) return;
  }

  const data = readFileSync(VAULT_PATH);
  const secrets = decrypt(data, sessionKey!);

  if (!secrets) {
    console.error("❌ Failed to decrypt vault");
    return;
  }

  if (!(name in secrets)) {
    console.error(`❌ Secret '${name}' not found`);
    return;
  }

  const confirm = await prompt(`Delete secret '${name}'? (yes/no): `);
  if (confirm.toLowerCase() !== "yes") {
    process.stdout.write("Aborted.\n");
    return;
  }

  delete secrets[name];

  // Re-encrypt and save
  const encrypted = encrypt(secrets, sessionKey!);
  writeFileSync(VAULT_PATH, encrypted);

  process.stdout.write(`\n✅ Secret '${name}' deleted.\n\n`);
}

/**
 * List all environments
 */
async function listEnvironments(): Promise<void> {
  const { EnvironmentManager } = await import("../environment/EnvironmentManager.js");
  const manager = new EnvironmentManager();

  const result = manager.listEnvironments();
  if (!result.success) {
    console.error(`\n❌ ${result.message}\n`);
    return;
  }

  const environments = result.environments;
  process.stdout.write(`\n🌍 Environments (${environments.length}):\n\n`);

  if (environments.length === 0) {
    process.stdout.write("   (no environments found)\n");
    process.stdout.write("   Run 'centient secrets env-create <name>' to create one.\n\n");
    return;
  }

  for (const env of environments) {
    const current = env.isActive ? " ← current" : "";
    const vault = env.hasVault ? " [vault]" : "";
    process.stdout.write(`   ${env.isActive ? "●" : "○"} ${env.name}${vault}${current}\n`);
  }
  process.stdout.write("\n");
}

/**
 * Switch to a different environment
 */
async function switchEnvironment(name: string): Promise<void> {
  if (!name) {
    console.error("❌ Environment name required. Usage: centient secrets env-switch <name>");
    return;
  }

  const { EnvironmentManager } = await import("../environment/EnvironmentManager.js");
  const manager = new EnvironmentManager();

  const result = manager.switchEnvironment(name);
  if (!result.success) {
    console.error(`\n❌ ${result.message}\n`);
    if (result.nextAction) {
      process.stdout.write(`   ${result.nextAction}\n\n`);
    }
    return;
  }

  process.stdout.write(`\n✅ ${result.message}\n\n`);
}

/**
 * Create a new environment
 */
async function createEnvironment(name: string): Promise<void> {
  if (!name) {
    console.error("❌ Environment name required. Usage: centient secrets env-create <name>");
    return;
  }

  const { EnvironmentManager } = await import("../environment/EnvironmentManager.js");
  const manager = new EnvironmentManager();

  const result = manager.createEnvironment(name);
  if (!result.success) {
    console.error(`\n❌ ${result.message}\n`);
    return;
  }

  process.stdout.write(`\n✅ ${result.message}\n`);

  if (result.nextAction) {
    process.stdout.write(`   ${result.nextAction}\n\n`);
  } else {
    process.stdout.write("\n");
  }
}

/**
 * Show current environment
 */
async function showCurrentEnvironment(): Promise<void> {
  const { EnvironmentManager } = await import("../environment/EnvironmentManager.js");
  const manager = new EnvironmentManager();

  const currentName = manager.getCurrentEnvironment();
  if (!currentName) {
    process.stdout.write("\n🌍 No environment is currently active.\n\n");
    process.stdout.write("   Run 'centient secrets env-list' to see available environments.\n");
    process.stdout.write("   Run 'centient secrets env-create <name>' to create one.\n\n");
    return;
  }

  const env = manager.getEnvironment(currentName);
  if (!env) {
    console.error(`\n❌ Failed to load environment '${currentName}'\n`);
    return;
  }

  process.stdout.write(`\n🌍 Current Environment: ${env.name}\n\n`);
  process.stdout.write("\u2500".repeat(40) + "\n");

  process.stdout.write(`Path:         ${env.path}\n`);
  process.stdout.write(`Has Config:   ${env.hasConfig ? "✅ yes" : "❌ no"}\n`);
  process.stdout.write(`Has Vault:    ${env.hasVault ? "✅ yes" : "❌ no"}\n`);
  if (env.lastModified) {
    process.stdout.write(`Modified:     ${env.lastModified.toLocaleString()}\n`);
  }

  process.stdout.write("\u2500".repeat(40) + "\n");
  process.stdout.write("\n");
}

/**
 * Show vault status
 */
async function showStatus(): Promise<void> {
  process.stdout.write("\n📊 Vault Status\n\n");
  process.stdout.write("\u2500".repeat(40) + "\n");

  // Check vault exists
  const vaultExists = existsSync(VAULT_PATH);
  process.stdout.write(`Vault file:     ${vaultExists ? "✅ exists" : "❌ not found"}\n`);
  process.stdout.write(`Location:       ${VAULT_PATH}\n`);

  // Check session
  const sessionValid = isSessionValid();
  process.stdout.write(`Session:        ${sessionValid ? "🔓 unlocked" : "🔒 locked"}\n`);

  if (sessionValid && sessionUnlockedAt) {
    const remaining = SESSION_TTL - (Date.now() - sessionUnlockedAt);
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    process.stdout.write(`Expires in:     ${hours}h ${minutes}m\n`);
  }

  // Check key provider
  const providerResult = resolveKeyProvider();
  if (providerResult.ok) {
    const hasKey = providerResult.provider.getKey() !== null;
    process.stdout.write(`Key provider:   ${providerResult.provider.name} (${providerResult.method})\n`);
    process.stdout.write(`Stored key:     ${hasKey ? "✅ found" : "❌ not found"}\n`);
  } else {
    process.stdout.write(`Key provider:   ❌ unavailable\n`);
  }

  // Count secrets if unlocked
  if (sessionValid && vaultExists) {
    const data = readFileSync(VAULT_PATH);
    const secrets = decrypt(data, sessionKey!);
    if (secrets) {
      process.stdout.write(`Secrets count:  ${Object.keys(secrets).length}\n`);
    }
  }

  process.stdout.write("\u2500".repeat(40) + "\n");
  process.stdout.write("\n");
}

// =============================================================================
// Migration
// =============================================================================

/**
 * Migrate the vault key from the current provider to a different one.
 * The vault file itself is unchanged — only the key storage location moves.
 */
async function migrateProvider(targetType: string): Promise<void> {
  if (!targetType) {
    console.error("❌ Target provider required. Usage: centient secrets migrate <provider>");
    console.error("   Supported providers: keychain, 1password");
    return;
  }

  const validTypes: KeyProviderType[] = ["keychain", "1password"];
  if (!validTypes.includes(targetType as KeyProviderType)) {
    console.error(`❌ Unknown provider "${targetType}". Supported: ${validTypes.join(", ")}`);
    return;
  }

  const target = targetType as KeyProviderType;

  // Resolve current provider
  const currentResult = resolveKeyProvider();
  if (!currentResult.ok) {
    console.error(`❌ ${currentResult.error.message}`);
    return;
  }

  const source = currentResult.provider;

  if (source.name === target) {
    process.stdout.write(`\n✅ Already using ${target} as key provider.\n\n`);
    return;
  }

  process.stdout.write(`\n🔄 Migrating vault key: ${source.name} → ${target}\n\n`);

  // Read key from source
  process.stdout.write(`Reading key from ${source.name}...\n`);
  const key = source.getKey();
  if (!key) {
    console.error(`❌ Failed to read key from ${source.name}`);
    return;
  }

  // Create target provider
  const config = loadConfig();
  const targetProvider = getProviderByType(target, config.secrets);
  if (!targetProvider) {
    console.error(`❌ Provider "${target}" is not available on this system.`);
    if (target === "1password") {
      console.error("   Install the 1Password CLI (`op`) and sign in or set OP_SERVICE_ACCOUNT_TOKEN.");
    }
    return;
  }

  // Store in target
  process.stdout.write(`Storing key in ${target}...\n`);
  if (!targetProvider.storeKey(key)) {
    console.error(`❌ Failed to store key in ${target}`);
    return;
  }

  // Verify round-trip
  process.stdout.write("Verifying...\n");
  const verify = targetProvider.getKey();
  if (!verify || !key.equals(verify)) {
    console.error("❌ Verification failed — key read back from target does not match");
    return;
  }

  // Update config
  const secretsConfig = { ...config.secrets, provider: target };
  if (!saveSecretsConfig(secretsConfig)) {
    console.error("❌ Key migrated but failed to update ~/.centient/config.json");
    console.error(`   Manually set secrets.provider to "${target}" in the config file.`);
    return;
  }

  process.stdout.write(`\n✅ Migration complete. Provider set to "${target}".\n`);
  process.stdout.write(`   The key in ${source.name} was not removed. You can delete it manually if desired.\n\n`);
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Run secrets command
 */
export async function runSecrets(options: SecretsOptions): Promise<void> {
  // Security: Block AI agents
  if (isAgentEnvironment()) {
    console.error("\n❌ Secrets commands are not available to AI agents.");
    console.error("   This is a security measure to protect your secrets.\n");
    process.exit(1);
  }

  switch (options.command) {
    case "init":
      await initVault();
      break;
    case "unlock":
      await unlockVault();
      break;
    case "lock":
      lockVault();
      break;
    case "list":
      await listSecrets();
      break;
    case "list-backend-keys":
      await listBackendKeys(options.prefix, options.json);
      break;
    case "set":
      await setSecret(options.secretName || "");
      break;
    case "get":
      await getSecret(options.secretName || "");
      break;
    case "delete":
      await deleteSecret(options.secretName || "");
      break;
    case "status":
      await showStatus();
      break;
    case "migrate":
      await migrateProvider(options.secretName || "");
      break;
    case "env-list":
      await listEnvironments();
      break;
    case "env-switch":
      await switchEnvironment(options.secretName || "");
      break;
    case "env-create":
      await createEnvironment(options.secretName || "");
      break;
    case "env-current":
      await showCurrentEnvironment();
      break;
    default:
      console.error(`Unknown secrets command: ${options.command}`);
      console.error("Available: init, unlock, lock, list, list-backend-keys, set, get, delete, status, migrate, env-list, env-switch, env-create, env-current");
      process.exit(1);
  }
}
