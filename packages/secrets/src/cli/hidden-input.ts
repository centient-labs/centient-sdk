/**
 * Hidden-Input State Machine
 *
 * Pure character-stream parser used by the secrets CLI's hidden-input prompt
 * (password / secret entry). Extracted from `secrets-cli.ts` so the parsing
 * rules can be exercised directly in tests without stubbing `process.stdin`.
 *
 * Regression: issue #37 — the previous prompt resolved on the first `\n`
 * from a terminal paste and silently truncated multi-line secrets (PEM keys,
 * multi-line config blobs) to their first line.
 */

/** VT100 bracketed-paste sentinels — wraps pasted content from the terminal. */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
/** Enable / disable bracketed paste mode on the current terminal. */
export const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
export const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";

/** Control characters recognized by the hidden-input state machine. */
export const CTRL_C = "\u0003";
export const CTRL_D = "\u0004";
export const BACKSPACE = "\u007F";
export const BS = "\b";

/** Signal emitted by {@link advanceHiddenInput} to indicate why input stopped. */
export type HiddenInputSignal = "submit" | "ctrl-c" | "continue";

/**
 * Mutable state for the hidden-input parser. Callers should construct a fresh
 * instance per prompt and feed chunks via {@link advanceHiddenInput}.
 */
export interface HiddenInputState {
  input: string;
  inPaste: boolean;
  escBuf: string;
  /**
   * True when the state machine has recognized an escape sequence that is not
   * a paste-marker prefix and is swallowing characters until the sequence's
   * terminator byte arrives. Prevents stray `~` / digits from unrelated CSI
   * sequences (e.g. Delete `\x1b[3~`, arrow keys) from leaking into `input`.
   */
  swallowingCsi: boolean;
}

export function createHiddenInputState(): HiddenInputState {
  return { input: "", inPaste: false, escBuf: "", swallowingCsi: false };
}

/**
 * CSI final-byte range per ECMA-48: `\x40`-`\x7E` (i.e. `@` through `~`). When
 * we're swallowing a CSI we know isn't a paste marker, we stop at the first
 * byte in this range that isn't a parameter byte (`0`-`9`, `;`, `:`, `<`-`?`).
 */
function isCsiTerminator(char: string): boolean {
  const code = char.charCodeAt(0);
  // Parameter / intermediate bytes — not terminators.
  if ((code >= 0x30 && code <= 0x3f) || (code >= 0x20 && code <= 0x2f)) return false;
  // Final byte range.
  return code >= 0x40 && code <= 0x7e;
}

/**
 * Advance the state machine with a single chunk from stdin. Returns `"submit"`
 * when the caller should resolve the prompt with `state.input`, `"ctrl-c"`
 * when the user interrupted, or `"continue"` when more input is expected.
 *
 * Character-by-character processing ensures escape-sequence state survives
 * across chunk boundaries (a fast paste may arrive split across many chunks,
 * and a single chunk may contain both paste markers and regular keystrokes).
 */
export function advanceHiddenInput(
  state: HiddenInputState,
  chunk: string,
): HiddenInputSignal {
  for (let i = 0; i < chunk.length; i++) {
    const char = chunk[i]!;

    // Swallowing a non-paste CSI sequence: drop characters until the CSI
    // terminator byte arrives, then resume normal processing.
    if (state.swallowingCsi) {
      if (isCsiTerminator(char)) state.swallowingCsi = false;
      continue;
    }

    // Accumulate potential bracketed-paste marker.
    if (state.escBuf || char === "\x1b") {
      state.escBuf += char;
      if (state.escBuf === PASTE_START) {
        state.inPaste = true;
        state.escBuf = "";
        continue;
      }
      if (state.escBuf === PASTE_END) {
        state.inPaste = false;
        state.escBuf = "";
        continue;
      }
      // If escBuf is no longer a prefix of either paste marker, it's a
      // different escape sequence (arrow keys, Delete, F-keys, etc.). Switch
      // to swallow-until-terminator mode so we don't leak the sequence's
      // final byte (e.g. `~` from `\x1b[3~`) into the input buffer.
      if (
        !PASTE_START.startsWith(state.escBuf) &&
        !PASTE_END.startsWith(state.escBuf)
      ) {
        // If the current char is already a terminator, we've consumed the
        // entire sequence; no need to swallow more.
        state.swallowingCsi = !isCsiTerminator(char);
        state.escBuf = "";
      }
      continue;
    }

    // Inside a bracketed paste, newlines are literal content.
    if (state.inPaste) {
      state.input += char;
      continue;
    }

    if (char === CTRL_C) return "ctrl-c";

    if (char === CTRL_D) {
      // Explicit end-of-input (multi-line escape hatch for terminals without
      // bracketed-paste support).
      return "submit";
    }

    if (char === "\n" || char === "\r") {
      // Single-line submit — preserves the old single-password UX.
      return "submit";
    }

    if (char === BACKSPACE || char === BS) {
      if (state.input.length > 0) state.input = state.input.slice(0, -1);
      continue;
    }

    state.input += char;
  }
  return "continue";
}
