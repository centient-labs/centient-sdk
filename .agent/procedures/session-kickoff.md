# Session Kickoff Procedure

What a fresh session does first, before any task-specific work. Pairs with
`procedures/session-management.md` (MCP knowledge tools used throughout the
session) and `procedures/handoff-creation.md` (the writer's side of the
handoff/kickoff loop).

## Standard kickoff sequence

In order:

1. **Read `CLAUDE.md`** (auto-loaded). Verify it has the design-philosophy
   pointer and the Session & Knowledge Management block.
2. **Check for recent handoffs** at `docs/handoffs/HANDOFF-*.md`. The
   most recent one tells you what's in flight. Gate on the directory
   first so missing-dir is a clean no-op without globally silencing
   stderr (which would hide real I/O errors like permission denials
   or broken symlinks):
   ```bash
   latest=
   if [ -d docs/handoffs ]; then
     latest=$(find docs/handoffs -maxdepth 1 -type f -name 'HANDOFF-*.md' | sort | tail -1)
   fi
   if [ -n "$latest" ]; then
     cat "$latest"
   fi
   # empty $latest = no handoff yet (safe under set -e)
   ```
   The `YYYY-MM-DD` filename prefix makes lexicographic sort
   chronological. Do NOT use mtime — it is affected by checkout order.
   `-type f` filters out any directory that happens to match the glob.
   Test the **value of `$latest`**, not the pipeline's `$?`: `find ...
   | sort | tail` exits 0 whether or not anything matched, so `$?`
   cannot distinguish "no handoff" from "I/O error" — only the value
   of `$latest` can.
3. **Initialize the MCP session.** Call `mcp__centient__start_session_coordination`
   with `sessionId="YYYY-MM-DD-<keyword>"` and the absolute `projectPath`.
   See `procedures/session-management.md` for parameters.
4. **Search memory for the task topic.** Call `mcp__centient__search_crystals`
   with the keyword. Skim the top results for prior decisions.
5. **Check repo state** (fetch first — `git status -sb` only reports
   ahead/behind against locally-cached remote refs, which can be stale):
   ```bash
   git fetch --prune
   git status -sb
   git log --oneline -10
   gh pr list --state open --author "@me"
   ```

## When to skip steps

- **Trivial tasks** (typo fixes, single-line changes): skip steps 3-5.
- **MCP unavailable**: skip steps 3-4. Note in your first response so the
  operator knows the knowledge layer is offline.
- **No `docs/handoffs/`**: skip step 2 silently.
- **No prior PRs by the agent**: step 5's `gh pr list` returns empty, which
  is fine.

## What you should know after kickoff

By the end of the kickoff sequence, you should be able to answer:

1. What is the in-flight workstream, if any?
2. What PRs are open and at what review state?
3. What did the previous session leave for this one?
4. Are there active branches I should switch to, or stay off of?

If you can't answer these, keep digging before starting the user's task.
The kickoff is cheap; an uninformed first action is expensive.

## Anti-patterns

- **Skipping the handoff read** and then asking the user "what should I
  work on?" — they'll point you at the handoff. Read it first.
- **Initializing the MCP session after starting work.** Duplicate-detection
  and search lose value if state isn't established up front.
- **Treating kickoff as ceremony.** If a step gives you nothing useful,
  that's a signal — note it, don't fail. But don't skip steps because
  "they probably won't help."
- **Branching from a stale local `main`.** `git status -sb` reads
  locally-cached remote-tracking refs; without a preceding `git fetch`,
  ahead/behind counts may be hours or days out of date. Always fetch
  first (step 5 does this) before deciding whether to rebase or branch.

## Repo-specific

<!-- Append repo-specific kickoff steps here: daemon health checks,
     cluster connectivity probes, project-specific status commands
     (e.g., "maintainer status" before working on the maintainer repo),
     credential verification. -->
