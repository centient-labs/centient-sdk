import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_WALK_UP_DEPTH,
  discoverProjectRoot,
  expandTilde,
  resolveAppHome,
  ensureAppHome,
} from "../src/index.js";
import type { FileSystem } from "../src/index.js";
import { createMemFs } from "./helpers.js";

/** A fs where every probe misses, so the walk only stops on a depth/root guard. */
function makeBottomlessFs(): { fs: FileSystem; existsCalls: () => number } {
  let existsCalls = 0;
  const fs: FileSystem = {
    existsSync: () => {
      existsCalls += 1;
      return false;
    },
    readFileSync: () => {
      throw new Error("unexpected read");
    },
    writeFileSync: () => undefined,
    mkdirSync: () => undefined,
    chmodSync: () => undefined,
    isDirectory: () => true,
  };
  return { fs, existsCalls: () => existsCalls };
}

describe("discoverProjectRoot — walk-up to marker", () => {
  it("finds the config file in a parent directory", () => {
    const fs = createMemFs();
    fs.setFile("/a/b/.centient.json", "{}");
    fs.setDir("/a/b/c/d");
    const result = discoverProjectRoot(fs, {
      startDir: "/a/b/c/d",
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBe("/a/b");
    expect(result.configPath).toBe("/a/b/.centient.json");
  });

  it("config file at the start directory wins immediately", () => {
    const fs = createMemFs();
    fs.setFile("/a/b/c/.centient.json", "{}");
    fs.setFile("/a/b/.centient.json", "{}");
    const result = discoverProjectRoot(fs, {
      startDir: "/a/b/c",
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBe("/a/b/c");
    expect(result.configPath).toBe("/a/b/c/.centient.json");
  });

  it("falls back to a marker directory when no config file exists", () => {
    const fs = createMemFs();
    fs.setDir("/repo/.git");
    fs.setDir("/repo/pkg/src");
    const result = discoverProjectRoot(fs, {
      startDir: "/repo/pkg/src",
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBe("/repo");
    expect(result.configPath).toBeNull();
  });

  it("recognises a workspaces package.json as a root", () => {
    const fs = createMemFs();
    fs.setFile("/mono/package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    fs.setDir("/mono/packages/app");
    const result = discoverProjectRoot(fs, {
      startDir: "/mono/packages/app",
      configFilename: ".centient.json",
      markers: [],
    });
    expect(result.root).toBe("/mono");
  });

  it("returns null root when nothing matches up to the filesystem root", () => {
    const fs = createMemFs();
    fs.setDir("/x/y/z");
    const result = discoverProjectRoot(fs, {
      startDir: "/x/y/z",
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBeNull();
    expect(result.configPath).toBeNull();
  });

  it("a non-workspaces package.json does not mark a root", () => {
    const fs = createMemFs();
    fs.setFile("/proj/package.json", JSON.stringify({ name: "thing" }));
    fs.setDir("/proj/src");
    const result = discoverProjectRoot(fs, {
      startDir: "/proj/src",
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBeNull();
  });

  it("a malformed package.json is skipped as a root and reported via onWarn (not silent)", () => {
    const fs = createMemFs();
    fs.setFile("/proj/package.json", "{ not valid json");
    fs.setDir("/proj/src");
    const warnings: string[] = [];
    const result = discoverProjectRoot(fs, {
      startDir: "/proj/src",
      configFilename: ".centient.json",
      markers: [".git"],
      onWarn: (w) => warnings.push(w.message),
    });
    expect(result.root).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Malformed JSON in package\.json/);
  });

  it("an unreadable package.json is reported as a read failure, distinct from a parse failure", () => {
    const fs = createMemFs();
    // existsSync true but readFileSync throws — simulate a permission/IO error.
    fs.setDir("/proj/src");
    const failingFs = {
      ...fs,
      existsSync: (p: string) => p === "/proj/package.json" || fs.existsSync(p),
      readFileSync: (p: string) => {
        if (p === "/proj/package.json") {
          throw new Error("EACCES: permission denied");
        }
        return fs.readFileSync(p);
      },
    };
    const warnings: string[] = [];
    const result = discoverProjectRoot(failingFs, {
      startDir: "/proj/src",
      configFilename: ".centient.json",
      markers: [".git"],
      onWarn: (w) => warnings.push(w.message),
    });
    expect(result.root).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Could not read package\.json/);
  });

  it("terminates at MAX_WALK_UP_DEPTH on a pathological filesystem (no infinite loop)", () => {
    // A fs where every parent appears to exist as a directory but no marker, no
    // config, and no workspaces package.json is ever found. Without the depth
    // guard the walk would only stop when `parent === current` at the root; this
    // asserts the guard itself terminates resolution and returns no root.
    let existsCalls = 0;
    const pathologicalFs = {
      existsSync: () => {
        existsCalls += 1;
        return false; // nothing matches: no config, no marker, no package.json
      },
      readFileSync: () => {
        throw new Error("unexpected read");
      },
      writeFileSync: () => undefined,
      mkdirSync: () => undefined,
      chmodSync: () => undefined,
      isDirectory: () => true,
    };
    // Start from a path with more than MAX_WALK_UP_DEPTH (64) segments so the
    // natural `parent === current` root terminator is NOT what stops the walk.
    const deepStart = `/${Array.from({ length: 200 }, (_, i) => `seg${i}`).join("/")}`;
    const result = discoverProjectRoot(pathologicalFs, {
      startDir: deepStart,
      configFilename: ".centient.json",
      markers: [".git"],
    });
    expect(result.root).toBeNull();
    expect(result.configPath).toBeNull();
    // Per level existsSync runs for: the config file, each marker, and the
    // workspaces package.json probe (1 + 1 marker + 1 = 3). The guard caps
    // levels at 64, so calls are bounded at 64 * 3 — far below the 200 available
    // segments, proving termination came from the depth guard, not the root.
    expect(existsCalls).toBeLessThanOrEqual(64 * 3);
  });

  it("exposes DEFAULT_MAX_WALK_UP_DEPTH as the documented 64 default", () => {
    expect(DEFAULT_MAX_WALK_UP_DEPTH).toBe(64);
  });

  it("honors a custom maxDepth below the default (caps the walk lower)", () => {
    const { fs, existsCalls } = makeBottomlessFs();
    const deepStart = `/${Array.from({ length: 200 }, (_, i) => `seg${i}`).join("/")}`;
    const result = discoverProjectRoot(fs, {
      startDir: deepStart,
      configFilename: ".centient.json",
      markers: [".git"],
      maxDepth: 5,
    });
    expect(result.root).toBeNull();
    // 3 probes per level (config + 1 marker + workspaces package.json), capped at
    // 5 levels — strictly fewer than the default 64-level guard would allow.
    expect(existsCalls()).toBeLessThanOrEqual(5 * 3);
    expect(existsCalls()).toBeGreaterThan(0);
  });

  it("honors a custom maxDepth above the default (deep enterprise monorepo)", () => {
    // A config file 100 ancestors up is UNREACHABLE under the default 64 cap but
    // reachable once maxDepth is raised — proving the bound is the only thing that
    // was stopping discovery, and that it is now configurable.
    const fs = createMemFs();
    const segments = Array.from({ length: 100 }, (_, i) => `seg${i}`);
    const deepStart = `/${segments.join("/")}`;
    const configDir = `/${segments.slice(0, 10).join("/")}`; // 90 levels above start
    fs.setFile(`${configDir}/.centient.json`, "{}");
    fs.setDir(deepStart);

    const underDefault = discoverProjectRoot(fs, {
      startDir: deepStart,
      configFilename: ".centient.json",
      markers: [],
    });
    expect(underDefault.configPath).toBeNull(); // 90 > 64, not found

    const raised = discoverProjectRoot(fs, {
      startDir: deepStart,
      configFilename: ".centient.json",
      markers: [],
      maxDepth: 128,
    });
    expect(raised.configPath).toBe(`${configDir}/.centient.json`);
  });

  it("falls back to the default for a non-positive or non-integer maxDepth", () => {
    const fs = createMemFs();
    fs.setFile("/a/b/.centient.json", "{}");
    fs.setDir("/a/b/c");
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = discoverProjectRoot(fs, {
        startDir: "/a/b/c",
        configFilename: ".centient.json",
        markers: [],
        maxDepth: bad,
      });
      expect(result.configPath).toBe("/a/b/.centient.json");
    }
  });
});

describe("expandTilde", () => {
  it("expands a leading ~/", () => {
    expect(expandTilde("~/data", "/home/u")).toBe("/home/u/data");
  });
  it("expands a bare ~", () => {
    expect(expandTilde("~", "/home/u")).toBe("/home/u");
  });
  it("leaves absolute paths unchanged", () => {
    expect(expandTilde("/etc/thing", "/home/u")).toBe("/etc/thing");
  });
});

describe("resolveAppHome + ensureAppHome", () => {
  it("defaults to ~/.{appName}", () => {
    expect(resolveAppHome({ appName: "centient", homeDir: "/home/u" })).toBe("/home/u/.centient");
  });

  it("honors the env-var override and expands its tilde", () => {
    expect(
      resolveAppHome({ appName: "centient", homeDir: "/home/u", homeEnvVarValue: "~/alt" }),
    ).toBe("/home/u/alt");
  });

  it("creates the home dir 0o700 when missing", () => {
    const fs = createMemFs();
    ensureAppHome(fs, "/home/u/.centient");
    expect(fs.isDirectory("/home/u/.centient")).toBe(true);
    expect(fs.modeOf("/home/u/.centient")).toBe(0o700);
  });

  it("tightens an existing dir to 0o700", () => {
    const fs = createMemFs();
    fs.setDir("/home/u/.centient");
    fs.chmodSync("/home/u/.centient", 0o777);
    ensureAppHome(fs, "/home/u/.centient");
    expect(fs.modeOf("/home/u/.centient")).toBe(0o700);
  });
});
