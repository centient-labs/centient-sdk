/**
 * Key Provider — Passphrase
 *
 * Derives the vault encryption key from a human-entered passphrase using a
 * per-vault salt. The passphrase and derived key are never persisted; only
 * non-secret KDF metadata plus a verifier are written beside the vault.
 */

import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, basename, join } from "node:path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { promptHiddenSync } from "../cli/hidden-prompt.js";
import type {
  KeyProvider,
  KeyProviderError,
  KeyProviderType,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

export const PASSPHRASE_METADATA_VERSION = 1;
export const PASSPHRASE_KDF = "scrypt" as const;
export const PASSPHRASE_VERIFIER_ALGORITHM = "hmac-sha256" as const;
export const PASSPHRASE_VERIFIER_CONTEXT = "centient-secrets-passphrase:v1";
export const PASSPHRASE_SALT_LENGTH = 32;
export const DEFAULT_PASSPHRASE_VAULT_PATH = join(
  homedir(),
  ".centient",
  "secrets",
  "vault.enc",
);

export const DEFAULT_PASSPHRASE_KDF_PARAMS: PassphraseKdfParams = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 192 * 1024 * 1024,
};

// =============================================================================
// Types
// =============================================================================

export interface PassphraseKdfParams {
  /** scrypt CPU/memory cost parameter. */
  N: number;
  /** scrypt block size parameter. */
  r: number;
  /** scrypt parallelization parameter. */
  p: number;
  /** Derived key length in bytes. */
  keyLength: number;
  /** Node scrypt memory ceiling in bytes. */
  maxmem: number;
}

export interface PassphraseMetadata {
  version: typeof PASSPHRASE_METADATA_VERSION;
  kdf: typeof PASSPHRASE_KDF;
  params: PassphraseKdfParams;
  salt: string;
  verifier: {
    algorithm: typeof PASSPHRASE_VERIFIER_ALGORITHM;
    value: string;
  };
}

export type PassphrasePrompt = (message: string) => string | null;

export interface PassphraseProviderOptions {
  /** Vault path used to derive the default metadata location. */
  vaultPath?: string;
  /** Explicit metadata file path; primarily useful for tests. */
  metadataPath?: string;
  /** Hidden prompt implementation; tests can inject a deterministic prompt. */
  prompt?: PassphrasePrompt;
  /** KDF params for setup; defaults are intentionally production-cost. */
  params?: PassphraseKdfParams;
}

// =============================================================================
// Path helpers
// =============================================================================

export function passphraseMetadataPathForVault(vaultPath: string): string {
  const name = basename(vaultPath);
  const metadataName = name.endsWith(".enc")
    ? `${name.slice(0, -".enc".length)}.passphrase.json`
    : `${name}.passphrase.json`;
  return join(dirname(vaultPath), metadataName);
}

// =============================================================================
// Implementation
// =============================================================================

export class PassphraseProvider implements KeyProvider {
  readonly name: KeyProviderType = "passphrase";

  private readonly metadataPath: string;
  private readonly prompt: PassphrasePrompt;
  private readonly setupParams: PassphraseKdfParams;
  private lastError: KeyProviderError | null = null;

  constructor(options: PassphraseProviderOptions = {}) {
    this.metadataPath =
      options.metadataPath ??
      passphraseMetadataPathForVault(options.vaultPath ?? DEFAULT_PASSPHRASE_VAULT_PATH);
    this.prompt = options.prompt ?? promptHiddenSync;
    this.setupParams = options.params ?? DEFAULT_PASSPHRASE_KDF_PARAMS;
  }

  /** Returns true when a passphrase can be requested from this process. */
  static detect(): boolean {
    return process.stdin.isTTY === true;
  }

  get metadataFile(): string {
    return this.metadataPath;
  }

  getLastError(): KeyProviderError | null {
    return this.lastError;
  }

  getKey(): Buffer | null {
    this.clearLastError();

    const metadata = this.readMetadata();
    if (metadata === null) return null;

    const passphrase = this.promptForPassphrase("Vault passphrase: ");
    if (passphrase === null) return null;

    const salt = Buffer.from(metadata.salt, "base64");
    const expectedVerifier = Buffer.from(metadata.verifier.value, "base64");

    let key: Buffer;
    try {
      key = derivePassphraseKey(passphrase, salt, metadata.params);
    } catch (err) {
      this.setLastError(
        "KDF_FAILED",
        `Failed to derive passphrase key: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    if (!verifyKey(key, expectedVerifier)) {
      key.fill(0);
      this.setLastError(
        "PASSPHRASE_VERIFICATION_FAILED",
        "Passphrase verification failed. Check the passphrase for this vault and try again.",
      );
      return null;
    }

    return key;
  }

  /**
   * Passphrase providers do not store caller-supplied random keys.
   * Use setupKey() so the vault key is derived from the passphrase.
   */
  storeKey(_key: Buffer): boolean {
    this.setLastError(
      "UNSUPPORTED_OPERATION",
      "Passphrase provider derives the vault key from a typed passphrase and cannot store a caller-supplied key. Use setupKey() during vault initialization.",
    );
    return false;
  }

  /**
   * Initialize passphrase metadata and return the derived key for bootstrap
   * encryption. Only salt, KDF params, and verifier are persisted.
   */
  setupKey(): Buffer | null {
    this.clearLastError();

    const passphrase = this.promptForPassphrase("Create vault passphrase: ");
    if (passphrase === null) return null;
    if (passphrase.length === 0) {
      this.setLastError("EMPTY_PASSPHRASE", "Passphrase cannot be empty.");
      return null;
    }

    const confirmation = this.promptForPassphrase("Confirm vault passphrase: ");
    if (confirmation === null) return null;
    if (passphrase !== confirmation) {
      this.setLastError(
        "PASSPHRASE_MISMATCH",
        "Passphrases did not match; passphrase metadata was not written.",
      );
      return null;
    }

    const salt = randomBytes(PASSPHRASE_SALT_LENGTH);
    let key: Buffer;
    try {
      key = derivePassphraseKey(passphrase, salt, this.setupParams);
    } catch (err) {
      this.setLastError(
        "KDF_FAILED",
        `Failed to derive passphrase key: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const metadata: PassphraseMetadata = {
      version: PASSPHRASE_METADATA_VERSION,
      kdf: PASSPHRASE_KDF,
      params: { ...this.setupParams },
      salt: salt.toString("base64"),
      verifier: {
        algorithm: PASSPHRASE_VERIFIER_ALGORITHM,
        value: createVerifier(key).toString("base64"),
      },
    };

    try {
      mkdirSync(dirname(this.metadataPath), { recursive: true, mode: 0o700 });
      writeFileSync(
        this.metadataPath,
        JSON.stringify(metadata, null, 2) + "\n",
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (err) {
      key.fill(0);
      this.setLastError(
        "METADATA_WRITE_FAILED",
        `Failed to write passphrase metadata at ${this.metadataPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    return key;
  }

  deleteKey(): boolean {
    this.clearLastError();
    try {
      rmSync(this.metadataPath, { force: true });
      return true;
    } catch (err) {
      this.setLastError(
        "METADATA_DELETE_FAILED",
        `Failed to delete passphrase metadata at ${this.metadataPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private readMetadata(): PassphraseMetadata | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.metadataPath, "utf8"));
    } catch (err) {
      const notFound = isNotFoundError(err);
      this.setLastError(
        notFound ? "METADATA_NOT_FOUND" : "METADATA_READ_FAILED",
        notFound
          ? `Passphrase provider is not initialized for this vault. Run \`centient secrets init\` from an interactive terminal, or configure another secrets.provider.`
          : `Failed to read passphrase metadata at ${this.metadataPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const metadata = validateMetadata(parsed);
    if (metadata === null) {
      this.setLastError(
        "METADATA_INVALID",
        `Passphrase metadata at ${this.metadataPath} is invalid or unsupported.`,
      );
      return null;
    }

    return metadata;
  }

  private promptForPassphrase(message: string): string | null {
    try {
      const value = this.prompt(message);
      if (value === null) {
        this.setLastError("PASSPHRASE_INTERRUPTED", "Passphrase entry was interrupted.");
        return null;
      }
      return value;
    } catch (err) {
      this.setLastError(
        "PASSPHRASE_PROMPT_FAILED",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  private clearLastError(): void {
    this.lastError = null;
  }

  private setLastError(code: string, message: string): void {
    this.lastError = { code, message };
  }
}

// =============================================================================
// Crypto helpers
// =============================================================================

export function derivePassphraseKey(
  passphrase: string,
  salt: Buffer,
  params: PassphraseKdfParams = DEFAULT_PASSPHRASE_KDF_PARAMS,
): Buffer {
  return scryptSync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

function createVerifier(key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(PASSPHRASE_VERIFIER_CONTEXT, "utf8")
    .digest();
}

function verifyKey(key: Buffer, expectedVerifier: Buffer): boolean {
  const actualVerifier = createVerifier(key);
  try {
    return (
      actualVerifier.length === expectedVerifier.length &&
      timingSafeEqual(actualVerifier, expectedVerifier)
    );
  } finally {
    actualVerifier.fill(0);
  }
}

function validateMetadata(value: unknown): PassphraseMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.version !== PASSPHRASE_METADATA_VERSION ||
    record.kdf !== PASSPHRASE_KDF ||
    typeof record.salt !== "string"
  ) {
    return null;
  }

  const params = validateParams(record.params);
  if (params === null) return null;

  const verifierRaw = record.verifier;
  if (
    typeof verifierRaw !== "object" ||
    verifierRaw === null ||
    Array.isArray(verifierRaw)
  ) {
    return null;
  }

  const verifier = verifierRaw as Record<string, unknown>;
  if (
    verifier.algorithm !== PASSPHRASE_VERIFIER_ALGORITHM ||
    typeof verifier.value !== "string"
  ) {
    return null;
  }

  const salt = Buffer.from(record.salt, "base64");
  const verifierValue = Buffer.from(verifier.value, "base64");
  if (salt.length < 16 || verifierValue.length !== 32) return null;

  return {
    version: PASSPHRASE_METADATA_VERSION,
    kdf: PASSPHRASE_KDF,
    params,
    salt: record.salt,
    verifier: {
      algorithm: PASSPHRASE_VERIFIER_ALGORITHM,
      value: verifier.value,
    },
  };
}

function validateParams(value: unknown): PassphraseKdfParams | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const params: PassphraseKdfParams = {
    N: Number(record.N),
    r: Number(record.r),
    p: Number(record.p),
    keyLength: Number(record.keyLength),
    maxmem: Number(record.maxmem),
  };

  if (
    !Number.isSafeInteger(params.N) ||
    !Number.isSafeInteger(params.r) ||
    !Number.isSafeInteger(params.p) ||
    !Number.isSafeInteger(params.keyLength) ||
    !Number.isSafeInteger(params.maxmem) ||
    params.N <= 1 ||
    !isPowerOfTwo(params.N) ||
    params.r <= 0 ||
    params.p <= 0 ||
    params.keyLength !== 32 ||
    params.maxmem <= 0
  ) {
    return null;
  }

  return params;
}

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && Math.log2(value) % 1 === 0;
}

function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
