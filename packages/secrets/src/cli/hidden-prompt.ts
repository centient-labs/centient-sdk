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

/**
 * Upper bound on accumulated hidden input. Interactive passphrases and pasted
 * multi-line secrets (PEM keys, config blobs — issue #37) fit comfortably;
 * the cap exists so a hostile or broken input source feeding endless bytes
 * without a submit cannot grow `state.input` without bound.
 */
export const MAX_HIDDEN_INPUT_LENGTH = 65_536;

export const HIDDEN_INPUT_TOO_LONG_MESSAGE = `Hidden input exceeded ${MAX_HIDDEN_INPUT_LENGTH} characters without a submit; aborting prompt.`;

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

  let restored = false;
  const restoreTerminal = (): void => {
    if (restored) return;
    restored = true;
    output.write(DISABLE_BRACKETED_PASTE);
    input.setRawMode?.(wasRaw);
    input.pause?.();
    output.write("\n");
  };

  // A signal's default disposition terminates the process without unwinding
  // the stack, so `finally` would never run and the terminal would be left in
  // raw mode with echo disabled. The terminal's own Ctrl-C arrives in-band as
  // \x03 under raw mode, so these handlers only matter for external signals
  // (`kill`, hangup).
  //
  // Timing: this entire prompt is synchronous, so the event loop cannot
  // dispatch a signal's JS callback while it runs — an external signal
  // received here is queued by libuv and dispatched only after the prompt
  // unwinds. Installing the listeners suppresses the immediate default kill
  // (protecting raw mode); the deferred handler then re-raises so the default
  // exit behavior is preserved. That is also why removal is deferred one tick
  // in `finally` below: removing the listeners synchronously would drop the
  // queued dispatch and the process would silently ignore a kill received
  // during the prompt.
  const onSignal = (signal: NodeJS.Signals): void => {
    // Remove ALL prompt listeners (not just this signal's spent `once`
    // wrapper) before re-raising, so the re-raised signal hits the default
    // disposition and sibling handlers cannot fire after the prompt is done.
    removeSignalHandlers();
    restoreTerminal();
    process.kill(process.pid, signal);
  };
  const removeSignalHandlers = (): void => {
    for (const signal of PROMPT_SIGNALS) {
      process.removeListener(signal, onSignal);
    }
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
      if (state.input.length > MAX_HIDDEN_INPUT_LENGTH) {
        // Drop the reference before throwing; the string itself is immutable
        // and lingers until GC (same residue class as the documented caveat).
        state.input = "";
        throw new HiddenPromptError(HIDDEN_INPUT_TOO_LONG_MESSAGE);
      }
    }
  } finally {
    // The read buffer held raw passphrase bytes — zero it before returning.
    buffer.fill(0);
    restoreTerminal();
    // Deferred (see the comment on onSignal): a signal received while
    // readSync blocked has not been dispatched yet — removing the listeners
    // now would swallow it. One tick later either the queued handler has
    // re-raised (process is exiting) or there was no signal and this is a
    // plain cleanup.
    setImmediate(removeSignalHandlers);
  }
}
