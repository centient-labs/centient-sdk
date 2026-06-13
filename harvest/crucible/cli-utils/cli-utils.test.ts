/**
 * Tests for cli-utils.ts
 *
 * Covers:
 * - writeError: structured three-part error output to stderr
 * - createAnsiColors: ANSI color code generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeError, createAnsiColors, detectTerminalCapabilities } from "../src/cli-utils.js";

// ---------------------------------------------------------------------------
// writeError
// ---------------------------------------------------------------------------

describe("writeError", () => {
  let stderrWrite: ReturnType<typeof vi.fn>;
  const originalStderrWrite = process.stderr.write;

  beforeEach(() => {
    stderrWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
  });

  it("writes structured three-part error to stderr", () => {
    writeError("something broke", "it should work", "restart the thing");

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    const output = stderrWrite.mock.calls[0]?.[0] as string;
    expect(output).toContain("[ERROR]");
    expect(output).toContain("something broke");
    expect(output).toContain("Expected:");
    expect(output).toContain("it should work");
    expect(output).toContain("Recovery:");
    expect(output).toContain("restart the thing");
  });

  it("includes all three parameters in output", () => {
    writeError("file not found", "file to exist at /tmp/x", "create the file");

    const output = stderrWrite.mock.calls[0]?.[0] as string;
    expect(output).toContain("file not found");
    expect(output).toContain("file to exist at /tmp/x");
    expect(output).toContain("create the file");
  });

  it("outputs a single multi-line string", () => {
    writeError("a", "b", "c");

    const output = stderrWrite.mock.calls[0]?.[0] as string;
    const lines = output.trim().split("\n");
    expect(lines.length).toBe(3);
  });

  it("returns void", () => {
    const result = writeError("a", "b", "c");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createAnsiColors
// ---------------------------------------------------------------------------

describe("createAnsiColors", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    if ("NO_COLOR" in originalEnv) {
      process.env.NO_COLOR = originalEnv.NO_COLOR;
    } else {
      delete process.env.NO_COLOR;
    }
    if ("TERM" in originalEnv) {
      process.env.TERM = originalEnv.TERM;
    } else {
      delete process.env.TERM;
    }
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it("returns empty strings for all codes when color is disabled", () => {
    process.env.NO_COLOR = "1";
    const colors = createAnsiColors();
    expect(colors.reset).toBe("");
    expect(colors.bright).toBe("");
    expect(colors.dim).toBe("");
    expect(colors.red).toBe("");
    expect(colors.green).toBe("");
    expect(colors.yellow).toBe("");
    expect(colors.cyan).toBe("");
  });

  it("returns ANSI escape codes when color is enabled", () => {
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    const colors = createAnsiColors();
    expect(colors.reset).toBe("\x1b[0m");
    expect(colors.bright).toBe("\x1b[1m");
    expect(colors.dim).toBe("\x1b[2m");
    expect(colors.red).toBe("\x1b[31m");
    expect(colors.green).toBe("\x1b[32m");
    expect(colors.yellow).toBe("\x1b[33m");
    expect(colors.cyan).toBe("\x1b[36m");
  });
});

// ---------------------------------------------------------------------------
// detectTerminalCapabilities (T-D2a)
// ---------------------------------------------------------------------------

describe("detectTerminalCapabilities", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const originalStdoutColumns = process.stdout.columns;
  const originalStderrColumns = process.stderr.columns;
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  const originalTerm = process.env.TERM;

  function setStdout(isTTY: boolean | undefined, columns: number | undefined): void {
    Object.defineProperty(process.stdout, "isTTY", { value: isTTY, writable: true, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: columns, writable: true, configurable: true });
  }

  afterEach(() => {
    // Restore env vars precisely (don't just delete — preserve originals)
    if (originalForceColor !== undefined) process.env.FORCE_COLOR = originalForceColor;
    else delete process.env.FORCE_COLOR;
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
    else delete process.env.NO_COLOR;
    if (originalTerm !== undefined) process.env.TERM = originalTerm;
    else delete process.env.TERM;
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutIsTTY, writable: true, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: originalStdoutColumns, writable: true, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: originalStderrIsTTY, writable: true, configurable: true });
    Object.defineProperty(process.stderr, "columns", { value: originalStderrColumns, writable: true, configurable: true });
  });

  it("TTY with 120 columns: hasColor=true, width=120", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    setStdout(true, 120);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(true);
    expect(caps.width).toBe(120);
    expect(caps.isTTY).toBe(true);
  });

  it("non-TTY: hasColor=false, width defaults to 80", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    setStdout(false, 0);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(false);
    expect(caps.width).toBe(80);
    expect(caps.isTTY).toBe(false);
  });

  it("FORCE_COLOR=1: hasColor=true even on non-TTY", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    setStdout(false, 0);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(true);
  });

  it("NO_COLOR set: hasColor=false even on TTY", () => {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "";
    setStdout(true, 120);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(false);
    expect(caps.width).toBe(120);
  });

  it("TERM=dumb: hasColor=false even on TTY", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.TERM = "dumb";
    setStdout(true, 120);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(false);
    expect(caps.isDumb).toBe(true);
  });

  it("FORCE_COLOR wins over NO_COLOR (precedence: FORCE_COLOR > NO_COLOR)", () => {
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    setStdout(false, 0);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(true);
  });

  it("isTTY=undefined: hasColor=false, width=80", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    setStdout(undefined, undefined);
    const caps = detectTerminalCapabilities("stdout");
    expect(caps.hasColor).toBe(false);
    expect(caps.width).toBe(80);
  });

  it("stream='stderr': reads from process.stderr, not process.stdout", () => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    // stdout is non-TTY
    setStdout(false, 0);
    // stderr is TTY with 100 columns
    Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true, configurable: true });
    Object.defineProperty(process.stderr, "columns", { value: 100, writable: true, configurable: true });
    const caps = detectTerminalCapabilities("stderr");
    expect(caps.isTTY).toBe(true);
    expect(caps.width).toBe(100);
  });
});
