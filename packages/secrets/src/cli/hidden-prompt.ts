/**
 * Synchronous hidden TTY prompt.
 *
 * KeyProvider implementations are synchronous today, so passphrase unlock
 * needs a sync wrapper around the hidden-input state machine. The parser stays
 * in hidden-input.ts; this file only owns terminal raw-mode and fd reads.
 */

import { readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import {
  advanceHiddenInput,
  createHiddenInputState,
  DISABLE_BRACKETED_PASTE,
  ENABLE_BRACKETED_PASTE,
} from "./hidden-input.js";

interface PromptInput {
  readonly fd?: number;
  readonly isRaw?: boolean;
  readonly isTTY?: boolean;
  pause?(): unknown;
  resume?(): unknown;
  setRawMode?(mode: boolean): unknown;
}

interface PromptOutput {
  write(chunk: string): unknown;
}

export interface HiddenPromptOptions {
  input?: PromptInput;
  output?: PromptOutput;
}

export class HiddenPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiddenPromptError";
  }
}

export const NON_INTERACTIVE_HIDDEN_PROMPT_MESSAGE =
  "Passphrase provider requires an interactive TTY. Run this command from a terminal so the passphrase can be typed, or configure keychain/1password for non-interactive use.";

const PROMPT_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/**
 * Prompt for a hidden single-line value from a real TTY.
 *
 * Returns null when the user sends Ctrl-C. Throws HiddenPromptError when stdin
 * is not an interactive TTY; callers should fail closed.
 *
 * Known limitation: the submitted value is returned as an immutable JS string,
 * which cannot be zeroed and lingers in the heap until GC — same residue class
 * as the session-vault key-in-RAM caveat. The transient read buffer IS zeroed
 * before return.
 */
export function promptHiddenSync(
  message: string,
  options: HiddenPromptOptions = {},
): string | null {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  if (input.isTTY !== true || typeof input.fd !== "number") {
    throw new HiddenPromptError(NON_INTERACTIVE_HIDDEN_PROMPT_MESSAGE);
  }

  const state = createHiddenInputState();
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(256);
  const wasRaw = input.isRaw === true;

  const restoreTerminal = (): void => {
    output.write(DISABLE_BRACKETED_PASTE);
    input.setRawMode?.(wasRaw);
    input.pause?.();
    output.write("\n");
  };

  // A signal's default disposition terminates the process without unwinding
  // the stack, so `finally` would never run and the terminal would be left in
  // raw mode with echo disabled. The terminal's own Ctrl-C arrives in-band as
  // \x03 under raw mode, so these handlers only matter for external signals
  // (`kill`, hangup). While readSync blocks, delivery is deferred until the
  // read returns — but installing the handlers suppresses the immediate
  // default kill, and the handler then restores the terminal and re-raises so
  // the default exit behavior is preserved.
  const onSignal = (signal: NodeJS.Signals): void => {
    restoreTerminal();
    process.kill(process.pid, signal);
  };
  for (const signal of PROMPT_SIGNALS) process.once(signal, onSignal);

  output.write(message);
  input.setRawMode?.(true);
  output.write(ENABLE_BRACKETED_PASTE);
  input.resume?.();

  try {
    while (true) {
      const bytesRead = readSync(input.fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return null;

      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      const signal = advanceHiddenInput(state, chunk);
      if (signal === "ctrl-c") return null;
      if (signal === "submit") return state.input;
    }
  } finally {
    // The read buffer held raw passphrase bytes — zero it before returning.
    buffer.fill(0);
    for (const signal of PROMPT_SIGNALS) {
      process.removeListener(signal, onSignal);
    }
    restoreTerminal();
  }
}
