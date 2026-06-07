import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encrypt } from "../src/crypto/vault-common.js";
import {
  PASSPHRASE_KDF,
  PASSPHRASE_METADATA_VERSION,
  PASSPHRASE_SALT_LENGTH,
  PASSPHRASE_VERIFIER_ALGORITHM,
  PassphraseProvider,
  type PassphraseKdfParams,
  type PassphraseMetadata,
  type PassphrasePrompt,
} from "../src/key-providers/passphrase-provider.js";
import { NON_INTERACTIVE_HIDDEN_PROMPT_MESSAGE } from "../src/cli/hidden-prompt.js";

const TEST_KDF_PARAMS: PassphraseKdfParams = {
  N: 16,
  r: 1,
  p: 1,
  keyLength: 32,
  maxmem: 1024 * 1024,
};

let tmpDir: string;
let metadataPath: string;

function promptFrom(values: string[]): PassphrasePrompt {
  return () => {
    const next = values.shift();
    if (next === undefined) {
      throw new Error("test prompt exhausted");
    }
    return next;
  };
}

function readMetadata(): PassphraseMetadata {
  return JSON.parse(readFileSync(metadataPath, "utf8")) as PassphraseMetadata;
}

function setupProvider(passphrase = "correct horse battery staple"): Buffer {
  const provider = new PassphraseProvider({
    metadataPath,
    params: TEST_KDF_PARAMS,
    prompt: promptFrom([passphrase, passphrase]),
  });
  const key = provider.setupKey();
  if (key === null) {
    throw new Error(provider.getLastError()?.message ?? "setup failed");
  }
  return key;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "passphrase-provider-test-"));
  metadataPath = join(tmpDir, "vault.passphrase.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PassphraseProvider", () => {
  it("derives the same key from the same passphrase and persisted salt", () => {
    const setupKey = setupProvider();
    const encrypted = encrypt("vault payload", setupKey);

    const provider = new PassphraseProvider({
      metadataPath,
      prompt: promptFrom(["correct horse battery staple"]),
    });
    const unlockKey = provider.getKey();

    expect(unlockKey).not.toBeNull();
    expect(unlockKey!.equals(setupKey)).toBe(true);
    expect(decrypt(encrypted, unlockKey!)).toBe("vault payload");

    setupKey.fill(0);
    unlockKey!.fill(0);
  });

  it("rejects a wrong passphrase before returning a garbage key", () => {
    const setupKey = setupProvider();
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: promptFrom(["wrong passphrase"]),
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()).toEqual({
      code: "PASSPHRASE_VERIFICATION_FAILED",
      message: "Passphrase verification failed. Check the passphrase for this vault and try again.",
    });

    setupKey.fill(0);
  });

  it("fails closed when the hidden prompt cannot read from an interactive TTY", () => {
    const setupKey = setupProvider();
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: () => {
        throw new Error(NON_INTERACTIVE_HIDDEN_PROMPT_MESSAGE);
      },
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("PASSPHRASE_PROMPT_FAILED");
    expect(provider.getLastError()?.message).toContain("interactive TTY");

    setupKey.fill(0);
  });

  it("persists only salt, KDF params, and verifier metadata", () => {
    const passphrase = "metadata should not contain this";
    const key = setupProvider(passphrase);
    const metadata = readMetadata();

    expect(metadata.version).toBe(PASSPHRASE_METADATA_VERSION);
    expect(metadata.kdf).toBe(PASSPHRASE_KDF);
    expect(metadata.params).toEqual(TEST_KDF_PARAMS);
    expect(Buffer.from(metadata.salt, "base64")).toHaveLength(PASSPHRASE_SALT_LENGTH);
    expect(metadata.verifier.algorithm).toBe(PASSPHRASE_VERIFIER_ALGORITHM);
    expect(Buffer.from(metadata.verifier.value, "base64")).toHaveLength(32);

    const content = readFileSync(metadataPath, "utf8");
    expect(content).not.toContain(passphrase);
    expect(content).not.toContain(key.toString("hex"));
    expect(content).not.toContain(key.toString("base64"));
    expect(Object.keys(metadata).sort()).toEqual([
      "kdf",
      "params",
      "salt",
      "verifier",
      "version",
    ]);

    key.fill(0);
  });

  it("does not write any file beyond the metadata file during setup", () => {
    const key = setupProvider();

    expect(readdirSync(tmpDir).sort()).toEqual(["vault.passphrase.json"]);
    expect(readFileSync(metadataPath, "utf8")).not.toContain(key.toString("hex"));

    key.fill(0);
  });

  it("does not persist caller-supplied keys through storeKey", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: TEST_KDF_PARAMS,
      prompt: promptFrom(["unused", "unused"]),
    });
    const randomKey = Buffer.alloc(32, 7);

    expect(provider.storeKey(randomKey)).toBe(false);
    expect(existsSync(metadataPath)).toBe(false);
    expect(provider.getLastError()?.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("removes salt and verifier metadata on deleteKey", () => {
    const key = setupProvider();
    const provider = new PassphraseProvider({ metadataPath });

    expect(existsSync(metadataPath)).toBe(true);
    expect(provider.deleteKey()).toBe(true);
    expect(existsSync(metadataPath)).toBe(false);

    key.fill(0);
  });
});
