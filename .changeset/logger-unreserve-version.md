---
"@centient/logger": major
---

**BREAKING:** Unreserve the `version` field name. Removes the `version` option on `LoggerOptions` and the `version` slot on `LogEntry`. User-supplied `version` in log context now flows through to the emitted entry instead of being silently stripped. Closes #36.

### What changed

Previously, `@centient/logger` reserved `version` as a logger-instance meta-field. Two problems:

1. **`Logger.ts::buildEntry`** destructured `version` out of user context and replaced it with `this.version` (defaulting to `"0.0.0"` when no option was supplied).
2. **`format.ts::formatPretty`** stripped `version` from pretty-mode output before rendering the tail.

Net effect: `logger.info({ version: "1.2.3" }, "...")` silently dropped the user's value and emitted nothing (pretty) or `"0.0.0"` (JSON). Observed on `@centient-labs/daemon@0.6.0` during the maintainer v0.8.1 incident (log lines with no attributable version).

### The fix

- Remove `LoggerOptions.version?: string`
- Remove `LogEntry.version: string`
- Remove the `version: _v` destructure in `Logger.ts::buildEntry`
- Remove the `version: _v` destructure in `format.ts::formatPretty`
- Remove `this.version` internal storage
- `createTestLogger` no longer injects a `version: "0.0.0-test"` default

Only `service`, `component`, and `tool` remain reserved. Everything else (including `version`) is yours.

### Why major

Zero callers in the centient-labs ecosystem passed the `version` option — verified via cross-org grep across `centient-sdk`, `daemon`, `crucible`, `centient`, `soma`, `test-kit`. Per the review discussion on #36, "zero callers" resolves to clean removal and a major bump rather than a deprecation shim.

The log-output shape also changes: JSON entries no longer carry a top-level `version` field, and pretty-mode output no longer contains the useless `version=0.0.0` tail (it was being stripped, but any downstream parser that expected the JSON field is affected).

### Migration

- If you were passing `{ version: "..." }` to `createLogger` / `createComponentLogger` / etc.: remove it. The value wasn't useful in logs anyway. If you want per-line service version, pass it in context: `logger.info({ appVersion: "1.2.3", ... }, "...")`.
- If you were relying on `entry.version` being populated in a log consumer: the field is gone. Use `service` (unchanged) to identify the emitter, or have the emitter put its version into context explicitly.
- If your code reads `entry.version` on a captured log entry: the field is now `undefined` unless the caller put it in context.

### Convention

`@centient-labs/daemon` uses `appVersion` for the consuming app's semver. The centient-sdk README suggests following that convention unless your domain has a better-fitting name. See `packages/logger/README.md` §"Reserved top-level fields".

### Scope

This PR addresses the bug in `@centient/logger` only. `@centient/logger::AuditWriter` has a similar internal `this.version` on audit events — that's a separate schema-versioning concern for audit payloads, not a user-context field, so it's intentionally not touched here.
