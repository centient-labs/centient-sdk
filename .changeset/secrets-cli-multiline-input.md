---
"@centient/secrets": patch
---

Fix `centient secrets set` silently truncating multi-line values at the first newline. Closes #37.

### Symptom

Pasting a multi-line secret (PEM private key, multi-line config blob) into the interactive hidden prompt stored only the content up to the first `\n` — e.g. a PEM would store just the header line (`BEGIN RSA PRIVATE KEY`) and drop the rest. `secrets get` then returned the truncated 30-char header, breaking any downstream consumer expecting a valid PEM. Blocked the maintainer daemon's credential-migration workflow.

### Root cause

`prompt()` in `src/cli/secrets-cli.ts` listened for raw-mode `data` events and resolved on the first `\n` / `\r`. For a terminal paste, the first newline between the header line and the key body terminated input.

### Fix

Two independent paths, both correct now:

- **Piped / non-TTY stdin** (`cat key.pem | centient secrets set ...`): detect `!process.stdin.isTTY` and read the whole stream to EOF via `for await (const chunk of process.stdin)`. Trim a single trailing newline (pipe artifact); preserve all other whitespace.
- **Interactive TTY**: enable VT100 bracketed-paste mode (`\x1b[?2004h`). Content wrapped in `\x1b[200~ ... \x1b[201~` is treated atomically — newlines inside a paste are literal content, not submit signals. Single typed `\n` still submits (preserves password UX). `Ctrl-D` is an explicit end-of-input escape hatch for terminals without bracketed-paste support.

### Testing

Extracted the parsing state machine into `src/cli/hidden-input.ts` as a pure function so it can be unit-tested without stubbing `process.stdin`. 16 new tests cover:

- Bracketed paste with embedded newlines preserved (#37 regression)
- Paste markers split across multiple data chunks
- Paste delivered one char per chunk (worst-case timing)
- Ctrl-D multi-line submit
- Single-line Enter-to-submit (backward-compat)
- Backspace behavior
- Unrelated escape sequences (arrow keys, Delete `\x1b[3~`) silently swallowed via CSI terminator detection — no more `~` leaking into input
- Typed + pasted content interleaved
- Empty paste, empty input

### Supported terminals

Bracketed paste is supported by iTerm2, kitty, Alacritty, foot, WezTerm, xterm, GNOME Terminal, and VS Code's integrated terminal. On terminals without bracketed-paste support, Ctrl-D is the multi-line escape hatch.
