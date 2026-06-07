import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encrypt } from "../src/crypto/vault-common.js";
import { getProviderByType } from "../src/key-providers/resolve.js";
import {
  derivePassphraseKey,
  PASSPHRASE_KDF,
  PASSPHRASE_METADATA_VERSION,
  PASSPHRASE_SALT_LENGTH,
  PASSPHRASE_VERIFIER_ALGORITHM,
  PassphraseProvider,
  passphraseMetadataPathForVault,
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

function promptFrom(values: Array<string | null>): PassphrasePrompt {
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

function writeMetadata(metadata: unknown): void {
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
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
  vi.restoreAllMocks();
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

  it("reports interruption when setup prompt returns null before passphrase entry", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: TEST_KDF_PARAMS,
      prompt: () => null,
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("PASSPHRASE_INTERRUPTED");
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("rejects an empty setup passphrase", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: TEST_KDF_PARAMS,
      prompt: promptFrom([""]),
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("EMPTY_PASSPHRASE");
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("reports interruption when setup confirmation returns null", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: TEST_KDF_PARAMS,
      prompt: promptFrom(["passphrase", null]),
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("PASSPHRASE_INTERRUPTED");
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("rejects mismatched setup passphrases", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: TEST_KDF_PARAMS,
      prompt: promptFrom(["first", "second"]),
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("PASSPHRASE_MISMATCH");
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("reports KDF failures during setup", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      params: { ...TEST_KDF_PARAMS, N: 3 },
      prompt: promptFrom(["passphrase", "passphrase"]),
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("KDF_FAILED");
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("reports metadata write failures during setup", () => {
    const blockerPath = join(tmpDir, "not-a-directory");
    writeFileSync(blockerPath, "blocker", "utf8");
    const provider = new PassphraseProvider({
      metadataPath: join(blockerPath, "vault.passphrase.json"),
      params: TEST_KDF_PARAMS,
      prompt: promptFrom(["passphrase", "passphrase"]),
    });

    expect(provider.setupKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("METADATA_WRITE_FAILED");
  });

  it("reports missing metadata before prompting for a passphrase", () => {
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: () => {
        throw new Error("prompt should not be called");
      },
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("METADATA_NOT_FOUND");
  });

  it("reports invalid JSON as a metadata read failure", () => {
    writeFileSync(metadataPath, "{", "utf8");
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: () => {
        throw new Error("prompt should not be called");
      },
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("METADATA_READ_FAILED");
  });

  it("reports structurally invalid metadata before prompting", () => {
    writeMetadata({ version: 999, kdf: PASSPHRASE_KDF });
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: () => {
        throw new Error("prompt should not be called");
      },
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("METADATA_INVALID");
  });

  it("rejects metadata with a non-power-of-two scrypt N at validation", () => {
    const key = setupProvider();
    const metadata = readMetadata();
    writeMetadata({
      ...metadata,
      params: { ...metadata.params, N: 3 },
    });
    const provider = new PassphraseProvider({
      metadataPath,
      prompt: () => {
        throw new Error("prompt should not be called");
      },
    });

    expect(provider.getKey()).toBeNull();
    expect(provider.getLastError()?.code).toBe("METADATA_INVALID");

    key.fill(0);
  });
});

describe("passphrase provider helpers", () => {
  it("derives metadata paths beside .enc vaults", () => {
    expect(passphraseMetadataPathForVault("/a/b/vault.enc")).toBe(
      "/a/b/vault.passphrase.json",
    );
  });

  it("derives metadata paths beside non-.enc vaults", () => {
    expect(passphraseMetadataPathForVault("/a/b/vault.db")).toBe(
      "/a/b/vault.db.passphrase.json",
    );
  });

  it("derives metadata paths for basename-only vault paths", () => {
    expect(passphraseMetadataPathForVault("vault.enc")).toBe("vault.passphrase.json");
  });

  it("derivePassphraseKey is deterministic for fixed inputs", () => {
    const salt = Buffer.alloc(PASSPHRASE_SALT_LENGTH, 1);
    const first = derivePassphraseKey("passphrase", salt, TEST_KDF_PARAMS);
    const second = derivePassphraseKey("passphrase", salt, TEST_KDF_PARAMS);

    expect(first.equals(second)).toBe(true);
    expect(first).toHaveLength(32);

    first.fill(0);
    second.fill(0);
  });

  it("derivePassphraseKey changes when passphrase or salt changes", () => {
    const salt = Buffer.alloc(PASSPHRASE_SALT_LENGTH, 1);
    const otherSalt = Buffer.alloc(PASSPHRASE_SALT_LENGTH, 2);
    const baseline = derivePassphraseKey("passphrase", salt, TEST_KDF_PARAMS);
    const changedPassphrase = derivePassphraseKey("other", salt, TEST_KDF_PARAMS);
    const changedSalt = derivePassphraseKey("passphrase", otherSalt, TEST_KDF_PARAMS);

    expect(changedPassphrase.equals(baseline)).toBe(false);
    expect(changedSalt.equals(baseline)).toBe(false);

    baseline.fill(0);
    changedPassphrase.fill(0);
    changedSalt.fill(0);
  });

  it("detect returns false when stdin is not a TTY", () => {
    withStdinIsTTY(false, () => {
      expect(PassphraseProvider.detect()).toBe(false);
      expect(getProviderByType("passphrase")).toBeNull();
    });
  });

  it("detect returns true when stdin is a TTY", () => {
    withStdinIsTTY(true, () => {
      expect(PassphraseProvider.detect()).toBe(true);
      expect(getProviderByType("passphrase")).toBeInstanceOf(PassphraseProvider);
    });
  });
});

function withStdinIsTTY(value: boolean, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });

  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}
