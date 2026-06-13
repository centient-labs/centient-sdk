import { describe, expect, it } from "vitest";
import {
  colorize,
  createAnsiColors,
  detectCapabilities,
  detectTerminalCapabilities,
  makeAnsiColors,
  resolveColorSupport,
  writeError,
  DEFAULT_WIDTH,
  type EnvRecord,
  type StreamInfo,
} from "../src/index.js";

const tty: StreamInfo = { isTTY: true, columns: 120 };
const notty: StreamInfo = { isTTY: false, columns: 0 };

describe("resolveColorSupport precedence matrix", () => {
  // Precedence order under test (highest wins):
  //   FORCE_COLOR > NO_COLOR > TERM=dumb > isTTY > default-off
  const cases: Array<{
    name: string;
    env: EnvRecord;
    isTTY: boolean;
    hasColor: boolean;
    isDumb: boolean;
  }> = [
    { name: "FORCE_COLOR beats NO_COLOR", env: { FORCE_COLOR: "1", NO_COLOR: "1" }, isTTY: false, hasColor: true, isDumb: false },
    { name: "FORCE_COLOR beats TERM=dumb", env: { FORCE_COLOR: "1", TERM: "dumb" }, isTTY: false, hasColor: true, isDumb: false },
    { name: "FORCE_COLOR empty-string still forces on", env: { FORCE_COLOR: "" }, isTTY: false, hasColor: true, isDumb: false },
    { name: "NO_COLOR beats TERM=dumb", env: { NO_COLOR: "1", TERM: "dumb" }, isTTY: true, hasColor: false, isDumb: false },
    { name: "NO_COLOR empty-string still forces off", env: { NO_COLOR: "" }, isTTY: true, hasColor: false, isDumb: false },
    { name: "NO_COLOR beats isTTY", env: { NO_COLOR: "1" }, isTTY: true, hasColor: false, isDumb: false },
    { name: "TERM=dumb beats isTTY and sets isDumb", env: { TERM: "dumb" }, isTTY: true, hasColor: false, isDumb: true },
    { name: "isTTY enables color", env: {}, isTTY: true, hasColor: true, isDumb: false },
    { name: "non-TTY defaults off", env: {}, isTTY: false, hasColor: false, isDumb: false },
    { name: "TERM!=dumb on non-TTY stays off", env: { TERM: "xterm-256color" }, isTTY: false, hasColor: false, isDumb: false },
    { name: "TERM!=dumb on TTY enables color", env: { TERM: "xterm-256color" }, isTTY: true, hasColor: true, isDumb: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveColorSupport(c.env, c.isTTY)).toEqual({
        hasColor: c.hasColor,
        isDumb: c.isDumb,
      });
    });
  }

  it("treats an env key set to undefined as absent", () => {
    // hasOwnProperty is true but value undefined — must NOT count as present.
    const env: EnvRecord = { NO_COLOR: undefined };
    expect(resolveColorSupport(env, true)).toEqual({ hasColor: true, isDumb: false });
  });
});

describe("detectCapabilities", () => {
  it("reports width from a TTY stream", () => {
    const caps = detectCapabilities({}, tty);
    expect(caps).toEqual({ isTTY: true, hasColor: true, isDumb: false, width: 120 });
  });

  it("falls back to DEFAULT_WIDTH on a non-TTY stream", () => {
    const caps = detectCapabilities({}, notty);
    expect(caps.width).toBe(DEFAULT_WIDTH);
    expect(caps.hasColor).toBe(false);
    expect(caps.isTTY).toBe(false);
  });

  it("falls back to DEFAULT_WIDTH when columns is undefined", () => {
    expect(detectCapabilities({}, { isTTY: true }).width).toBe(DEFAULT_WIDTH);
  });

  it("treats a missing isTTY as non-TTY", () => {
    expect(detectCapabilities({}, {}).isTTY).toBe(false);
  });
});

describe("makeAnsiColors", () => {
  it("emits ANSI codes when enabled", () => {
    const c = makeAnsiColors(true);
    expect(c.reset).toBe("\x1b[0m");
    expect(c.green).toBe("\x1b[32m");
    expect(c.cyan).toBe("\x1b[36m");
    expect(c.bright).toBe("\x1b[1m");
  });

  it("degrades to empty strings when disabled", () => {
    const c = makeAnsiColors(false);
    expect(c.reset).toBe("");
    expect(c.green).toBe("");
    expect(c.bright).toBe("");
  });
});

describe("colorize", () => {
  it("wraps text in code + reset when enabled", () => {
    const c = makeAnsiColors(true);
    expect(colorize(c, "red", "boom")).toBe("\x1b[31mboom\x1b[0m");
  });

  it("is the identity function when disabled", () => {
    const c = makeAnsiColors(false);
    expect(colorize(c, "red", "boom")).toBe("boom");
  });
});

describe("writeError", () => {
  it("formats a three-part error to the injected sink", () => {
    const chunks: string[] = [];
    writeError("it broke", "a number", "pass 1.2.3", (s) => chunks.push(s));
    expect(chunks.join("")).toBe(
      "[ERROR] it broke\n  Expected: a number\n  Recovery: pass 1.2.3\n"
    );
  });
});

describe("live-process convenience wrappers", () => {
  it("detectTerminalCapabilities reads the live process without throwing", () => {
    const caps = detectTerminalCapabilities("stdout");
    expect(typeof caps.hasColor).toBe("boolean");
    expect(caps.width).toBeGreaterThan(0);
  });

  it("createAnsiColors returns a full color set", () => {
    const c = createAnsiColors();
    expect(Object.keys(c).sort()).toEqual(
      ["bright", "cyan", "dim", "green", "red", "reset", "yellow"].sort()
    );
  });
});
