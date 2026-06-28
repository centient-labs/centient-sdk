<!-- cl-sync src=14125a82 -->
---
topic: <kebab-case-slug>
date: YYYY-MM-DD
author: <agent or operator name>
engram_session: <sessionId passed to start_session_coordination, e.g. 2026-06-09-topic; null if MCP was unavailable>
handoff_issue: <GitHub issue number for the handoff baton; null if --no-issue>
predecessor: <previous handoff filename (repo-relative path) or null>
---

# Handoff: <one-line topic>

<!-- Copy this file to docs/handoffs/YYYY-MM-DD-HANDOFF-topic.md and fill in.
     (Date-first filename: dated docs sort chronologically in a directory
     listing regardless of type.)
     The YAML frontmatter above is machine-read by session-start hooks and
     /cl-resume-session — fill every field; use null, not blank, when a
     field doesn't apply. handoff_issue is filled in AFTER the issue is
     created (the issue creation step edits it back in).
     Sections labelled (required) below are the minimum-section set
     enforced by procedures/handoff-creation.md — do not delete them. If
     a required section has nothing to say, write a one-line "n/a —
     <reason>" instead of removing the heading.
     Sections labelled (optional) may be deleted cleanly when they do
     not apply. See procedures/handoff-creation.md for guidance. -->

## Priority for next session **(required)**

1. <action 1 — specific, with PR/issue/file references>
2. <action 2>
3. <action 3>

## What was accomplished **(required)**

### <Workstream name>

- <PR or shipped change with full URL>
- <Metric or concrete outcome — e.g., "17/19 repos compliant", "4 PRs merged">

### <Another workstream, if any>

...

## Open follow-ups **(required)**

| Item | State | Owner | Blocker |
|------|-------|-------|---------|
| [description] | open / in-review / blocked | [name or "—"] | [issue link or "—"] |

## Operational notes **(required)**

### Commands

```bash
# Common commands the next session will need
```

### Paths and credentials

- `<path>` — what it's for
- Credential source: <vault entry name / keychain entry / env var>

## Hard guardrails **(required)**

- <Thing the next session must not do, with reason>
- <Example: "Do not push to `main` of `support/maintainer` while #189 is open
   — pnpm test passthrough bug will fail CI">

## Open questions **(optional)**

- <Question framed as a question, with the decision-maker named if known>

## References **(optional)**

- ADRs: <links>
- Issues: <links>
- PRs: <links>
- Prior handoffs: <links>
