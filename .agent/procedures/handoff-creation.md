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

`docs/handoffs/HANDOFF-YYYY-MM-DD-topic.md` (e.g.,
`docs/handoffs/HANDOFF-2026-05-09-shepherd-system.md`).

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
   snippet interpolates it into the destination filename. The default
   value is intentionally invalid so the snippet refuses to proceed
   if you forget to edit it. (`REPLACE_ME` matches the `YOUR_SERVICE`
   placeholder convention used in `patterns/known-pitfalls.md`.)
   ```bash
   topic=REPLACE_ME    # <-- EDIT THIS to your kebab-case slug
   : "${topic:?set topic= to a kebab-case slug}"
   if [ "$topic" = REPLACE_ME ]; then
     echo "edit topic= first" >&2
     exit 1
   fi
   mkdir -p docs/handoffs && \
     cp .agent/procedures/handoff-template.md \
        "docs/handoffs/HANDOFF-$(date +%Y-%m-%d)-${topic}.md"
   ```
2. Fill in sections top-to-bottom. The template marks each section
   **(required)** or **(optional)**:
   - **Required sections** (the minimum-section set above) must remain
     in the file. If a required section has nothing real to say, write
     a one-line `n/a — <reason>` rather than deleting the heading.
   - **Optional sections** can be deleted cleanly when they don't apply.
     Empty optional sections rot; either fill them or remove them.
3. Cite specific PRs / issues / commits with **full URLs**. Handoffs are
   read in fresh contexts where short refs are ambiguous.
4. **Convert relative dates to absolute.** "Thursday" → "2026-05-15."
   Handoffs outlive their relative time references.
5. Date the file in its frontmatter or H1 subtitle.

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

## Repo-specific

<!-- Append repo-specific handoff conventions here: storage location overrides,
     naming conventions, required cross-references (e.g., ADR links),
     cadence (every release, every incident, weekly). -->
