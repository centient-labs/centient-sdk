/**
 * OnePasswordVault — ADR-004 credential backend.
 *
 * `op` is mocked at the `runOp` seam, so these run without the 1Password CLI.
 * The two properties the ADR exists to hold get the most attention:
 *
 *   1. **Secret values never reach argv** (§4) — every write asserts the value
 *      is absent from the argv array and present in the stdin payload. This is
 *      the property issue #102 is about; a regression here is a real leak.
 *   2. **Never auto-selected** (§1) — detect() refuses without explicit opt-in,
 *      even when `op` is available.
 *
 * Plus the contract details: no default vault (fail closed), list-cache that
 * caches names and not values, idempotent delete, listKeys throwing on
 * transient failure while returning [] when empty, and the one-time warning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRunOp = vi.hoisted(() => vi.fn());
const mockDetectOpCli = vi.hoisted(() => vi.fn(() => true));

vi.mock("../src/key-providers/op-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/key-providers/op-cli.js")>();
  return {
    ...actual,
    runOp: mockRunOp,
    detectOpCli: mockDetectOpCli,
  };
});

import { OnePasswordVault, OP_LIST_CACHE_TTL_MS } from "../src/vault/vault-onepassword.js";
import { OpCliError } from "../src/key-providers/op-cli.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function notFound(args: string[] = ["item", "get"]): OpCliError {
  return new OpCliError(args, "\"nope\" isn't an item in the vault", new Error("exit 1"));
}

function transient(args: string[] = ["item", "list"]): OpCliError {
  return new OpCliError(args, "network error: could not reach 1Password", new Error("exit 1"));
}

/** Every argv element `runOp` was called with, flattened. */
function allArgv(): string[] {
  return mockRunOp.mock.calls.flatMap((c) => c[0] as string[]);
}

/** Every stdin payload `runOp` was given. */
function allStdin(): string[] {
  return mockRunOp.mock.calls
    .map((c) => (c[1] as { input?: string } | undefined)?.input)
    .filter((v): v is string => typeof v === "string");
}

function capture(): { stderr: string[]; restore: () => void } {
  const stderr: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  return { stderr, restore: () => { process.stderr.write = orig; } };
}

let clock = 0;
const now = () => clock;

function makeVault(overrides: Record<string, unknown> = {}) {
  return new OnePasswordVault({ vault: "centient-credentials", now, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunOp.mockReturnValue("");
  mockDetectOpCli.mockReturnValue(true);
  clock = 1_000_000;
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// §4 — the argv property
// -----------------------------------------------------------------------------

describe("OnePasswordVault — secret values never reach argv (ADR-004 §4)", () => {
  it("pipes the value on stdin and keeps it out of every argv element", () => {
    // Deliberately NOT credential-shaped. The test needs a distinctive string
    // to trace through argv and stdin; it does not need one that looks like a
    // real key, and shipping a realistic-looking literal is how a scanner gets
    // trained to be ignored.
    const CANARY = "canary-value-must-not-appear-in-argv";
    const vault = makeVault();

    expect(vault.store("engram-token", CANARY)).toBe(true);

    // The load-bearing assertion: nothing readable in `ps` carries the secret.
    for (const arg of allArgv()) {
      expect(arg).not.toContain(CANARY);
    }
    // And it did travel — on stdin, inside the item JSON.
    const stdin = allStdin();
    expect(stdin).toHaveLength(1);
    expect(stdin[0]).toContain(CANARY);

    const item = JSON.parse(stdin[0]!) as {
      title: string;
      category: string;
      vault: { name: string };
      tags: string[];
      fields: { id: string; type: string; value: string }[];
    };
    expect(item).toMatchObject({
      title: "engram-token",
      category: "PASSWORD",
      vault: { name: "centient-credentials" },
      tags: ["centient"],
    });
    expect(item.fields[0]).toEqual({
      id: "password",
      type: "CONCEALED",
      value: CANARY,
    });

    // `op item create -` — the trailing "-" is what makes it read stdin.
    const createCall = mockRunOp.mock.calls.find((c) =>
      (c[0] as string[]).includes("create"),
    );
    expect(createCall?.[0]).toEqual(["item", "create", "--format=json", "-"]);
  });

  it("models update as delete-then-create, so both go through the stdin path", () => {
    const vault = makeVault();
    vault.store("app.key", "v1");
    vault.store("app.key", "v2");

    const creates = mockRunOp.mock.calls.filter((c) => (c[0] as string[]).includes("create"));
    const deletes = mockRunOp.mock.calls.filter((c) => (c[0] as string[]).includes("delete"));
    expect(creates).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    // No `item edit` path at all — one write shape, one argv-safety argument.
    expect(allArgv()).not.toContain("edit");
    for (const arg of allArgv()) expect(arg).not.toContain("v2");
  });
});

// -----------------------------------------------------------------------------
// §1 — opt-in and fail-closed
// -----------------------------------------------------------------------------

describe("OnePasswordVault — explicit opt-in (ADR-004 §1)", () => {
  it("refuses to detect without opt-in even when op is fully available", () => {
    mockDetectOpCli.mockReturnValue(true);
    expect(OnePasswordVault.detect(false)).toBe(false);
    // It should not even bother probing — having `op` is not consent.
    expect(mockDetectOpCli).not.toHaveBeenCalled();
  });

  it("detects when opted in and op is available, and not when op is missing", () => {
    mockDetectOpCli.mockReturnValue(true);
    expect(OnePasswordVault.detect(true)).toBe(true);
    mockDetectOpCli.mockReturnValue(false);
    expect(OnePasswordVault.detect(true)).toBe(false);
  });

  it("fails closed with an actionable message when no vault is configured", () => {
    expect(() => new OnePasswordVault({})).toThrow(/vault is required/i);
    expect(() => new OnePasswordVault({ vault: "   " })).toThrow(/no default vault/i);
    // Contrast with the key layer, which defaults to "Private" — guessing here
    // could write credentials into a personal vault.
    expect(() => new OnePasswordVault({ vault: "ok" })).not.toThrow();
  });

  it("uses the configured tag, defaulting to centient", () => {
    makeVault().store("app.key", "v");
    expect(JSON.parse(allStdin()[0]!).tags).toEqual(["centient"]);

    mockRunOp.mockClear();
    makeVault({ tag: "team-shared" }).store("app.key", "v");
    expect(JSON.parse(allStdin()[0]!).tags).toEqual(["team-shared"]);
  });
});

// -----------------------------------------------------------------------------
// read / delete
// -----------------------------------------------------------------------------

describe("OnePasswordVault — retrieve and delete", () => {
  it("reads through an op:// reference and returns the value", () => {
    mockRunOp.mockReturnValue("stored-value");
    expect(makeVault().retrieve("engram-token")).toBe("stored-value");
    expect(mockRunOp.mock.calls[0]![0]).toEqual([
      "read",
      "op://centient-credentials/engram-token/password",
    ]);
  });

  it("returns null for a missing item without warning", () => {
    mockRunOp.mockImplementation(() => { throw notFound(["read"]); });
    const { stderr, restore } = capture();
    try {
      expect(makeVault().retrieve("absent")).toBeNull();
    } finally { restore(); }
    expect(stderr.join("")).toBe("");
  });

  it("returns null on an empty read", () => {
    mockRunOp.mockReturnValue("");
    // Valid key on purpose: with a rejected one this would return null via the
    // key guard and pass even if the empty-read path were broken.
    expect(makeVault().retrieve("app.key")).toBeNull();
    expect(mockRunOp).toHaveBeenCalledOnce();
  });

  it("deletes idempotently — a missing item is success", () => {
    mockRunOp.mockImplementation(() => { throw notFound(["item", "delete"]); });
    expect(makeVault().delete("absent")).toBe(true);
  });

  it("returns false when delete fails for a real reason", () => {
    mockRunOp.mockImplementation(() => { throw transient(["item", "delete"]); });
    const { restore } = capture();
    try {
      expect(makeVault().delete("app.key")).toBe(false);
    } finally { restore(); }
  });
});

// -----------------------------------------------------------------------------
// listKeys + cache
// -----------------------------------------------------------------------------

describe("OnePasswordVault — listKeys", () => {
  const items = JSON.stringify([
    { id: "1", title: "engram-token" },
    { id: "2", title: "app.alpha" },
    { id: "3", title: "app.beta" },
  ]);

  it("lists titles, tag-filtered, and applies the prefix in-process", async () => {
    mockRunOp.mockReturnValue(items);
    const vault = makeVault();

    expect(await vault.listKeys()).toEqual(["engram-token", "app.alpha", "app.beta"]);
    expect(mockRunOp.mock.calls[0]![0]).toEqual([
      "item", "list", "--vault", "centient-credentials", "--tags", "centient", "--format=json",
    ]);

    // Prefix filtering is in-process, so it costs no extra op call.
    const before = mockRunOp.mock.calls.length;
    expect(await vault.listKeys("app.")).toEqual(["app.alpha", "app.beta"]);
    expect(mockRunOp.mock.calls.length).toBe(before);
  });

  it("returns [] on empty, and for a vault op reports as not-found", async () => {
    mockRunOp.mockReturnValue("[]");
    expect(await makeVault().listKeys()).toEqual([]);

    mockRunOp.mockImplementation(() => { throw notFound(["item", "list"]); });
    expect(await makeVault().listKeys()).toEqual([]);
  });

  it("THROWS on a transient failure so the caller can retry", async () => {
    // The VaultBackend contract distinguishes "nothing stored" from "the store
    // did not answer"; collapsing the latter to [] would silently look empty.
    mockRunOp.mockImplementation(() => { throw transient(); });
    const { restore } = capture();
    try {
      await expect(makeVault().listKeys()).rejects.toThrow(OpCliError);
    } finally { restore(); }
  });

  it("caches key NAMES for the TTL and re-fetches after it expires", async () => {
    mockRunOp.mockReturnValue(items);
    const vault = makeVault();

    await vault.listKeys();
    await vault.listKeys();
    expect(mockRunOp).toHaveBeenCalledTimes(1);

    clock += OP_LIST_CACHE_TTL_MS;
    await vault.listKeys();
    expect(mockRunOp).toHaveBeenCalledTimes(2);
  });

  it("never caches values — retrieve always hits op", async () => {
    mockRunOp.mockReturnValue(items);
    const vault = makeVault();
    await vault.listKeys();

    mockRunOp.mockReturnValue("value-1");
    expect(vault.retrieve("engram-token")).toBe("value-1");
    mockRunOp.mockReturnValue("value-2-rotated");
    // A read-through value cache would still serve value-1 here — which for a
    // rotated or revoked credential is a correctness *and* security problem.
    expect(vault.retrieve("engram-token")).toBe("value-2-rotated");
  });

  it("invalidates the cache on store and delete", async () => {
    mockRunOp.mockReturnValue(items);
    const vault = makeVault();
    await vault.listKeys();
    expect(mockRunOp).toHaveBeenCalledTimes(1);

    vault.store("new-key", "v");
    await vault.listKeys();
    expect(mockRunOp.mock.calls.filter((c) => (c[0] as string[]).includes("list"))).toHaveLength(2);

    vault.delete("new-key");
    await vault.listKeys();
    expect(mockRunOp.mock.calls.filter((c) => (c[0] as string[]).includes("list"))).toHaveLength(3);
  });

  it("skips malformed entries rather than failing the whole enumeration", async () => {
    mockRunOp.mockReturnValue(
      JSON.stringify([{ title: "good" }, { id: "no-title" }, null, { title: "" }, "junk"]),
    );
    expect(await makeVault().listKeys()).toEqual(["good"]);
  });
});

// -----------------------------------------------------------------------------
// Key constraint — the op:// reference is path-structured
// -----------------------------------------------------------------------------

describe("OnePasswordVault — rejects keys an op:// reference cannot round-trip", () => {
  // The defect this closes: a key with '/' stores fine (a 1Password title is
  // just a string) but `op://<vault>/<key>/password` then re-parses into a
  // different item and field, so the write is silently unreadable. A refusal is
  // strictly better than a caller believing the credential is saved.
  const RESERVED = [
    "service/api-key",   // re-parses the reference path — the reported case
    "svc//key",
    "key with space",
    "UPPER-case",
    "under_score",
    "-leading-hyphen",
    "trailing-dot.",
    "a",                 // too short for the 2-char minimum
    "",
  ];

  it("refuses to STORE such a key, so the unreadable write never happens", () => {
    for (const key of RESERVED) {
      mockRunOp.mockClear();
      const { restore } = capture();
      try {
        expect(makeVault().store(key, "v")).toBe(false);
      } finally { restore(); }
      // The decisive part: no `op` call at all — nothing was written.
      expect(mockRunOp).not.toHaveBeenCalled();
    }
  });

  it("refuses to RETRIEVE and DELETE such a key without touching op", () => {
    for (const key of RESERVED) {
      mockRunOp.mockClear();
      const vault = makeVault();
      const { restore } = capture();
      try {
        expect(vault.retrieve(key)).toBeNull();
        // Not idempotent-success: "missing" and "impossible" are different
        // answers, and this key was never storable here.
        expect(vault.delete(key)).toBe(false);
      } finally { restore(); }
      expect(mockRunOp).not.toHaveBeenCalled();
    }
  });

  it("still accepts the separators the key contract allows", () => {
    for (const key of ["engram-token", "app.alpha", "soma-anthropic-token1", "a1"]) {
      mockRunOp.mockClear();
      expect(makeVault().store(key, "v")).toBe(true);
      expect(mockRunOp).toHaveBeenCalled();
    }
  });

  it("warns once, naming the key and why, then suppresses", () => {
    const vault = makeVault();
    const { stderr, restore } = capture();
    try {
      vault.store("service/api-key", "v");
      vault.store("another/bad-key", "v");
      vault.retrieve("third/bad-key");
    } finally { restore(); }

    const out = stderr.join("");
    expect(out).toContain('refused the key "service/api-key"');
    expect(out).toContain("op:// reference path");
    expect(out).toContain("store but never read back");
    expect(out.match(/refused the key/g)).toHaveLength(1);
  });

  it("never leaks the value when refusing a key", () => {
    const CANARY = "canary-value-must-not-reach-stderr-on-reject";
    const { stderr, restore } = capture();
    try {
      makeVault().store("bad/key", CANARY);
    } finally { restore(); }
    expect(stderr.join("")).not.toContain(CANARY);
  });
});

// -----------------------------------------------------------------------------
// §7 — observable failure
// -----------------------------------------------------------------------------

describe("OnePasswordVault — one-time warning (ADR-004 §7)", () => {
  it("warns once on an unexpected failure, then suppresses", () => {
    mockRunOp.mockImplementation(() => { throw transient(["item", "create"]); });
    const vault = makeVault();

    const { stderr, restore } = capture();
    try {
      expect(vault.store("key-a", "v")).toBe(false);
      expect(vault.store("key-b", "v2")).toBe(false);
      expect(vault.retrieve("key-c")).toBeNull();
    } finally { restore(); }

    const out = stderr.join("");
    // The non-throwing backend contract would otherwise swallow this entirely.
    expect(out).toContain("1Password backend store failed");
    expect(out).toContain("centient-credentials/key-a");
    expect(out).toContain("suppressed");
    // Exactly one warning block, despite three failures.
    expect(out.match(/WARNING: 1Password backend/g)).toHaveLength(1);
  });

  it("never leaks the stored value into the warning", () => {
    const CANARY = "canary-value-must-not-reach-stderr";
    mockRunOp.mockImplementation(() => { throw transient(["item", "create"]); });

    const { stderr, restore } = capture();
    try {
      makeVault().store("app.key", CANARY);
    } finally { restore(); }

    expect(stderr.join("")).not.toContain(CANARY);
  });
});
