# Session & Knowledge Management

Protocol for using the centient knowledge management system. The centient MCP server (`mcp__centient__*`) provides session memory and a cross-project knowledge graph. Consistent use prevents duplicate work, preserves context, and enables cross-project learning.

## Tool Reference

### Session Lifecycle

| Tool | When | Purpose |
|------|------|---------|
| `start_session_coordination` | Session start | Initialize session memory, optionally seed with related knowledge |
| `save_session_note` | During work | Record decisions, findings, blockers, hypotheses |
| `finalize_session_coordination` | Session end | Persist session artifacts to knowledge graph |

### Knowledge Search

| Tool | When | Purpose |
|------|------|---------|
| `search_crystals` | Before starting work | Find prior decisions, patterns, and related work |
| `check_duplicate_work` | Before implementing | Detect if similar work was done in another session |
| `search_artifacts` | When looking for specific outputs | Find code, docs, or other artifacts from past sessions |

### Context Monitoring

| Tool | When | Purpose |
|------|------|---------|
| `get_context_health` | Periodically | Check context window capacity |
| `get_session_summary` | Mid-session | Review what's been captured so far |
| `get_session_drift` | When focus shifts | Detect topic drift from original session goal |

## Parameters

### start_session_coordination

```
sessionId:    "YYYY-MM-DD-topic" (e.g., "2026-04-07-auth-refactor")
projectPath:  Absolute path to project directory
seedTopic:    Optional keyword to pre-load related knowledge
```

### save_session_note

```
note:   Free-text description of the decision, finding, or blocker
tags:   Array of keywords for future searchability
```

### search_crystals

```
query:  Natural language description of what you're looking for
mode:   "hybrid" (default), "semantic", or "keyword"
limit:  Number of results (default: 10)
```

## When NOT to Use

- **Trivial tasks**: Quick typo fixes, single-line changes — no session needed
- **Tools unavailable**: If `mcp__centient__*` tools aren't in the tool list, skip silently
- **Read-only exploration**: Browsing code without making changes — search is still useful, but session lifecycle is optional
