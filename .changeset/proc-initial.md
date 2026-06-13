---
"@centient/proc": minor
---

New package `@centient/proc`: hardened subprocess runner. Wraps
`node:child_process` `spawn` with wall-clock timeouts, SIGTERM-then-SIGKILL kill
escalation, per-stream output buffer caps, `AbortSignal` cancellation, stdin
streaming, and a single typed `ProcError` whose `kind` distinguishes
spawn-failure / non-zero-exit / timeout / signal / buffer-overflow / aborted /
stdin-error. The returned promise settles exactly once (a tested invariant).
Clock and spawn are injectable so timeout and kill escalation are
deterministically testable. Zero external runtime dependencies, ESM-only.

`encoding` accepts any Node `BufferEncoding` (`hex`, `base64`, `latin1`, …) in
addition to `"buffer"`. `killGraceMs: 0` sends `SIGKILL` immediately without a
racing same-tick `SIGTERM`. Unexpected stdin write failures (e.g. `ENOSPC`) on
an otherwise-clean exit surface as a `stdin-error` instead of being swallowed;
expected pipe teardown (`EPIPE`) is still ignored. `buffer-overflow` errors now
carry `actualBytes` alongside `limitBytes`.
