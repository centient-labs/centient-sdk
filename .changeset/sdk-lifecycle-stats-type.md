---
"@centient/sdk": minor
---

Fix `SessionsResource.getLifecycleStats` return type to match the server. Closes #47.

## What changed

The return type of `sessions.getLifecycleStats(sessionId)` was a look-alike of a different endpoint entirely — it declared `{ noteCount, decisionCount, constraintCount, branchCount, stuckDetectionCount, durationMinutes }`, while the server (`engram-server` `services/sessions.ts:141`) returns a `Record<LifecycleStatus, number>` histogram: `{ draft, active, finalized, archived, superseded, merged }`. The Python SDK already has the correct shape.

Also extends the exported `LifecycleStatus` union with `"merged"` so all six server-side states round-trip correctly:

```ts
export type LifecycleStatus =
  | "draft" | "active" | "finalized" | "archived" | "superseded" | "merged";

async getLifecycleStats(
  sessionId: string,
): Promise<Record<LifecycleStatus, number>>;
```

## Bump rationale: minor, not major

This is technically a public-type change — any caller with `stats.noteCount` in their code will fail to compile. But the declared shape never matched the wire response, so any such caller was already broken at runtime. The only code that compiled *and* worked against this method used a double-cast (`as unknown as Record<string, number>`), and those callers will now compile cleanly without the cast. Treating this as a bug fix + runtime-truthful type correction, not a new contract.

Upstream reference: `engram-server#67` added exactly the double-cast workaround, which the maintainer bot correctly flagged as pointing back here.

## Follow-up (not in this PR)

- Python `LifecycleStats` in `sdk-python/engram/types/sessions.py:151` is also missing the `"merged"` key; separate issue to track.
