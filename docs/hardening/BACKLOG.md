# Hardening Backlog — centient-sdk

date: 2026-06-10 · source: docs/hardening/2026-06-10-dimensions.md ·
committed: 6 tickets (1 high, 5 med) · deferred: see dimensions doc ·
phase-5 status: all 6 implemented, PRs #71–#76 open (see STATE.md)

Tickets use the cl-adr-code-align contract and are written to be executable
without judgment calls. Ranked by impact × effort.

## T1 — gap-none-sse-run-error-handling (HIGH)

**Status (2026-06-11): implemented — PR #73 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-sse-run-error-handling",
  "adr": "none",
  "gap": "EventsResource.subscribeWithFetch launches `void run()` (packages/sdk/src/resources/events.ts:206) with no .catch(); a throwing onError handler makes the rejection vanish silently, and early-error paths never cancel the reader.",
  "spec": "1. Replace `void run()` with `void run().catch(...)` that marks the subscription closed and reports via a last-resort path that cannot throw (guard the onError call in a try/catch; if onError throws, swallow after recording — never let it escape). 2. Add a finally block in run() that calls `reader?.cancel().catch(() => {})` so all exit paths release the stream. 3. Tests: (a) onEvent throws -> onError receives it, subscription closed, no unhandled rejection (use process.on('unhandledRejection') trap in test); (b) onError throws -> no unhandled rejection, subscription closed; (c) fetch rejects pre-loop -> reader never allocated, no leak; (d) reader.read() rejects mid-loop -> reader cancelled.",
  "guards": "• No unhandled rejection in any test under --reporter=verbose • close() after failure is idempotent (no double-cancel throw) • Behavior of the happy path unchanged (existing SSE tests still pass) • Same pattern applied to any other void-launched async in packages/sdk (grep `void [a-z]` — fix all instances or note why each is safe)",
  "acceptance": "A refuter cannot construct an onEvent/onError/fetch/reader failure that loses the error silently or leaks the reader; vitest passes with an unhandledRejection trap active."
}
```

## T2 — gap-none-retry-jitter (MED)

**Status (2026-06-11): implemented — PR #71 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-retry-jitter",
  "adr": "none",
  "gap": "All 6+ retry sites in packages/sdk/src/client.ts (470, 489, 558, 595, 665, 748) sleep exactly retryDelay*attempt with zero jitter — synchronized consumers retry in lockstep against a struggling engram-server.",
  "spec": "1. Add one private method `backoffDelay(attempt: number): number` returning `retryDelay * attempt + Math.random() * retryDelay * 0.5` (full-jitter-lite; keep linear base — do NOT silently change the documented total retry budget). 2. Replace every inline `this.retryDelay * attempt` sleep argument with `this.backoffDelay(attempt)`. 3. Test: stub Math.random, assert delay bounds [base, base + 0.5*retryDelay] per attempt; assert all retry sites route through backoffDelay (no remaining inline multiplications — enforce via grep in test or eslint rule).",
  "guards": "• grep 'retryDelay \\*' returns only backoffDelay's own line • Existing retry-count tests unchanged (same number of attempts) • TimeoutError/EngramError non-retry semantics untouched • JSDoc on retryDelay updated to mention jitter",
  "acceptance": "Refuter cannot find a retry path that sleeps a deterministic duration; total worst-case retry time stays within documented bounds + 0.5*retryDelay per attempt."
}
```

## T3 — gap-none-request-nonjson-2xx (MED)

**Status (2026-06-11): implemented — PR #76 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-request-nonjson-2xx",
  "adr": "none",
  "gap": "client.ts request() (line 717) and _requestFormData() (line 642) parse response JSON before/regardless of checking response.ok; a non-JSON body (proxy error page) throws SyntaxError which is treated as retryable, burning all retries on a deterministic failure.",
  "spec": "1. In request(): wrap the response.json() call so a parse failure on a 2xx produces a non-retryable NetworkError with status + first 200 chars of body (mirror the existing _requestRawBody handling at client.ts:564-573). 2. In _requestFormData(): check response.ok before parsing; on non-2xx with unparseable body, fall back to status-only parseApiError instead of throwing SyntaxError. 3. Tests: 200+text/html -> NetworkError, exactly 1 fetch call (no retries); 502+html body via _requestFormData -> ApiError(502), no SyntaxError escape.",
  "guards": "• _requestRawBody behavior unchanged (its tests still pass) • Retry counting tests still pass for genuinely retryable errors (5xx JSON, network) • NetworkError message must not include auth headers (check error construction path)",
  "acceptance": "Refuter cannot produce a server/proxy response that makes the client retry a deterministic parse failure."
}
```

## T4 — gap-none-sdk-client-logging (MED)

**Status (2026-06-11): implemented — PR #75 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-sdk-client-logging",
  "adr": "none",
  "gap": "packages/sdk/src/client.ts performs zero logging — retries, timeouts, and network errors are invisible to consumers diagnosing hangs vs retry storms (wal/events/logger packages all instrument; the client is the blind spot).",
  "spec": "1. Add optional `logger` to ClientOptions (type: the @centient/logger component-logger interface; default: no-op — do NOT make @centient/logger a hard runtime dependency of the client path if it isn't already; check package.json and use a minimal structural type if needed). 2. Log at debug: each retry (attempt #, delay, error class, method+path); at warn: retries exhausted, TimeoutError. 3. Route every log argument through the existing sanitize helpers — never log headers, request bodies, or full URLs with query strings; method + pathname only. 4. Tests: injected fake logger captures retry/exhaustion events; assert no apiKey/header material appears in any logged string (regex scan of all captured args).",
  "guards": "• Zero logging when no logger injected (no console fallback) • No new hard dependency edges in packages/sdk/package.json without checking current dependency policy • Sanitization test covers X-API-Key, Authorization, query strings • README documents the option",
  "acceptance": "Refuter cannot trigger a retry/timeout that leaves no trace when a logger is configured, and cannot find secret material in any log line."
}
```

## T5 — gap-none-publish-provenance (MED)

**Status (2026-06-11): implemented — PR #74 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-publish-provenance",
  "adr": "none",
  "gap": "npm provenance attestation was lost when GH Actions was archived (cef5ad7): the old workflow set NPM_CONFIG_PROVENANCE=true; manual `make publish` does not, so public @centient/* packages ship unattested.",
  "spec": "1. Determine whether provenance attestation is possible for local (non-CI) publishes with the org's npm setup — npm provenance normally requires a supported CI OIDC provider; if local provenance is NOT supported, this ticket becomes: document the limitation in RELEASING.md and add `--provenance=false` explicitly so the choice is recorded, plus a deferred note to restore attestation when a CI publisher returns. 2. If a supported path exists (e.g. publish step moved to a minimal GH workflow_dispatch job while tests stay local), implement it: workflow publishes from a tag with NPM_CONFIG_PROVENANCE=true and id-token:write; make publish becomes tag+push. 3. Either way: make `make publish` fail (not warn) if `make check` was not run in the same invocation — wire publish target to depend on check explicitly and verify the dependency is non-bypassable in the happy path. 4. Update RELEASING.md to state exactly what gates a publish post-CI-archival.",
  "guards": "• Do not reintroduce full GitHub CI (the archival was a deliberate org decision — cef5ad7); only the publish/attestation step is in scope • RELEASING.md stays accurate for both outcomes • No npm tokens land in the repo • compatibility with changesets flow preserved",
  "acceptance": "Refuter can read RELEASING.md + Makefile and find no path where a package reaches npm without build+check having run; provenance is either restored or explicitly, documentedly declined."
}
```

## T6 — gap-none-docs-drift (MED)

**Status (2026-06-11): implemented — PR #72 open (refute-verified, make check green). Awaiting review/merge.**

```json
{
  "id": "gap-none-docs-drift",
  "adr": "none",
  "gap": "Three doc/contract drifts: CLAUDE.md version table stale (events 0.2.3, logger 0.17.1, wal 0.3.3); sdk-python CHANGELOG.md:29-30 claims entities/extraction 'not yet implemented, planned v1.1.0' though they shipped in 1.0.0; CLAUDE.md says '20 resources', actual exports 24+.",
  "spec": "1. Run `make claudemd-check` and fix every reported drift in CLAUDE.md (versions + resource count — count actual exports rather than hand-counting). 2. Fix sdk-python/CHANGELOG.md 1.0.0 entry: remove the not-yet-implemented note, list entities/extraction as shipped. 3. If claudemd-check does not catch the version table, extend the check script so this class of drift fails make check in future.",
  "guards": "• make check green after • claudemd-check actually exercises the fixed fields (verify by temporarily breaking one and seeing it fail) • No CHANGELOG rewriting beyond the factually wrong 1.0.0 entry",
  "acceptance": "Refuter diffing docs against package.json versions and actual exports finds zero remaining drift, and breaking the version table makes make check fail."
}
```

## Operator-decision ticket (not executable by an agent)

- **T7 — pending changesets vs compiled code**: 0.34.0-alignment +
  shape-guard + stripInternal changesets sit unreleased while the breaking
  code is on main. Decide: release now (recommended — code is live for
  anyone building from main) or revert to the 0.31.0 floor. One
  `make publish` either way.

## Deferred

See "Deferred" in 2026-06-10-dimensions.md — five documented-tradeoff
items (doc tickets), one upstream release-toolkit bug, one standards-repo
gap (CI-archival decision has no ADR).
