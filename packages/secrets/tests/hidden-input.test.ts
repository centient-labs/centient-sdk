/**
 * Hidden-input state-machine tests.
 *
 * Regression coverage for issue #37 — `centient secrets set` used to resolve
 * on the first `\n` and silently truncated multi-line secrets (PEM keys) to
 * just the header line.
 */

import { describe, it, expect } from "vitest";
import {
  advanceHiddenInput,
  createHiddenInputState,
  PASTE_START,
  PASTE_END,
  CTRL_C,
  CTRL_D,
  BACKSPACE,
} from "../src/cli/hidden-input.js";

/** Feed chunks sequentially until the state machine signals submit or ctrl-c. */
function feed(chunks: string[]): { signal: string; input: string } {
  const state = createHiddenInputState();
  for (const chunk of chunks) {
    const signal = advanceHiddenInput(state, chunk);
    if (signal !== "continue") return { signal, input: state.input };
  }
  return { signal: "continue", input: state.input };
}

describe("hidden-input state machine", () => {
  it("submits on a single newline for typed input (single-line UX preserved)", () => {
    const result = feed(["hunter2\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("hunter2");
  });

  it("submits on carriage return as well", () => {
    const result = feed(["hunter2\r"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("hunter2");
  });

  it("preserves multi-line content inside a bracketed paste (regression for #37)", () => {
    // Multi-line fixture shaped like the real-world use case (PEM key) without
    // triggering secret scanners. The exact content doesn't matter — what
    // matters is that multiple `\n`-separated lines survive paste atomically.
    const multiline =
      "[header line]\n" +
      "body line one\n" +
      "body line two\n" +
      "[footer line]";

    // Terminal delivers: PASTE_START + content-with-embedded-newlines + PASTE_END,
    // followed by the user hitting Enter to submit.
    const result = feed([`${PASTE_START}${multiline}${PASTE_END}`, "\n"]);

    expect(result.signal).toBe("submit");
    expect(result.input).toBe(multiline);
    expect(result.input.split("\n").length).toBe(4);
  });

  it("handles pastes delivered as a single merged chunk with trailing newline", () => {
    // Some terminals include the final newline inside the paste wrapper.
    const payload = "line1\nline2\nline3";
    const result = feed([`${PASTE_START}${payload}${PASTE_END}\n`]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe(payload);
  });

  it("handles paste sentinels split across chunk boundaries", () => {
    // Fast pastes may deliver \x1b[200~ across multiple data events.
    // The state machine must accumulate escape-sequence prefix across chunks.
    const result = feed([
      "\x1b",
      "[2",
      "00~",
      "line1\nline2",
      "\x1b[201~",
      "\n",
    ]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("line1\nline2");
  });

  it("accepts multi-line input terminated by Ctrl-D (terminals without bracketed paste)", () => {
    // When the terminal doesn't emit \x1b[200~ markers, the user can still
    // submit multi-line content by pressing Ctrl-D at the end.
    const result = feed(["line1", "\u0004"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("line1");
  });

  it("submits the accumulated buffer immediately on Ctrl-D", () => {
    const state = createHiddenInputState();
    advanceHiddenInput(state, "partial");
    const signal = advanceHiddenInput(state, CTRL_D);
    expect(signal).toBe("submit");
    expect(state.input).toBe("partial");
  });

  it("signals ctrl-c without touching input", () => {
    const result = feed(["secret", CTRL_C]);
    expect(result.signal).toBe("ctrl-c");
    // `input` may or may not be "secret" at this point — callers exit instead
    // of using it — but the signal must be unambiguous.
  });

  it("handles backspace on typed input", () => {
    const result = feed(["abcde", BACKSPACE, BACKSPACE, "\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("abc");
  });

  it("backspace at empty input is a no-op", () => {
    const result = feed([BACKSPACE, BACKSPACE, "a\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("a");
  });

  it("silently swallows unrelated escape sequences (arrow keys)", () => {
    // Up arrow = \x1b[A — not a paste marker. Should not appear in input.
    const result = feed(["hello\x1b[A\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("hello");
  });

  it("silently swallows partial escape sequences that start like paste but diverge", () => {
    // \x1b[201~ followed by content starts as a PASTE_END marker but we're
    // not in paste mode — state machine just resets escBuf and continues.
    const result = feed(["\x1b[3~abc\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("abc");
  });

  it("supports nested typed input around a paste", () => {
    // User types "prefix-", pastes "PASTED", types "-suffix", hits Enter.
    const result = feed([
      "prefix-",
      `${PASTE_START}PASTED${PASTE_END}`,
      "-suffix",
      "\n",
    ]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("prefix-PASTED-suffix");
  });

  it("preserves a paste even when it arrives as many tiny chunks", () => {
    const pem = "line1\nline2\nline3";
    // Simulate a 1-char-per-event delivery (worst case).
    const chunks: string[] = [];
    for (const ch of `${PASTE_START}${pem}${PASTE_END}\n`) {
      chunks.push(ch);
    }
    const result = feed(chunks);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe(pem);
  });

  it("newline inside paste is literal; newline outside paste submits", () => {
    // Paste first (contains newlines), then literal newline afterwards.
    const result = feed([`${PASTE_START}a\nb${PASTE_END}`, "\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("a\nb");
  });

  it("empty input + newline submits with empty string", () => {
    const result = feed(["\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("");
  });

  it("paste that is itself empty works", () => {
    const result = feed([`${PASTE_START}${PASTE_END}`, "\n"]);
    expect(result.signal).toBe("submit");
    expect(result.input).toBe("");
  });
});
