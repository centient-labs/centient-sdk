<!-- cl-sync src=62d87ba6 -->
# Session Kickoff Procedure

What a fresh session does first, before any task-specific work. Pairs with
`procedures/session-management.md` (MCP knowledge tools used throughout the
session) and `procedures/handoff-creation.md` (the writer's side of the
handoff/kickoff loop).

## Standard kickoff sequence

In order:

1. **Read `CLAUDE.md`** (auto-loaded). Verify it has the design-philosophy
   pointer and the Session & Knowledge Management block.
2. **Check for recent handoffs** at `docs/handoffs/YYYY-MM-DD-HANDOFF-*.md`
   (legacy files may still be named `HANDOFF-YYYY-MM-DD-*.md`). The
   most recent one tells you what's in flight. Gate on the directory
   first so missing-dir is a clean no-op without globally silencing
   stderr (which would hide real I/O errors like permission denials
   or broken symlinks):
   ```bash
   latest=
   if [ -d docs/handoffs ]; then
     latest=$(find docs/handoffs -maxdepth 1 -type f -name '*HANDOFF*.md' \
       | awk -F/ '{key=$NF; sub(/^HANDOFF-/, "", key); print key "\t" $0}' \
       | sort | tail -1 | cut -f2-)
   fi
   if [ -n "$latest" ]; then
     cat "$latest"
   fi
   # empty $latest = no handoff yet (safe under set -e)
   ```
   The date-first `YYYY-MM-DD` filename prefix makes lexicographic sort
   chronological; the `awk` step normalizes legacy `HANDOFF-YYYY-MM-DD-*`
   names to the same date-first key so old and new files sort together
   (without it, every legacy name would sort after every date-first name,
   since letters compare greater than digits). Do NOT use mtime — it is
   affected by checkout order. `-type f` filters out any directory that
   happens to match the glob. Test the **value of `$latest`**, not the
   pipeline's `$?`: `find ... | sort | tail` exits 0 whether or not
   anything matched, so `$?` cannot distinguish "no handoff" from "I/O
   error" — only the value of `$latest` can.
3. **Initialize the MCP session.** Call `mcp__centient__start_session_coordination`
   with `sessionId="YYYY-MM-DD-<keyword>"` and the absolute `projectPath`.
   See `procedures/session-management.md` for parameters.
4. **Ground in prior lessons before planning** (required for non-trivial work —
   ADR-004 §3). For anything beyond the trivial-task skip set below, loading
   relevant prior lessons is a **non-skippable** step, not optional on-demand
   recall. Two sources combine:
   - the repo's **auto-loaded `.agent/` rules** are already in context (no
     action needed) — the distilled standing rules every session inherits;
   - **plus a mandatory engram recall**: call `mcp__centient__search_crystals`
     with the task's keywords and read the top hits as **grounding, surfaced
     before you plan** — phrase what you find as priming questions and
     past-mistake examples, e.g.:
     - *Where does this belong — have we solved this (or something close)
       before, even in another repo?*
     - *What did past PRs on this surface get wrong? What did a reviewer flag
       last time?*
     - *What standing rule or constraint already governs this area?*

   Carry the answers into the plan (see `procedures/plan-gate.md`); do not start
   writing code with the recall still unread. An empty recall is a result —
   say so — not a reason to skip the step.
5. **Check repo state** (fetch first — `git status -sb` only reports
   ahead/behind against locally-cached remote refs, which can be stale):
   ```bash
   git fetch --prune --quiet
   git status -sb
   git log --oneline -10
   gh pr list --state open --author "@me"
   ```
   `--quiet` suppresses the per-ref output but still reports actual errors.
   On large repos the fetch can add noticeable latency; skip steps 3-5
   entirely for trivial tasks per "When to skip steps" below.

## When to skip steps

- **Trivial tasks** (typo fixes, single-line changes): skip steps 3-5. The
  grounding recall (step 4) is exempt **only** here — for all non-trivial work
  it is required, not optional. This is the same trivial-task boundary the
  plan-gate uses (`procedures/plan-gate.md`).
- **MCP unavailable**: skip steps 3-4, but **do not skip grounding entirely** —
  the engram recall is gone, not the grounding requirement. Fall back to the
  always-in-context auto-loaded `.agent/` rules, plus a manual sweep of
  `docs/handoffs/` and `git log` for prior lessons on this surface. Note in your
  first response that the knowledge layer is offline so the operator knows the
  engram recall didn't run and the grounding is degraded.
- **No `docs/handoffs/`**: skip step 2 silently.
- **No prior PRs by the agent**: step 5's `gh pr list` returns empty, which
  is fine.

## What you should know after kickoff

By the end of the kickoff sequence, you should be able to answer:

1. What is the in-flight workstream, if any?
2. What PRs are open and at what review state?
3. What did the previous session leave for this one?
4. Are there active branches I should switch to, or stay off of?
5. **If the work is non-trivial:** what prior lessons ground this task — past
   mistakes, reviewer findings, or standing rules that already govern this area?
   (Trivial tasks skip this — see "When to skip steps".)

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
- **Planning before grounding.** Starting to plan (or write code) on
  non-trivial work with the step-4 recall still unread re-creates the
  recall-on-demand failure ADR-004 §3 exists to fix — the lesson arrives
  too late to change the plan. Recall first, plan with it in hand.
- **Branching from a stale local `main`.** `git status -sb` reads
  locally-cached remote-tracking refs; without a preceding `git fetch`,
  ahead/behind counts may be hours or days out of date. Always fetch
  first (step 5 does this) before deciding whether to rebase or branch.

Repo-specific additions: see `session-kickoff-local.md` (loaded alongside this file).
