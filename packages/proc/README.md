# @centient/proc

Hardened subprocess runner for Centient packages. Wraps `node:child_process`
`spawn` with the things every robust process call needs and nobody wants to
re-derive: wall-clock timeouts, SIGTERM-then-SIGKILL kill escalation, per-stream
output buffer caps, `AbortSignal` cancellation, stdin streaming, and a single
typed error that tells you exactly *how* a run failed.

Zero external runtime dependencies. ESM-only. Binary-agnostic — you pass the
executable; the runner knows nothing about any particular tool.

## Installation

```bash
npm install @centient/proc
```

Or as a workspace dependency in the monorepo:

```bash
pnpm add @centient/proc --workspace
```

## Why

`child_process.execFile` gives you a timeout and a `maxBuffer`, but it conflates
every failure into a loosely-typed error, kills only with `SIGKILL`, and offers
no `AbortSignal` story without extra plumbing. `@centient/proc` settles those
concerns once:

- **Settle-once semantics.** The returned promise resolves or rejects *exactly
  once*. Timeout, abort, buffer-overflow, spawn-failure, and the child's own
  `close`/`error` events all race through a single gate; the first terminal
  event wins and the rest are no-ops. This is a tested invariant, not a hope.
- **Kill escalation.** On timeout or abort the runner sends `SIGTERM`, waits a
  configurable grace window, then `SIGKILL`. It never relies on the child
  cooperating.
- **Buffer caps.** stdout and stderr each have an independent byte cap; exceeding
  it kills the process rather than letting memory grow unbounded.
- **Unified typed error.** Every failure is a single `ProcError` whose `kind`
  discriminates `spawn-failure` / `non-zero-exit` / `timeout` / `signal` /
  `buffer-overflow` / `aborted`. No message parsing.
- **Injectable clock and spawn.** Timeouts and kill escalation are driven by an
  injectable `Clock`, and `spawn` itself is injectable — so the hard paths are
  tested deterministically without real sleeps or real processes.

## Quick Start

```typescript
import { runProcess, ProcError, isProcError } from "@centient/proc";

try {
  const result = await runProcess("git", {
    args: ["rev-parse", "HEAD"],
    timeoutMs: 5_000,
  });
  console.log(result.stdout.toString().trim()); // the commit SHA
  console.log(result.exitCode); // 0
} catch (err) {
  if (isProcError(err)) {
    switch (err.kind) {
      case "spawn-failure":
        console.error("git not found on PATH");
        break;
      case "non-zero-exit":
        console.error(`git exited ${err.exitCode}:`, err.stderr);
        break;
      case "timeout":
        console.error(`git ran longer than ${err.timeoutMs}ms`);
        break;
      // signal | buffer-overflow | aborted ...
    }
  }
}
```

## Streaming stdin

```typescript
// Pipe data in; the runner writes it and closes the pipe.
const formatted = await runProcess("prettier", {
  args: ["--parser", "typescript"],
  input: sourceCode,
});
```

## Cancellation

```typescript
const ac = new AbortController();
const run = runProcess("long-running-tool", { signal: ac.signal });

// later — kills SIGTERM then SIGKILL after the grace window:
ac.abort();

await run; // rejects with a ProcError of kind "aborted"
```

If the signal is already aborted, `runProcess` rejects before spawning.

## Binary output

```typescript
const { stdout } = await runProcess("convert", {
  args: ["in.png", "out:-"],
  encoding: "buffer", // stdout/stderr come back as Buffers
});
```

## API

### `runProcess(command, options?): Promise<ProcResult>`

| Option           | Type                       | Default     | Description                                                        |
| ---------------- | -------------------------- | ----------- | ------------------------------------------------------------------ |
| `args`           | `readonly string[]`        | `[]`        | Argument vector. Passed verbatim — never shell-interpreted.        |
| `timeoutMs`      | `number`                   | _disabled_  | Wall-clock limit. On expiry: kill escalation + `timeout` error.    |
| `killGraceMs`    | `number`                   | `5000`      | Delay between `SIGTERM` and `SIGKILL` when the runner kills.       |
| `maxStdoutBytes` | `number`                   | `10485760`  | stdout byte cap; exceeding it kills with `buffer-overflow`.        |
| `maxStderrBytes` | `number`                   | `10485760`  | stderr byte cap; exceeding it kills with `buffer-overflow`.        |
| `input`          | `string \| Buffer`         | —           | Streamed to the child's stdin; the pipe is then closed.           |
| `encoding`       | `"utf8" \| "buffer"`       | `"utf8"`    | Output as decoded strings or raw Buffers.                          |
| `cwd`            | `string`                   | —           | Working directory for the child.                                   |
| `env`            | `NodeJS.ProcessEnv`        | _inherited_ | Environment for the child.                                         |
| `signal`         | `AbortSignal`              | —           | Cancels the run; kills the process and rejects with `aborted`.     |
| `spawnImpl`      | `SpawnImpl`                | `spawn`     | Inject a custom spawn (testing).                                   |
| `clock`          | `Clock`                    | global      | Inject a custom clock for timeout/kill timers (testing).          |

Resolves with `ProcResult` (`stdout`, `stderr`, `exitCode: 0`, `signal: null`)
on a clean run, or rejects with a `ProcError`.

### `ProcError`

A single error class. `kind` is the discriminant:

| `kind`            | Meaning                                                      |
| ----------------- | ----------------------------------------------------------- |
| `spawn-failure`   | Process could not be started (e.g. `ENOENT`, `EACCES`).     |
| `non-zero-exit`   | Started and exited with a non-zero code (`exitCode` set).   |
| `timeout`         | Exceeded `timeoutMs` and was killed (`timeoutMs` set).      |
| `signal`          | Terminated by an external signal (`signal` set).            |
| `buffer-overflow` | stdout/stderr exceeded its cap (`limitBytes` set).          |
| `aborted`         | The `AbortSignal` fired.                                    |

`ProcError` also carries `command`, `args`, and best-effort `stdout`/`stderr`
captured before the failure. Use `isProcError(value)` to narrow.

## Design notes

- **`node:child_process` only.** No external runtime dependencies, ever.
- **No ambient clock/randomness in core paths.** All timing flows through the
  injectable `Clock`, keeping the runner observable and deterministically
  testable (observable-architecture principle).
- **`command`/`args` are never shell-interpreted**, so callers are not exposed
  to shell injection through this package.

## License

MIT
