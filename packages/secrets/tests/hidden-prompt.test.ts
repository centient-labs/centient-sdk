import { afterEach, describe, expect, it, vi } from "vitest";
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
  HiddenPromptError,
  promptHiddenSync,
} from "../src/cli/hidden-prompt.js";

let tmpDir: string | null = null;

afterEach(() => {
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

function inputFd(content: string): number {
  tmpDir = mkdtempSync(join(tmpdir(), "hidden-prompt-test-"));
  const path = join(tmpDir, "input.txt");
  writeFileSync(path, content, "utf8");
  return openSync(path, "r");
}
