<!-- cl-sync src=0cfc6826 -->
# Tool: `cl` (the centient-labs workspace CLI)

The `cl` binary is the agent's primary command surface for workspace, PR, engram,
and cmux operations. Tool-neutral: applies to any agent (Claude, Codex, …).

Authoritative live surface: `cl --help` and `cl <command> --help`. This file is
the stable orientation + the conventions that do not change; it is **not** a flag
reference (the command set grows — always confirm with `--help`).

## Command families

| Command | What it does |
|---|---|
| `cl tidy [branch] [--yes]` | Post-merge branch cleanup + repo sync. |
| `cl repo <create\|move\|sync\|gitignore> [--execute]` | Workspace repo lifecycle (manifest-driven, band-prefixed managed repos). |
| `cl pr <status\|watch> [--mine]` | **Read-only** PR query/watch over your open PRs. |
| `cl merge-drain [--execute] [--watch[=s]] [--exclude/--only <repos>]` | **BREAK-GLASS** fallback merger — only when the mbot merge queue is down and merges are operator-authorized. Merges only PRs mbot APPROVED on their current head. |
| `cl note <type> <title> <content>` | Write a knowledge crystal to engram. |
| `cl recall <query>` | Search the engram knowledge store. |
| `cl cmux-snapshot <save\|list\|show\|launch> [--execute]` | Save/relaunch a cmux working set (panes + commands + cwd). Must run inside a cmux pane. See [cmux.md](cmux.md). |

(The set grows — e.g. a `cl init` to bootstrap the session/handoff convention into
an arbitrary repo is planned. Always check `cl --help`.)

## Conventions that hold across `cl`

- **Dry-run by default; `--execute` to mutate.** `cl repo`, `cl merge-drain`, and
  `cl cmux-snapshot launch` print the plan and change nothing without `--execute`.
  Read the dry-run before executing.
- **Read vs. write.** `cl pr`, `cl recall`, and the dry-run of any command are
  read-only and always safe to run. The mutating `--execute` paths are not.

## Operator-only (do not run these as an agent)

Some `cl` paths perform **privileged / irreversible** actions that are reserved
for an operator on a trusted workstation — an agent must not invoke them:

- `cl repo create --execute` — creates a GitHub repo and applies a ruleset (a
  `gh api` POST an agent's token is not authorized for).
- `cl merge-drain --execute` — admin-merges PRs; run only under explicit
  operator authorization (it is the break-glass path, not the normal one — the
  mbot merge queue is the primary merger).
- Anything that publishes (`make publish`), unlocks a vault, or rotates
  credentials.

When a task needs one of these, **stop and surface it to the operator** rather
than attempting it.

**The primary control is this documented policy plus agent compliance** — treat
the list as a hard boundary and **do not rely on a technical block existing**.
Some paths *do* have technical backstops (an agent's GitHub token cannot perform
the `gh api` POST behind `cl repo create --execute`; admin-merge and the
break-glass `merge-drain --execute` are gated by the harness's auto-mode
classifier), but that coverage is **partial** — a new privileged path can ship
before any control guards it. So the rule is compliance-first: when a task seems
to need a privileged path, stop and ask the operator rather than testing whether
it happens to be blocked.

## Notes

- `cl` is a **private** binary, installed from the private homebrew tap. Never
  publish it (or `maintainer`) to a public tap.
- Engram commands (`cl note`/`cl recall`) degrade cleanly when no engram daemon
  is present — they are not required for `cl` to function.

Repo-specific additions: see `cl-local.md` (loaded alongside this file).
