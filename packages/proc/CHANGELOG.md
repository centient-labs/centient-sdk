# @centient/proc

## 0.1.0

### Minor Changes

- 53f5712: New package `@centient/proc`: hardened subprocess runner. Wraps
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

  The `command` and `args` are passed to `spawn` verbatim and are never
  shell-interpreted, so there is no shell-metacharacter injection surface. The one
  shell-agnostic injection vector — a NUL byte (`\0`), which would silently
  truncate the C-string the underlying syscall sees — is rejected eagerly with a
  typed `spawn-failure` before touching the OS; every other byte is forwarded
  unchanged. `env` is likewise forwarded verbatim: omitting it lets `spawn`
  inherit the parent environment, and an explicit `{}` is honored as-is.
