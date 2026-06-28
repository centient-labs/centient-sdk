<!-- cl-sync src=65dcaf5d -->
# Handoff Creation Procedure

When and how to write a session handoff. A handoff is a single file that lets
a fresh session pick up cold without re-deriving state from git, memory, or
chat history.

Pairs with `procedures/handoff-template.md` (the actual template) and
`procedures/session-kickoff.md` (the reader's procedure).

## When to write a handoff

Write one when ANY of these holds:

- Work spans multiple sessions or multiple days
- State is complex: open PRs across repos, in-flight migrations, partial
  implementations, blocked-on-upstream items
- Bug-bash or incident wrap-up where context will be needed later
- Workstream charter (longer-term initiative with multiple stages)
- Session-end checkpoint regardless of completion — the next session should
  know what's in flight

Skip when:

- The work fully completed in-session and shipped
- Trivial fixes / single-PR work where the PR description carries full context
- Read-only exploration with no follow-up

## Where it goes

`docs/handoffs/YYYY-MM-DD-HANDOFF-topic.md` (e.g.,
`docs/handoffs/2026-05-09-HANDOFF-shepherd-system.md`).

**Date-first, then the uppercase type token, then the kebab descriptor**
(`<date>-<TYPE>-<descriptor>.md`). Date-first makes a directory of mixed
dated docs (handoffs, audits, retros) sort chronologically in one listing;
a type-first name only sorts within its own prefix. Legacy
`HANDOFF-YYYY-MM-DD-topic.md` files remain readable (the kickoff procedure
normalizes both forms when sorting) — `git mv` them to date-first when you
next touch them.

For workspace-meta repos without a `docs/` directory, a top-level `HANDOFF.md`
is acceptable as a current-snapshot file — but rotate to `docs/handoffs/`
when the directory is created.

## What it must contain

Minimum sections (see `handoff-template.md` for the fillable structure):

1. **Priority for next session** — 1-3 specific actions, in order
2. **What was accomplished** — concrete, with PR links / file paths / metrics
3. **Open follow-ups** — known unfinished items with current state
4. **Operational notes** — commands, paths, credential references (vault
   entry names, keychain entries, or env var names — never actual secret
   values) the next session will need
5. **Hard guardrails** — anything the next session must not do, and why

## How to write one

1. Copy the template (creating `docs/handoffs/` if needed). Set the
   `topic` shell variable to a kebab-case slug of the workstream; the
   snippet interpolates it into the destination filename. The sentinel
   default refuses to proceed if you forget to edit, and `cp -n`
   prevents silently overwriting a same-day handoff for the same topic.
   ```bash
   topic=REPLACE_ME    # <-- EDIT THIS to your kebab-case slug
   if [ "$topic" = REPLACE_ME ] || [ -z "$topic" ]; then
     echo "edit topic= to a kebab-case slug first" >&2
     exit 1
   fi
   mkdir -p docs/handoffs && \
     cp -n .agent/procedures/handoff-template.md \
           "docs/handoffs/$(date +%Y-%m-%d)-HANDOFF-${topic}.md"
   ```
   `cp -n` exits non-zero without overwrite if the destination already
   exists; re-run with a different `topic` if you hit that case.
2. **Fill the YAML frontmatter completely.** It is the machine-readable
   contract: session-start hooks and `/cl-resume-session` parse it instead
   of the prose. `engram_session` is the exact `sessionId` this session
   passed to `start_session_coordination` (so the next session can
   `load_session` deterministically); `handoff_issue` is back-filled after
   the handoff issue is created; use `null` — never a blank — for fields
   that don't apply.
3. Fill in sections top-to-bottom. The template marks each section
   **(required)** or **(optional)**:
   - **Required sections** (the minimum-section set above) must remain
     in the file. If a required section has nothing real to say, write
     a one-line `n/a — <reason>` rather than deleting the heading.
   - **Optional sections** can be deleted cleanly when they don't apply.
     Empty optional sections rot; either fill them or remove them.
4. Cite specific PRs / issues / commits with **full URLs**. Handoffs are
   read in fresh contexts where short refs are ambiguous.
5. **Convert relative dates to absolute.** "Thursday" → "2026-05-15."
   Handoffs outlive their relative time references.

## Anti-patterns

- **"We'll figure it out" sections.** If you don't know, say
  "Open question: X" with the question framed.
- **Vague pointers.** "Check the auth code" → "Check
  `src/auth/token-provider.ts:142` — the token cache TTL handling."
- **Relative time references.** "Yesterday" / "next week" → absolute dates.
- **Copy-paste from chat.** Synthesize. The handoff is a contract, not a
  transcript.
- **Burying decisions.** Open questions and pending decisions go in their
  own section, not inline in narrative prose.

Repo-specific additions: see `handoff-creation-local.md` (loaded alongside this file).
