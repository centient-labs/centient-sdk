import { describe, expect, it } from "vitest";

import { ConfigError, createConfigLoader, flatten, unflatten } from "../src/index.js";
import { createMemEnv, createMemFs } from "./helpers.js";

const HOME = "/home/tester";
const APP = "centient";
const USER_CFG = `${HOME}/.${APP}/config.json`;

describe("flatten/unflatten round-trip", () => {
  it("flattens nested objects to dotted keys and back", () => {
    const nested = { a: { b: { c: 1 } }, d: 2 };
    const flat = flatten(nested);
    expect(flat).toEqual({ "a.b.c": 1, d: 2 });
    expect(unflatten(flat)).toEqual(nested);
  });

  it("keeps arrays and primitive leaves whole (does not flatten INTO arrays)", () => {
    const flat = flatten({ list: [1, 2], n: 3 });
    expect(flat).toEqual({ list: [1, 2], n: 3 });
    expect(unflatten(flat)).toEqual({ list: [1, 2], n: 3 });
  });
});

describe("unflatten conflict detection (no silent last-write-wins)", () => {
  it("throws KEY_CONFLICT when a leaf key is also used as a parent (leaf-then-descend order)", () => {
    // "a.b" is a scalar; "a.b.c" then needs "a.b" to be an object.
    let err: unknown;
    try {
      unflatten({ "a.b": 1, "a.b.c": 2 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("KEY_CONFLICT");
    expect((err as ConfigError).key).toBe("a.b.c");
    expect((err as ConfigError).message).toMatch(/"a\.b"/);
  });

  it("throws KEY_CONFLICT in the opposite order (descend-then-leaf)", () => {
    // "a.b.c" first makes "a.b" an object; "a.b" then tries to be a scalar leaf.
    let err: unknown;
    try {
      unflatten({ "a.b.c": 2, "a.b": 1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("KEY_CONFLICT");
    expect((err as ConfigError).key).toBe("a.b");
  });

  it("does NOT flag sibling keys that merely share a prefix", () => {
    expect(() => unflatten({ "a.b": 1, "a.c": 2 })).not.toThrow();
    expect(unflatten({ "a.b": 1, "a.c": 2 })).toEqual({ a: { b: 1, c: 2 } });
  });

  it("last-write-wins still applies to an EXACT duplicate key (object semantics, not a conflict)", () => {
    // Object literal de-dupes exact keys before unflatten sees them, so this is
    // not a shape conflict — it documents that exact-key collisions are a
    // value-precedence concern handled upstream, not a structural error here.
    expect(unflatten({ "a.b": 2 })).toEqual({ a: { b: 2 } });
  });
});

describe("write-back surfaces a dotted-key shape conflict as ConfigError (no silent data loss)", () => {
  it("rejects a write whose merged keyspace contradicts an existing nested file", () => {
    const fs = createMemFs();
    // Existing file makes "engram.url" a nested object branch.
    fs.setFile(USER_CFG, JSON.stringify({ engram: { url: { host: "h" } } }));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    // Update sets "engram.url" as a scalar leaf — structurally incompatible.
    let err: unknown;
    try {
      loader.write({ "engram.url": "http://scalar:3100" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("KEY_CONFLICT");
  });
});
