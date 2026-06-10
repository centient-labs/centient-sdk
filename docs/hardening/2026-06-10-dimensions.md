# Dimension Audit — centient-sdk (2026-06-10)

Eight dimensions, four parallel auditors, every finding adversarially
refutation-tested before inclusion. Verdicts below are post-refutation and
post-triage (cross-auditor disagreements adjudicated; adjudications noted).

## ADR soundness (phase 1)

| ADR | Verdict | Rationale |
|-----|---------|-----------|
| 001 key-provider-abstraction | **affirm** | Interface fully implemented, non-breaking, auto-detection correct. |
| 002 secrets-long-term-architecture | **affirm** | Pillar 1 (policy seam) shipped; pillars 2–3 deferred per the ADR's own plan; no violations. |

ADR-vs-code (phase 2) was run at spot-check depth — two ADRs, both verified
in code by the soundness auditor; a full cl-adr-audit pass was judged
disproportionate for this repo.

## Clean dimensions (0 findings, post-refutation)

- **security** — AES-256-GCM correct; key zeroization on close/error paths;
  AAD binds ciphertext to realpath+schema (anti-substitution); symlink-aware;
  rollback protection; `execFileSync` arg-arrays everywhere; no eval; error
  messages sanitized (`sanitize.ts:187-261`); API key non-enumerable
  (`client.ts:353`); dbus-next 0.10.2 no known CVE.
- **performance** — per-write WAL fsync is the documented durability
  contract; JSONL flush batching bounded; no hot-path issues.
- **test-quality** — 14 skipped tests are PERF_TESTS-gated benchmarks
  (intentional); tests assert behavior, not implementation; failure-path
  coverage solid (corruption, permissions, backpressure, dead-letter).
- **correctness of @centient/wal core** — O_APPEND+fsync, mutexed
  confirm/compact, atomic tmp→rename, scope-ID path-traversal guard all
  verified clean.

## Findings

| # | Dim | Sev | Claim | Evidence |
|---|-----|-----|-------|----------|
| F1 | reliability | **high** | SSE `subscribeWithFetch` launches `void run()` with no `.catch()`; if `onError` itself throws, the rejection vanishes and the caller never learns the subscription died. Early-error paths also skip `reader.cancel()` cleanup. | `packages/sdk/src/resources/events.ts:160-206` |
| F2 | correctness | **med** | Retry backoff is linear with zero jitter at every retry site — synchronized clients reconverge (thundering herd). *Adjudicated: auditor C said HIGH (timing-attack framing — rejected), auditor D said no-issue; MED stands on the herd argument.* | `packages/sdk/src/client.ts:470,489,558,595,665,748` |
| F3 | correctness | **med** | `request()` parses JSON before checking status; a non-JSON 2xx (proxy error page) throws SyntaxError and **burns retries on a deterministic failure**. `_requestRawBody` already does this right; `_requestFormData` has the same ordering bug. | `client.ts:680-756` (esp. 717), `client.ts:612-674` |
| F4 | observability | **med** | The SDK client does no logging at all — retries, timeouts, network errors are silent. Consumers cannot distinguish retry storms from hangs. (wal/events/logger packages instrument well.) | `packages/sdk/src/client.ts` — zero logger usage |
| F5 | supply-chain | **med** | No automated gate on releases since GH Actions was archived (cef5ad7, 2026-03-30): `make publish` runs build+check but is advisory/bypassable; 10+ releases shipped since with no CI verification. Mitigations in place: npm 2FA, `npm whoami` preflight. | Makefile:37-38, RELEASING.md, git log |
| F6 | supply-chain | **med** | npm provenance attestation lost in the CI migration — archived workflow set `NPM_CONFIG_PROVENANCE=true`; manual publishes don't. Public packages now ship without provenance. | `docs/archive/2026-03-29-github-actions-release.yml:41` vs current `.npmrc`/Makefile |
| F7 | contracts-docs | **med** | Compiled code is ahead of published versions: 0.34.0-alignment + shape-guard changesets are pending in `.changeset/` while the breaking code is already on main. Operator decision: release soon or hold. | `.changeset/`, RELEASING.md:36-39 |
| F8 | contracts-docs | **med** | Doc drift: CLAUDE.md package-version table stale (events 0.2.1→0.2.3, logger 0.17.0→0.17.1, wal 0.3.1→0.3.3); sdk-python CHANGELOG claims entities/extraction "not yet implemented" but they shipped in 1.0.0; resource count says 20, actual 24+. | CLAUDE.md, packages/sdk-python/CHANGELOG.md:29-30 |

## Deferred (low / documented tradeoffs — recorded, not ticketed)

- WAL dead-letter confirm-before-append crash window — intentional
  (no-double-execution wins); document loudly in wal README (`replay.ts:210-254`).
- No graceful degradation when engram-server is down — by design (thin
  client); document the expectation in README.
- JSONL follow-mode remainder buffering — bounded at 1 MB; consider 100 KB.
- `onEvent()` blocking contract — document that callbacks must not block.
- Per-request timeout vs connection-establishment coverage — Node 18+ fetch
  signal covers it; document the floor version.
- Upstream: `release-toolkit/lib/summary.sh:211` integer-expression error
  (ticket belongs to release-toolkit repo).
- Org-level: the CI-archival decision (cef5ad7) has no ADR; the
  local-CI-via-Makefiles standard should be written down in `standards`.
