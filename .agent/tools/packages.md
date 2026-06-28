<!-- cl-sync src=095a9b8e -->
# Tool: shared packages (`@centient/*` public + `@centient-labs/*` private)

The org ships reusable libraries so common infrastructure is solved **once**.
**Before hand-rolling logging, retries, subprocess handling, path sanitization,
config loading, DAG scheduling, secrets, etc. — check whether a published package
already does it, and depend on that.** Reimplementing what a package provides is a
DRY/single-source violation (see DESIGN-PHILOSOPHY) and skips the package's
hardening, tests, and security review. Tool-neutral: applies to any agent.

This is an orientation registry; for the live API of any package read its README /
types. Public packages are on the npm `@centient/*` scope; private ones are on the
`@centient-labs/*` scope (GitHub Packages, private tap).

## Public `@centient/*` (centient-sdk)

| Package | Use it instead of hand-rolling… |
|---|---|
| `@centient/logger` | a logger; also home-dir / username **redaction** in log output. |
| `@centient/resilience` | retry/backoff-with-jitter, circuit breaker, token-bucket rate limiter, LRU/TTL/SWR cache, bounded-concurrency pool. |
| `@centient/proc` | raw `execFile`/`spawn` — a hardened subprocess runner with timeouts, SIGTERM→SIGKILL escalation, buffer caps, and unified typed errors. |
| `@centient/path-security` | path-traversal validation + path-component sanitization (Result-typed). |
| `@centient/config-loader` | layered config resolution (env > project > user > defaults) with caching, write-back, and project-root discovery. |
| `@centient/secrets` | a secret store — cross-platform AES-256-GCM vault with platform-native key storage. |
| `@centient/wal` | a write-ahead log / crash-recovery store, and `atomicWrite` / `atomicAppendLine`. |
| `@centient/dag` | DAG scheduling — adjacency, cycle detection, topological sort, parallel waves, failure-cascade propagation. |
| `@centient/events` | an ad-hoc event bus — typed event streaming with backpressure. |
| `@centient/cli-utils` | terminal capability detection, ANSI color helpers, and semver-lite (parse/compare/satisfies). |
| `@centient/sdk` | a hand-rolled engram/Centient client — the TypeScript SDK for agent memory + context engineering. |
| `@centient/sdk-python` | the same, for Python consumers. |

## Private `@centient-labs/*`

| Package | Purpose |
|---|---|
| `@centient-labs/daemon` | The Centient daemon client/runtime (WebSocket delivery, PATH lookup, spawn). |

> **Planned, not yet published** (workspace#85): `git-ops` (injection-safe git/GitHub
> automation), `llm-cost` (pricing tables + usage→cost), `credential-pool`
> (vault-backed rotating provider credentials + the `sk-ant-oat01` vs `sk-ant-api03`
> mapper), `crystal-kit` (schema-validated crystal I/O + distributed lease lock).
> Add each here as it lands.

## Adopting a package

- Add it to the consumer's `package.json` (public from npm; private from the
  GitHub Packages registry — the repo's `.npmrc` already wires `${GITHUB_TOKEN}`).
- Prefer replacing a hand-rolled equivalent over adding a parallel one.

Repo-specific additions: see `packages-local.md` (loaded alongside this file).
