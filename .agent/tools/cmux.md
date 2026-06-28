<!-- cl-sync src=6aad84c8 -->
# Tool: cmux (terminal multiplexer + built-in browser)

How an agent **drives** cmux while working. cmux is a Ghostty-based terminal
multiplexer that runs agents, terminals, and a **built-in browser** side by side
in "workspaces," all scriptable from a bundled `cmux` CLI over a Unix socket.
Tool-neutral: applies to any agent (Claude, Codex, …) running inside cmux.

Authoritative live surface: `cmux --help` and `cmux docs <topic>`
(`settings|api|browser|agents|dock|sidebars`). This file is the stable orientation
+ the non-obvious gotchas; it is not a flag reference.

## Am I in cmux? Where is the CLI?

- `env | grep CMUX_` — if `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` are set, you are
  inside cmux. If not, every cmux capability below simply does not apply.
- CLI: `cmux` (on PATH) or `$CMUX_BUNDLED_CLI_PATH`
  (e.g. `/Applications/cmux.app/Contents/Resources/bin/cmux`).

## Model

`window` → `workspaces` (tabs) → `panes` (splits) → `surfaces`. A `surface` is a
terminal, a browser, or an agent session. Target things by short ref
(`workspace:1`, `pane:2`, `surface:3`), index, or UUID; `CMUX_WORKSPACE_ID` /
`CMUX_SURFACE_ID` are the default targets, so most commands need no `--workspace`
/ `--surface`.

Orient: `cmux tree --all` (full map), `cmux list-workspaces`, `cmux list-panes`,
`cmux current-workspace`.

## Two capabilities worth reaching for

1. **Read another pane's output yourself** — `cmux read-screen --surface
   surface:5 --lines 30` (add `--scrollback` for history). Read a dev-server log
   or a stack trace directly instead of asking the operator to paste it.

2. **Drive the built-in browser** (no Chrome extension / MCP needed) — open one
   with `cmux new-pane --type browser --url http://localhost:3000`, then:
   - navigate/read: `cmux browser navigate <url>`, `reload`,
     `wait --load-state complete`, `get url|title|text|html`
   - interact: `cmux browser click|fill|type|select|press <…>`
   - inspect: `cmux browser snapshot`, `screenshot --out <path>`, `eval <js>`,
     `console list`

   So you can load the app, fill a form, read the DOM, screenshot it, and check
   console errors end-to-end — a first-class path for verifying UI changes.

## Drive terminals

- New pane: `cmux new-pane --type terminal --direction down`
- Run a command: `cmux send --surface surface:5 "cd <path> && bin/dev"` then
  `cmux send-key --surface surface:5 Enter`

## Gotchas

- **New panes open at `~`, not the project dir — `cd` first.**
- **Refs renumber across an app restart** — re-run `cmux tree` after a reopen
  before targeting anything by ref.
- **`respawn-pane --command` is destructive** — it replaces the surface and runs
  the command *as the pane's process*; if the command exits, the pane closes. Use
  `send` + `send-key` to start a process instead.
- **`resize-pane`** is relative pixels only, needs the pane focused AND its
  workspace visible, and a full-edge pane must be resized from a neighbor.
- **Persistence:** on relaunch cmux restores layout, browser URLs, and agent
  sessions — but a plain terminal reopens as a **fresh login shell at `~`**: no
  prior `cd`, and nothing exported in the old session survives. Re-establish the
  working dir, any env vars / activated virtualenvs / `nvm`-style shell state, and
  restart long-running processes (dev servers) — none of it auto-restores.
- **Config:** `~/.config/cmux/cmux.json` (JSONC) — back it up, edit, then
  `cmux reload-config` (no restart). Terminal font/theme/keybinds live in
  `~/.config/ghostty/config`.

## Related

- `cl cmux-snapshot` (see [cl.md](cl.md)) saves/relaunches a cmux working set,
  capturing per-pane command + cwd that `cmux tree` omits.
- Operator-facing setup (install, socket access mode, Claude integration, auth)
  is the cmux operator-onboarding runbook in the workspace repo.

Repo-specific additions: see `cmux-local.md` (loaded alongside this file).
