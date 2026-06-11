import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DISABLE_BRACKETED_PASTE,
  ENABLE_BRACKETED_PASTE,
} from "../src/cli/hidden-input.js";
import {
  HIDDEN_INPUT_TOO_LONG_MESSAGE,
  HiddenPromptError,
  MAX_HIDDEN_INPUT_LENGTH,
  promptHiddenSync,
} from "../src/cli/hidden-prompt.js";

/** Signal-handler removal is deferred one tick (see hidden-prompt.ts). */
function flushImmediates(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let tmpDir: string | null = null;

afterEach(async () => {
  // Drain pending deferred signal-handler removals so no listener from one
  // test leaks into the next test's baseline.
  await flushImmediates();
  if (tmpDir !== null) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("promptHiddenSync", () => {
  it("throws HiddenPromptError when input is not a TTY", () => {
    expect(() =>
      promptHiddenSync("Passphrase: ", {
        input: { isTTY: false },
        output: { write: vi.fn() },
      }),
    ).toThrow(HiddenPromptError);
  });

  it("throws HiddenPromptError when TTY input has no file descriptor", () => {
    expect(() =>
      promptHiddenSync("Passphrase: ", {
        input: { isTTY: true },
        output: { write: vi.fn() },
      }),
    ).toThrow(HiddenPromptError);
  });

  it("reads hidden input and restores raw mode after submit", () => {
    const fd = inputFd("secret\n");
    const input = {
      fd,
      isTTY: true,
      isRaw: false,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    const output = { write: vi.fn() };

    try {
      expect(promptHiddenSync("Passphrase: ", { input, output })).toBe("secret");
    } finally {
      closeSync(fd);
    }

    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(input.resume).toHaveBeenCalledOnce();
    expect(input.pause).toHaveBeenCalledOnce();
    expect(output.write).toHaveBeenCalledWith(ENABLE_BRACKETED_PASTE);
    expect(output.write).toHaveBeenCalledWith(DISABLE_BRACKETED_PASTE);
  });

  it("installs signal handlers for the prompt duration and removes them one tick after", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const baseline = signals.map((s) => process.listenerCount(s));

    const fd = inputFd("secret\n");
    const input = {
      fd,
      isTTY: true,
      isRaw: false,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    // Sample the listener count on every output write: the prompt-message
    // write happens after installation (baseline + 1).
    const sigintCounts: number[] = [];
    const output = {
      write: vi.fn(() => {
        sigintCounts.push(process.listenerCount("SIGINT"));
      }),
    };

    try {
      expect(promptHiddenSync("Passphrase: ", { input, output })).toBe(
        "secret",
      );
    } finally {
      closeSync(fd);
    }

    expect(Math.max(...sigintCounts)).toBe(baseline[0] + 1);
    // Removal is deferred one tick so a signal queued during the synchronous
    // prompt can still dispatch and re-raise instead of being swallowed.
    expect(process.listenerCount("SIGINT")).toBe(baseline[0] + 1);
    await flushImmediates();
    signals.forEach((s, i) => {
      expect(process.listenerCount(s)).toBe(baseline[i]);
    });
  });

  it("removes signal handlers one tick after the read throws", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const baseline = signals.map((s) => process.listenerCount(s));

    const input = {
      fd: -1,
      isTTY: true,
      isRaw: false,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    const output = { write: vi.fn() };

    expect(() => promptHiddenSync("Passphrase: ", { input, output })).toThrow();
    await flushImmediates();
    signals.forEach((s, i) => {
      expect(process.listenerCount(s)).toBe(baseline[i]);
    });
  });

  it("rejects accumulated input beyond MAX_HIDDEN_INPUT_LENGTH and restores the terminal", async () => {
    // No submit byte anywhere — a broken/hostile source feeding endless data.
    const fd = inputFd("a".repeat(MAX_HIDDEN_INPUT_LENGTH + 512));
    const input = {
      fd,
      isTTY: true,
      isRaw: false,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    const output = { write: vi.fn() };

    try {
      expect(() => promptHiddenSync("Passphrase: ", { input, output })).toThrow(
        HIDDEN_INPUT_TOO_LONG_MESSAGE,
      );
    } finally {
      closeSync(fd);
    }

    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(output.write).toHaveBeenCalledWith(DISABLE_BRACKETED_PASTE);
    await flushImmediates();
  });

  it("accepts input of exactly MAX_HIDDEN_INPUT_LENGTH", () => {
    const value = "a".repeat(MAX_HIDDEN_INPUT_LENGTH);
    const fd = inputFd(`${value}\n`);
    const input = {
      fd,
      isTTY: true,
      isRaw: false,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    const output = { write: vi.fn() };

    try {
      expect(promptHiddenSync("Passphrase: ", { input, output })).toBe(value);
    } finally {
      closeSync(fd);
    }
  });

  it("restores raw mode when fd reads fail", () => {
    const input = {
      fd: -1,
      isTTY: true,
      isRaw: true,
      pause: vi.fn(),
      resume: vi.fn(),
      setRawMode: vi.fn(),
    };
    const output = { write: vi.fn() };

    expect(() => promptHiddenSync("Passphrase: ", { input, output })).toThrow();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(true);
    expect(input.pause).toHaveBeenCalledOnce();
    expect(output.write).toHaveBeenCalledWith(DISABLE_BRACKETED_PASTE);
  });
});

// Signals can only be exercised end-to-end: the prompt is synchronous, so a
// signal delivered while it runs is queued by libuv and dispatched after the
// prompt unwinds. In-process tests cannot observe that without killing the
// test runner. Imports from dist/ — turbo's test task depends on build.
describe.skipIf(process.platform === "win32")(
  "promptHiddenSync external signals (child process)",
  () => {
    it("defers an external SIGTERM during the prompt, then re-raises it after completion", async () => {
      tmpDir = mkdtempSync(join(tmpdir(), "hidden-prompt-sig-"));
      const distUrl = new URL("../dist/cli/hidden-prompt.js", import.meta.url)
        .href;
      const childPath = join(tmpDir, "child.mjs");
      writeFileSync(
        childPath,
        `import { promptHiddenSync } from ${JSON.stringify(distUrl)};
const input = { fd: 0, isTTY: true, isRaw: false, pause() {}, resume() {}, setRawMode() {} };
const output = { write(chunk) { process.stderr.write(chunk); } };
const result = promptHiddenSync("pass: ", { input, output });
console.log("PROMPT_DONE " + JSON.stringify(result));
setTimeout(() => { console.log("SIGNAL_SWALLOWED"); process.exit(0); }, 500);
`,
        "utf8",
      );

      const child = spawn(process.execPath, [childPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d));
      child.stderr.on("data", (d: Buffer) => (stderr += d));
      const exited = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) =>
          child.on("exit", (code, signal) => resolve({ code, signal })),
      );

      // Wait until the prompt is live (bracketed paste enabled => signal
      // handlers are installed and the read loop is about to block).
      await vi.waitFor(() => {
        expect(stderr).toContain(ENABLE_BRACKETED_PASTE);
      });

      child.kill("SIGTERM");
      // The signal must be deferred, not fatal: the child stays alive while
      // blocked in readSync with the terminal in raw mode.
      await new Promise((r) => setTimeout(r, 200));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();

      child.stdin.write("hunter2\n");
      const { signal } = await exited;

      // The prompt completed and returned its value, the terminal was
      // restored, and only then did the queued SIGTERM re-raise with the
      // default disposition. SIGNAL_SWALLOWED would mean the deferred
      // removal regressed and the kill was dropped.
      expect(stdout).toContain('PROMPT_DONE "hunter2"');
      expect(stdout).not.toContain("SIGNAL_SWALLOWED");
      expect(stderr).toContain(DISABLE_BRACKETED_PASTE);
      expect(signal).toBe("SIGTERM");
    }, 15_000);
  },
);

function inputFd(content: string): number {
  tmpDir = mkdtempSync(join(tmpdir(), "hidden-prompt-test-"));
  const path = join(tmpDir, "input.txt");
  writeFileSync(path, content, "utf8");
  return openSync(path, "r");
}
