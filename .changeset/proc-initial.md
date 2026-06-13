---
"@centient/proc": minor
---

New package `@centient/proc`: hardened subprocess runner. Wraps
`node:child_process` `spawn` with wall-clock timeouts, SIGTERM-then-SIGKILL kill
escalation, per-stream output buffer caps, `AbortSignal` cancellation, stdin
streaming, and a single typed `ProcError` whose `kind` distinguishes
spawn-failure / non-zero-exit / timeout / signal / buffer-overflow / aborted.
The returned promise settles exactly once (a tested invariant). Clock and spawn
are injectable so timeout and kill escalation are deterministically testable.
Zero external runtime dependencies, ESM-only.
