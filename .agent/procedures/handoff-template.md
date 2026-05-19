# Handoff: <one-line topic>

**Date:** YYYY-MM-DD
**Author:** <agent or operator name>
**Predecessor:** <previous handoff filename, if any — repo-relative path or full GitHub URL>

<!-- Copy this file to docs/handoffs/HANDOFF-YYYY-MM-DD-topic.md and fill in.
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
