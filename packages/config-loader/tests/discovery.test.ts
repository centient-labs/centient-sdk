import { describe, expect, it } from "vitest";

import { discoverProjectRoot, expandTilde, resolveAppHome, ensureAppHome } from "../src/index.js";
import { createMemFs } from "./helpers.js";

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
