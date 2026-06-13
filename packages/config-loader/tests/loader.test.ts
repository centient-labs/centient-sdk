import { describe, expect, it } from "vitest";

import {
  APP_HOME_MODE,
  CONFIG_FILE_MODE,
  ConfigError,
  createConfigLoader,
} from "../src/index.js";
import type { FileSystem } from "../src/index.js";
import { createMemEnv, createMemFs } from "./helpers.js";

const HOME = "/home/tester";
const APP = "centient";
const APP_HOME = `${HOME}/.${APP}`;
const USER_CFG = `${APP_HOME}/config.json`;

describe("precedence matrix (env > project > user > default)", () => {
  it("default wins when no other layer supplies the key", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.url")).toBe("http://localhost:3100");
    expect(loader.getResolved("engram.url")?.source).toBe("default");
  });

  it("user file beats default", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ engram: { url: "http://user:3100" } }));
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.url")).toBe("http://user:3100");
    expect(loader.getResolved("engram.url")?.source).toBe("user");
  });

  it("project file beats user and default", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ engram: { url: "http://user:3100" } }));
    fs.setFile("/proj/.centient.json", JSON.stringify({ engram: { url: "http://project:3100" } }));
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.url")).toBe("http://project:3100");
    expect(loader.getResolved("engram.url")?.source).toBe("project");
    expect(loader.projectConfigPath()).toBe("/proj/.centient.json");
  });

  it("env beats project, user, and default", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ engram: { url: "http://user:3100" } }));
    fs.setFile("/proj/.centient.json", JSON.stringify({ engram: { url: "http://project:3100" } }));
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      envBindings: { "engram.url": { env: "ENGRAM_URL" } },
      fs,
      env: createMemEnv({ ENGRAM_URL: "http://env:3100" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.url")).toBe("http://env:3100");
    expect(loader.getResolved("engram.url")?.source).toBe("env");
  });

  it("only bound keys read the environment", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      // No envBindings: ENGRAM_URL must NOT leak in.
      fs,
      env: createMemEnv({ ENGRAM_URL: "http://env:3100" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.url")).toBe("http://localhost:3100");
  });

  it("empty env var is treated as unset (falls through to lower layer)", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ token: "from-user" }));
    const loader = createConfigLoader({
      appName: APP,
      envBindings: { token: { env: "TOKEN" } },
      fs,
      env: createMemEnv({ TOKEN: "" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("token")).toBe("from-user");
    expect(loader.getResolved("token")?.source).toBe("user");
  });
});

describe("env coercion", () => {
  it("applies a coercer to typed env values", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.timeoutMs": 10000 },
      envBindings: {
        "engram.timeoutMs": { env: "ENGRAM_TIMEOUT_MS", coerce: (raw) => Number.parseInt(raw, 10) },
      },
      fs,
      env: createMemEnv({ ENGRAM_TIMEOUT_MS: "5000" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("engram.timeoutMs")).toBe(5000);
  });

  it("surfaces a coercer throw as a ConfigError (no silent drop)", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      envBindings: {
        "engram.timeoutMs": {
          env: "ENGRAM_TIMEOUT_MS",
          coerce: (raw) => {
            const n = Number.parseInt(raw, 10);
            if (!Number.isFinite(n) || n <= 0) {
              throw new Error(`must be a positive integer; got "${raw}"`);
            }
            return n;
          },
        },
      },
      fs,
      env: createMemEnv({ ENGRAM_TIMEOUT_MS: "not-a-number" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.snapshot()).toThrowError(ConfigError);
    try {
      loader.reload();
    } catch (err) {
      expect((err as ConfigError).code).toBe("INVALID_ENV");
      expect((err as ConfigError).key).toBe("engram.timeoutMs");
    }
  });
});

describe("env-reference expansion in file values", () => {
  it("expands ${VAR} and ${VAR:-default} in string leaves", () => {
    const fs = createMemFs();
    fs.setFile(
      USER_CFG,
      JSON.stringify({ logs: { path: "${LOG_DIR:-/var/log/centient}" }, host: "${HOST}" }),
    );
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv({ HOST: "example.com" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("logs.path")).toBe("/var/log/centient");
    expect(loader.get("host")).toBe("example.com");
  });
});

describe("malformed-file error surfacing (no silent fallthrough)", () => {
  it("throws ConfigError(MALFORMED_FILE) on invalid JSON in user config", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, "{ this is not json ");
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.snapshot()).toThrowError(ConfigError);
    try {
      loader.reload();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("MALFORMED_FILE");
      expect((err as ConfigError).path).toBe(USER_CFG);
    }
  });

  it("throws on a project config that parses to a non-object", () => {
    const fs = createMemFs();
    fs.setFile("/proj/.centient.json", JSON.stringify(["array", "not", "object"]));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.snapshot()).toThrowError(/must be a JSON object/);
  });

  it("a MISSING file is a legitimate empty layer, not an error", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.snapshot()).not.toThrow();
    expect(loader.get("x")).toBe(1);
  });
});

describe("write-back round-trip", () => {
  it("persists updates to the user file and re-reads them", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    loader.write({ "engram.apiKey": "round-trip-value", "engram.userId": "u-1" });

    // Re-read through a FRESH loader over the same fs to prove it round-trips.
    const reread = createConfigLoader({
      appName: APP,
      defaults: { "engram.url": "http://localhost:3100" },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(reread.get("engram.apiKey")).toBe("round-trip-value");
    expect(reread.get("engram.userId")).toBe("u-1");
    // Default still present (write-back merges, not replaces).
    expect(reread.get("engram.url")).toBe("http://localhost:3100");
  });

  it("write-back preserves unrelated existing keys", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ keep: { me: true } }));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    loader.write({ added: "new" });
    expect(loader.get("keep.me")).toBe(true);
    expect(loader.get("added")).toBe("new");
  });

  it("writes the user file with mode 0o600", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    loader.write({ secret: "x" });
    expect(fs.modeOf(USER_CFG)).toBe(CONFIG_FILE_MODE);
    expect(CONFIG_FILE_MODE).toBe(0o600);
  });

  it("refuses to write-back over a malformed existing user config", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, "}}} broken");
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.write({ a: 1 })).toThrowError(ConfigError);
  });
});

describe("0o700 app-home enforcement", () => {
  it("creates the app home with mode 0o700 on write-back", () => {
    const fs = createMemFs();
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    loader.write({ a: 1 });
    expect(fs.modeOf(APP_HOME)).toBe(APP_HOME_MODE);
    expect(APP_HOME_MODE).toBe(0o700);
  });

  it("tightens an existing loose app home to 0o700", () => {
    const fs = createMemFs();
    fs.setDir(APP_HOME);
    fs.chmodSync(APP_HOME, 0o755); // simulate a loose pre-existing dir
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    loader.write({ a: 1 });
    expect(fs.modeOf(APP_HOME)).toBe(0o700);
  });
});

describe("caching and reload", () => {
  it("caches the first resolution and reload() picks up file changes", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ v: "first" }));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("v")).toBe("first");

    fs.setFile(USER_CFG, JSON.stringify({ v: "second" }));
    // Still cached.
    expect(loader.get("v")).toBe("first");
    // Reload drops the cache.
    loader.reload();
    expect(loader.get("v")).toBe("second");
  });
});

describe("warning collection + logger forwarding", () => {
  it("forwards collected warnings to an injected ConfigLogger with full context", () => {
    const fs = createMemFs();
    // A malformed package.json on the walk-up path produces a non-fatal
    // discovery warning (it is not OUR config, so resolution proceeds).
    fs.setFile("/proj/package.json", "{ not json");
    fs.setDir("/proj/src");
    const calls: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj/src",
      logger: { warn: (message, context) => calls.push({ message, context }) },
    });
    const snap = loader.snapshot();
    expect(snap.warnings.length).toBeGreaterThanOrEqual(1);
    // Every collected warning reached the logger, in order, carrying the SAME
    // message and the SAME provenance the snapshot recorded — the logger sink
    // and the snapshot warning list must never diverge.
    expect(calls.length).toBe(snap.warnings.length);
    for (const [i, warning] of snap.warnings.entries()) {
      expect(calls[i]?.message).toBe(warning.message);
      expect(calls[i]?.context?.source).toBe(warning.source);
      // `key` is forwarded explicitly even when undefined for this source, so
      // the context object always exposes the field the contract promises.
      expect(calls[i]?.context).toHaveProperty("key");
      expect(calls[i]?.context?.key).toBe(warning.key);
    }
    // Spot-check the concrete discovery warning that drove this case.
    expect(calls[0]?.message).toMatch(/Malformed JSON in package\.json/);
    expect(calls[0]?.context?.source).toBe("project");
  });

  it("forwards EVERY warning when resolution collects more than one", () => {
    // Two distinct walk-up ancestors each carry a malformed package.json, so the
    // discovery walk emits two warnings on the way to the (absent) root. This
    // proves the logger fan-out is a loop over the full list, not a first-only
    // forward, and that each call lands in collection order.
    const fs = createMemFs();
    fs.setFile("/a/package.json", "{ not json");
    fs.setFile("/a/b/package.json", "{ also not json");
    fs.setDir("/a/b/c");
    const calls: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/a/b/c",
      logger: { warn: (message, context) => calls.push({ message, context }) },
    });
    const snap = loader.snapshot();
    expect(snap.warnings.length).toBe(2);
    expect(calls.length).toBe(2);
    // Nearest ancestor is visited first, so its warning is forwarded first.
    expect(calls[0]?.message).toMatch(/\/a\/b\/package\.json/);
    expect(calls[1]?.message).toMatch(/\/a\/package\.json/);
    for (const call of calls) {
      expect(call.context?.source).toBe("project");
    }
  });

  it("collects warnings on the snapshot even when NO logger is injected", () => {
    // The logger is an optional sink: with none wired, warnings are still
    // gathered on the resolution result (nothing is silently dropped).
    const fs = createMemFs();
    fs.setFile("/proj/package.json", "{ not json");
    fs.setDir("/proj/src");
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj/src",
      // no logger
    });
    expect(loader.warnings().length).toBeGreaterThanOrEqual(1);
    expect(loader.warnings()).toBe(loader.snapshot().warnings);
  });

  it("does not call the logger when resolution produces no warnings", () => {
    const fs = createMemFs();
    fs.setDir("/proj");
    let warnCount = 0;
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
      logger: { warn: () => (warnCount += 1) },
    });
    loader.snapshot();
    expect(warnCount).toBe(0);
  });
});

describe("malformed-file error detail (preserves the offending parsed type)", () => {
  it("names the actual JSON type and preserves a cause for a non-object project config", () => {
    const fs = createMemFs();
    fs.setFile("/proj/.centient.json", JSON.stringify(42));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    try {
      loader.snapshot();
      throw new Error("expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.code).toBe("MALFORMED_FILE");
      expect(ce.message).toMatch(/parsed as number/);
      expect(ce.cause).toBeInstanceOf(TypeError);
    }
  });

  it("names 'array' (not 'object') for a JSON array project config", () => {
    const fs = createMemFs();
    fs.setFile("/proj/.centient.json", JSON.stringify(["a"]));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(() => loader.snapshot()).toThrowError(/parsed as array/);
  });
});

describe("env-reference expansion restricts to valid env-var names", () => {
  it("leaves a ${...} containing an invalid name untouched", () => {
    const fs = createMemFs();
    fs.setFile(
      USER_CFG,
      JSON.stringify({ raw: "${not a var}", weird: "${a-b}", ok: "${HOST}" }),
    );
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv({ HOST: "example.com" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    // Invalid names pass through verbatim; only the well-formed name expands.
    expect(loader.get("raw")).toBe("${not a var}");
    expect(loader.get("weird")).toBe("${a-b}");
    expect(loader.get("ok")).toBe("example.com");
  });

  it("still expands valid lowercase and mixed-case names (not uppercase-only)", () => {
    const fs = createMemFs();
    fs.setFile(USER_CFG, JSON.stringify({ a: "${lower_case}", b: "${MixedCase42}" }));
    const loader = createConfigLoader({
      appName: APP,
      fs,
      env: createMemEnv({ lower_case: "L", MixedCase42: "M" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.get("a")).toBe("L");
    expect(loader.get("b")).toBe("M");
  });
});

describe("walk-up depth guard (via the public loader surface)", () => {
  it("terminates project discovery at MAX_WALK_UP_DEPTH on a pathological fs", () => {
    // discovery.test.ts exercises the guard against discoverProjectRoot directly;
    // this drives the SAME guard through createConfigLoader so the public surface
    // is proven to inherit the bound. The fs reports every path as a non-matching
    // directory, so without the 64-iteration cap the walk would recurse for all
    // 200 segments before `parent === current` finally stops it at the root.
    let existsCalls = 0;
    const pathologicalFs: FileSystem = {
      existsSync: () => {
        existsCalls += 1;
        return false; // never a config, marker, or package.json
      },
      readFileSync: () => {
        throw new Error("unexpected read");
      },
      writeFileSync: () => undefined,
      mkdirSync: () => undefined,
      chmodSync: () => undefined,
      isDirectory: () => true,
    };
    const deepStart = `/${Array.from({ length: 200 }, (_, i) => `seg${i}`).join("/")}`;
    const loader = createConfigLoader({
      appName: APP,
      defaults: { x: 1 },
      fs: pathologicalFs,
      env: createMemEnv(),
      homeDir: HOME,
      cwd: deepStart,
      projectPath: deepStart,
    });
    const snap = loader.snapshot();
    // No project root was found, so only the default layer survives.
    expect(loader.projectConfigPath()).toBeNull();
    expect(snap.all.x).toBe(1);
    // Per walked level existsSync runs for: the config file, each marker (1),
    // and the workspaces package.json probe — 3 per level. The guard caps levels
    // at 64, bounding the walk at 64 * 3. The loader also probes the user-config
    // path once (outside the walk), so allow a few fixed extra calls. Either way
    // this is far below the 200 segments available, proving termination came from
    // the depth guard rather than the filesystem root.
    expect(existsCalls).toBeLessThanOrEqual(64 * 3 + 8);
  });
});

describe("home env-var override", () => {
  it("honors homeEnvVar for the user-config home, with tilde expansion", () => {
    const fs = createMemFs();
    fs.setFile(`${HOME}/custom/config.json`, JSON.stringify({ from: "custom-home" }));
    const loader = createConfigLoader({
      appName: APP,
      homeEnvVar: "CENTIENT_HOME",
      fs,
      env: createMemEnv({ CENTIENT_HOME: "~/custom" }),
      homeDir: HOME,
      cwd: "/proj",
    });
    expect(loader.userConfigPath()).toBe(`${HOME}/custom/config.json`);
    expect(loader.get("from")).toBe("custom-home");
  });
});
