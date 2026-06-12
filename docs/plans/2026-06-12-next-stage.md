# Next-Stage Development Spec — centient-sdk

- **Date:** 2026-06-12
- **Repo:** `centient-labs/public-packages/centient-sdk` (TypeScript monorepo: `@centient/sdk` 2.0.0, `@centient/logger` 0.17.1, `@centient/secrets` 0.7.0, `@centient/events` 0.2.3, `@centient/wal` 0.3.3, plus `packages/sdk-python` engram-py 1.0.0)
- **Phase:** 7 of the hardening pipeline (`docs/hardening/STATE.md` — "next-stage plan, not started"). This document fills that slot and closes the phase.
- **Inputs:**
  - Audit trail: `docs/hardening/STATE.md`, `docs/hardening/BACKLOG.md` (T5 spec, T7, Deferred), `docs/hardening/2026-06-10-dimensions.md` (lines 47-60)
  - Package surface survey (2026-06-12, all five TS packages + sdk-python parity diff)
  - Open issues #8, #9, #11, #62, #65, #68, #80; merged #58, #63, #64, #67 (b171141), #70; release commits 2f06d98, cef5ad7, 895b88d
  - Workspace master plan: `/Users/owenjohnson/centient-labs/docs/plans/2026-06-10-hardening-master-plan.md`; seat roll-off per `2026-06-11-soma-wave3-scoping.md`
  - `.agent/DESIGN-PHILOSOPHY.md` (principles cited by number throughout)
- **Execution context:** This seat rolls off to soma Wave 3. Initiative 1 must land before roll-off; initiatives 2-7 are guard-encoded specs executable cold by a weaker model (Opus-class) with no judgment calls. All merges go through mbot's merge queue. Never push main. One changeset per behavioral change (`pnpm changeset`); never bump versions manually.

---

## Goals

1. Restore release-gate integrity: main is currently red (`make claudemd-check` fails) and sdk 2.0.0 / secrets 0.7.0 reached npm despite the T5 hard gate — fix forward, then make the bypass structurally impossible.
2. Convert every "documented tradeoff" and "deferred doc ticket" from the phase-6 audit into merged text or a closed ticket, so nothing evaporates between campaigns.
3. Bring `sdk-python` back to true parity with the 0.34.0 server contract, or make its CHANGELOG/README stop claiming parity — P11 (Honest Uncertainty) forbids the current state.
4. Finish #62 (runtime response-shape validation) category-wide per P10 (Categorical Symmetry) and P1 (Root Cause Over Bandaid).
5. Close the ADR/code gaps opened by post-audit merges (passphrase provider vs ADR-001) and give the ADR-002 1.0 roadmap a backlog presence.
6. Resolve the logger-injection asymmetry (sdk injectable vs events/wal hard-wired) — one observability pattern, per P4.

## Non-goals

- **Do not reintroduce GitHub Actions CI.** The CI-archival decision (cef5ad7) stands; the fix for the gate bypass is local and mechanical (Initiative 1), plus an ADR recording the decision (Initiative 5). Re-adding a CI publisher is the dormant T5 follow-up ("restore attestation when a CI publisher returns") and stays dormant.
- **Do not gold-plate dormant surfaces.** No WAL feature work (zero in-repo consumers), no events testing-utilities suite, no speculative secrets↔sdk credential bridge. These are listed in Deferred Again with reasons.
- **Do not execute the ADR-002 1.0 roadmap** (createSecretsClient, policy stack, OTel/OCSF sink, HMAC chaining, SecretsProvider rename, threat model). It is a major-version effort for a future seat; this spec only tickets it.
- **Do not collapse the sdk's dual surface** (flat client methods + resource classes). It is a 3.0-scale breaking change with no consumer demand on record; P5 (Least Surprise) says preserve the contract.
- **No new open-ended campaigns.** Everything here is bounded, file-named, and acceptance-gated.

---## Initiatives (ordered by consumer impact × effort)

### Initiative 1 — Release-gate integrity: fix-forward the red main, then close the bypass (P0)

**Motivation.** The 2.0.0/0.7.0 release proved the F5 residual live: "chore: version packages" (2f06d98) landed without updating the CLAUDE.md package table, so `make claudemd-check` fails on main right now (DRIFT sdk 1.7.1→2.0.0, secrets 0.6.0→0.7.0), `make check` therefore fails, and yet the packages published — the T5 fingerprint-stamp gate (Makefile:46-49) was either run pre-bump or bypassed via direct `changesets publish`. Every future release reproduces this break until the version step updates CLAUDE.md mechanically. P2 (No Silent Degradation) and P13 (Auditability) both apply: a gate that can be sidestepped silently is worse than no gate.

**Files.**
- `CLAUDE.md` (package table, lines 22-26)
- `Makefile` (targets `claudemd-check`, `check`, `publish`; lines 32-49)
- `package.json` (root — the `changeset version` script wiring)
- `docs/hardening/STATE.md`, `docs/hardening/BACKLOG.md` (T5 spec item 1)

**Steps.**
1. **[DONE 2026-06-12 — PR #82]** Fix-forward PR updating the CLAUDE.md table to actual `package.json` versions: sdk 2.0.0, logger 0.17.1, secrets 0.7.0, events 0.2.3, wal 0.3.3. In the same PR: refresh the sdk row's server-floor language for 2.0.0 (alignment is now engram-server 0.34.0 envelopes; `MIN_SERVER_VERSION` remains "0.31.0" per `packages/sdk/src/client.ts:204` — state both), and extend the secrets row's factory list with the key-provider surface (keychain / 1Password / passphrase per `packages/secrets/src/key-providers/`).
2. Mechanize: add a root script (e.g. `scripts/sync-claudemd-versions.mjs`) that rewrites the CLAUDE.md version column from each `packages/*/package.json`, and chain it into the version flow — root `package.json`: `"version": "changeset version && node scripts/sync-claudemd-versions.mjs"` (or equivalent Makefile target invoked by the release procedure in `.agent/procedures/commits.md`).
3. Close the bypass: make `make publish` the only documented publish path and have it (a) re-run `make check` immediately before `changeset publish` in the same invocation (not via a pre-stamped fingerprint that can go stale), and (b) refuse if `git status --porcelain` is non-empty or HEAD is not on `origin/main`. Document in `.agent/procedures/commits.md` that `pnpm changeset publish` directly is forbidden.
4. Reconstruct from `git reflog`/shell history how the 2.0.0 publish evaded the stamp; record the finding as a dated note in `docs/hardening/STATE.md` (phase-7 entry) and check BACKLOG.md T5 item 1 status accordingly.

**Acceptance criteria.**
- `make claudemd-check` and `make check` pass on main after merge.
- Running `pnpm changeset version` (or the documented release flow) on a branch with a dummy changeset leaves CLAUDE.md's table matching `package.json` versions with no manual edit.
- `make publish` invoked with a dirty tree, or after an intentionally-broken `make check`, exits non-zero before any npm interaction (test with `npm publish --dry-run` substituted or `DRY_RUN=1` guard).
- STATE.md has a phase-7 entry recording the bypass root cause; T7 and PR #67 are marked resolved (they are currently recorded as open — both are stale).

**Test plan.** `make check` locally (must be green). Add a small Makefile self-test or scripted check: create a throwaway branch, add a changeset bumping logger patch, run the version flow, assert `git diff --name-only` includes both `packages/logger/package.json` and `CLAUDE.md`. Negative test: corrupt the CLAUDE.md table, run `make publish` with a dry-run guard, assert non-zero exit.

---

### Initiative 2 — Batch-merge the five deferred doc tradeoffs + engines floor fix

**Motivation.** All five "documented tradeoff" items from `docs/hardening/2026-06-10-dimensions.md` (Deferred, lines 47-57) remain unwritten — verified by grep against current READMEs. These were accepted tradeoffs *conditional on being documented loudly*; undocumented, they are silent degradation (P2). One PR, text only (plus one `package.json` field), no behavior change. The cheapest high-leverage item in the backlog and exactly the kind that evaporates between campaigns.

**Files.**
- `packages/wal/README.md` — add a "Crash window" subsection under dead-lettering: confirm-before-append means a crash between handler success and `confirmEntry` re-executes on replay only up to the retry cap, after which the entry dead-letters; the window is the gap documented at `packages/wal/src/replay.ts:210-254`; no-double-execution was chosen over no-loss.
- `packages/sdk/README.md` — (a) "Server availability" note: thin client, no graceful degradation; when engram-server is down every call rejects, callers own retry/backoff beyond the built-in retry policy; (b) "Runtime requirements" note: per-request timeout and connection-establishment abort depend on Node 18+ `fetch` AbortSignal semantics — state the supported floor explicitly.
- `packages/events/README.md` — `onEvent()` contract note: callbacks must not block; a slow consumer triggers the configured backpressure policy; document which policy applies to callback fan-out.
- `packages/sdk/package.json` — `engines.node` says `>=18` while events/wal and the repo CLAUDE.md say `>=20`. Set `>=20.0.0` (this also resolves the "document the fetch floor" item at the strongest level: enforce it). This is a metadata-only change; ship as a patch changeset with a CHANGELOG note.

**Acceptance criteria.**
- `grep -i "crash window" packages/wal/README.md`, `grep -i "graceful degradation\|server is down\|unavailable" packages/sdk/README.md`, `grep -i "must not block" packages/events/README.md`, and `grep -i "node" packages/sdk/README.md` (floor statement) each hit.
- `node -e "console.log(require('./packages/sdk/package.json').engines.node)"` prints `>=20.0.0`.
- One changeset (patch, `@centient/sdk`) for the engines change; doc-only edits need none.
- The Deferred section of `2026-06-10-dimensions.md` gets a one-line annotation per item: "closed by PR #NN" (the fifth item, JSONL remainder buffer, is annotated "re-deferred, see next-stage spec" — see Deferred Again).

**Test plan.** `pnpm build && pnpm test` (no behavior change expected; engines bump must not break anything — Node here is already >=20). `make check` green.

---

### Initiative 3 — sdk-python 0.34.0 parity pass (or truthful de-scoping)

**Motivation.** sdk-python is the largest unexplored surface in the repo: zero tests in the 1257-test phase-6 gate, frozen since import (only commit 5c3c807 + one docs commit), and its CHANGELOG claims "Full API parity" while TS went 1.7.1→2.0.0 underneath it. Concrete gaps from the surface survey: no maintenance resource (no `vacuum()`), no sync resource at all (the entire 2.0.0 NDJSON/envelope realignment), no `expected_version`/`skip_embedding` on crystal params (`engram/types/knowledge_crystal.py:278-298`), no 409 version-conflict error class (`engram/errors.py` has 8 classes, none for CAS), no `MIN_SERVER_VERSION`/`check_server_compatibility()` (`engram/client.py:597-605`), and 8 missing resources (agents, ambient_context, facts, gc, maintenance, memory_spaces, sync+peers, users — client wires only 12, `engram/client.py:114-125`). P11 makes the false parity claim the most urgent line item; P10 frames the resource gap.

**Files.** `packages/sdk-python/engram/client.py`, `engram/resources/` (new: `maintenance.py`, `sync.py`, plus the six other missing resources), `engram/types/knowledge_crystal.py`, `engram/errors.py`, `engram/resources/_base.py` (bare non-enveloped peers/maintenance bodies), `packages/sdk-python/CHANGELOG.md`, `README.md`, `pyproject.toml`. Reference implementations: `packages/sdk/src/resources/maintenance.ts`, `packages/sdk/src/resources/sync.ts`, `packages/sdk/src/client.ts:204` (version floor), `packages/sdk/src/types.ts` (envelope shapes).

**Steps (phased so a weaker model can stop at any phase boundary).**
1. **Phase A — stop lying (ship first, smallest):** CHANGELOG/README parity disclaimer replaced with an explicit support matrix (resource × supported?) generated by hand from the TS barrel. `pyproject.toml` stays 1.0.x until Phase B/C land.
2. **Phase B — 0.34.0 core:** `expected_version` + `skip_embedding` on create/update crystal params (mirror TS semantics exactly, including server floor caveats); `CrystalVersionConflictError` mapped from HTTP 409; `MaintenanceResource` with `vacuum()`, `tombstone_cleanup()`, `changelog_compact()` handling *bare* (non-enveloped) response bodies; `MIN_SERVER_VERSION = "0.31.0"` constant + `check_server_compatibility()` mirroring `client.ts`.
3. **Phase C — sync + remaining resources:** `SyncResource` (push/pull NDJSON, peers, conflicts) against the `{success,data}` envelopes from #58/#53a6702; then agents, ambient_context, facts, gc, memory_spaces, users. Bump to 2.0.0-aligned version via the release procedure.
4. **Gate wiring:** add the python suite to `make check` (e.g. a `make python-test` target running `cd packages/sdk-python && python -m pytest`; if no test infra exists yet, Phase B must add pytest scaffolding with mocked-transport tests mirroring the TS resource tests). The phase-6 clean-repro count must stop being TS-only.

**Acceptance criteria.**
- Phase A: README/CHANGELOG contain no unqualified "full API parity" string (`grep -ri "full api parity" packages/sdk-python/` → only in historical CHANGELOG entries with a correction note).
- Phase B: pytest covers — 409 raises `CrystalVersionConflictError`; `skip_embedding=True` serializes to the wire field the server expects; `check_server_compatibility()` raises on a mocked `/health` below 0.31.0; `vacuum()` parses a bare body without envelope-unwrap errors.
- Phase C: every TS resource in `packages/sdk/src/index.ts`'s barrel has a Python counterpart or a line in the support matrix saying why not (Blobs stays Python-only; flat client methods are explicitly out of scope — Python is resource-only by design).
- `make check` runs the python tests and fails if they fail.

**Test plan.** Mock-transport unit tests per resource (mirror the TS pattern: assert request path/method/body and response parsing for both enveloped and bare shapes). Contract-parity spot test: a shared fixtures directory of recorded 0.34.0 response bodies consumed by both the TS vitest suite and pytest, asserting both SDKs parse identical JSON into equivalent structures. No live-server tests in the gate.

---

### Initiative 4 — Finish #62: runtime shape validation, category-wide via shared infrastructure

**Motivation.** Issue #62 asks for exhaustive runtime response-shape validation; merged #64 shape-guarded only the remaining sync read paths. P10 (Categorical Symmetry) is the strongest argument that this finishes across all 19/20 resource classes or not at all, and P1 demands the mechanism be shared infrastructure — one boundary validator in the request layer — not per-resource patches. P6 locates the boundary: validate at the HTTP edge, trust internal data after. The 2.0.0 envelope realignment makes this tractable: there are now exactly three response families (standard `{data, meta}` envelope, `{success,data}` sync envelope, bare peers/maintenance bodies).

**Files.** `packages/sdk/src/client.ts` (the request helpers — note #63 strips them from public .d.ts via stripInternal, so internal-only validation helpers stay hidden), `packages/sdk/src/resources/*.ts` (the guards added by #64 in sync are the pattern to extract and generalize), `packages/sdk/src/types.ts`. Zero runtime dependencies is a hard constraint — no zod; hand-rolled structural guards only, like #64's.

**Acceptance criteria.**
- A single internal module (e.g. `packages/sdk/src/validate.ts`, `@internal`) exports envelope-family guards; every resource read path routes through it — verified by `grep -rn "as unknown as\|as any" packages/sdk/src/resources/` returning no unguarded response casts.
- Malformed responses throw a typed, named error (extend the existing error hierarchy; do not throw bare `Error`) that includes the failing path and resource — P2: callers can distinguish "empty" from "failed/garbled".
- No public-surface change (P5): `pnpm build` and a `.d.ts` diff against 2.0.0 show no new exported symbols beyond the new error class. Patch or minor changeset accordingly.
- Issue #62 closed with a comment enumerating the resources covered; #65 closed as housekeeping in the same sweep (its PR #63 merged).

**Test plan.** Per envelope family, table-driven vitest cases feeding truncated/null/wrong-typed bodies through a mocked fetch and asserting the typed error. One per-resource smoke assertion that the happy path still parses (reuse existing resource test fixtures). `cd packages/sdk && npm test`; full `pnpm test`; `make check`.

---

### Initiative 5 — ADR ledger reconciliation: ADR-001 amendment, ADR-002 roadmap tickets, CI-archival ADR, STATE.md close-out

**Motivation.** Three documented decisions have drifted from reality. (1) ADR-001 was affirmed 2026-06-10, then #67 (b171141) merged `packages/secrets/src/key-providers/passphrase-provider.ts` — ADR-001 still defines `KeyProviderType = "keychain" | "1password"` and its provider table/resolution order/config schema omit passphrase; the phase-2 spot-check verdict is stale, and the 895b88d fixes (hidden-input 64 KiB cap, swallowed-signal) have never been audited. (2) ADR-002's own 1.0.0 roadmap is the biggest untracked work item in the repo (factory, policy stack, OTel/OCSF sink, HMAC chaining, provider rename, threat model, plus the ADR-001/ADR-002 KeyProvider↔SecretsProvider reconciliation committed to "in 1.0") — affirmed by the audit *because* deferral was the plan, but nothing tickets the plan. (3) The CI-archival decision (cef5ad7) and the local-CI-via-Makefiles standard have no ADR (dimensions doc lines 59-60) — now urgent given Initiative 1 showed the local gate was sidestepped. P3 (Transparent Evolution) and P13 govern all three.

**Files.** `docs/adr/001-key-provider-abstraction.md`, `docs/adr/002-secrets-long-term-architecture.md` (read-only; tickets reference its "1.0.0" section and Open Questions 1, 3, 4), new `docs/adr/0XX-ci-archival-and-local-gates.md` (next free number in `docs/adr/`), `docs/hardening/STATE.md`, `docs/hardening/BACKLOG.md`, GitHub issues.

**Steps.**
1. Amend ADR-001 (amendment section appended, not a rewrite): add `"passphrase"` to `KeyProviderType`, extend the provider table/resolution order/config schema, cite #67/895b88d, and note the 64 KiB hidden-input cap and signal handling as security-relevant properties pending re-audit. Cite P16: the amendment must state where the passphrase-derived key lives relative to the untrusted side.
2. Open one tracking issue per ADR-002 1.0 pillar (factory+policy stack; audit sink+HMAC chaining; SecretsProvider rename+KeyProvider reconciliation; threat-model doc), each labeled and cross-linked to ADR-002's section. Fold existing #9 (audit logging) into the audit-sink ticket and #8 (1Password backend) into the reconciliation ticket rather than leaving them orphaned; note #80 and #11 in the threat-model ticket as inputs (P15/P16). Also one small ticket for ADR-001's documented negative: vault key hex visible in `ps` via `op item create/edit` argv — fix is 1Password Connect/SDK.
3. Write the CI-archival ADR: decision (cef5ad7), the local-Makefile-gate standard, the Initiative-1 bypass incident as a Consequences entry, and the dormant "restore attestation when a CI publisher returns" condition (BACKLOG.md T5 item 1).
4. STATE.md phase-7 entry: record this spec as the phase-7 artifact, mark #67/T7 resolved, record the scoped re-run requirement for the passphrase provider (a future `/cl-adr-audit` invocation scoped to ADR-001 — do not run it in this seat).

**Acceptance criteria.** ADR-001 amendment merged; the `KeyProviderType` union in ADR-001 (currently `"keychain" | "1password"`, line 70) includes `"passphrase"` and the provider table/resolution order cover it (the pre-existing future-work aside at line 138 does not count). New ADR exists and is linked from the dimensions doc lines 59-60 annotations. 5+ issues exist, each naming its ADR section and design principles by number, each executable cold (file paths + acceptance criteria in the issue body). STATE.md phase 7 no longer says "not started".

**Test plan.** Documentation-only: `make check` green; `gh issue list` shows the new tickets; no changeset needed.

---

### Initiative 6 — Unify logger injection: events and wal adopt the sdk's structural-logger pattern

**Motivation.** Three packages, two contradictory observability patterns (P4): the sdk takes an injectable structural `ClientLogger` (`packages/sdk/src/logging.ts`, zero-dep by convention), while events and wal hard-wire `createComponentLogger` from `@centient/logger` (`packages/events/src/stream.ts:16`, `jsonl.ts:14`, `replay.ts:21`; `packages/wal/src/wal.ts:18`, `src/replay.ts:14`) with no injection point — a consumer cannot route events/wal-internal logging to their own logger instance, and events carries a hard runtime dependency it doesn't need. This is the lowest-effort seam fix in the survey and removes a real dependency edge.

**Files.** `packages/events/src/{stream.ts,jsonl.ts,replay.ts}`, `packages/events/src/index.ts` (new optional `logger` field on the factory option types), `packages/wal/src/{wal.ts,replay.ts}`, `packages/wal/src/index.ts`, both `package.json`s (move `@centient/logger` from dependencies to devDependencies if the default becomes a no-op logger, or keep it as the default impl — decide by the rule below), both READMEs.

**Design rule (no judgment required):** copy the sdk pattern exactly — define a minimal structural interface (`{ debug(msg, ctx?); warn(msg, ctx?); error(msg, ctx?) }`) in each package, accept it as an optional option on `createEventStream()` / `fromJsonl()` / `createJsonlSubscriber()` and on the wal entry points (`appendEntry` et al. take an options object today — extend it; `clearRetryCounts()` is untouched). Default behavior must be **identical to today** (P5): keep `@centient/logger` as the default via lazy import so existing consumers see zero change; new consumers may inject. Minor changeset for both packages.

**Acceptance criteria.**
- `grep -rn "createComponentLogger" packages/events/src packages/wal/src` shows only the single default-construction site per package, behind the injection point.
- A test in each package injects a capture logger and asserts internal warn-path messages arrive at it (use logger's own `CaptureTransport`/`createTestLogger` from `packages/logger/src/testing.ts` in devDependencies — eating our own testing utilities).
- Public API additions only; no signature breaks (`pnpm build`, d.ts review).
- READMEs document the injection option with one example each.

**Test plan.** `cd packages/events && npm test`, `cd packages/wal && npm test`, full `pnpm test`. New tests: injected-logger capture test per package; default-path regression test asserting no behavior change when no logger is passed.

---

### Initiative 7 — SDK event subscription: deprecate the broken path, add AsyncIterable delivery

**Motivation.** The sdk still exports the known-broken `events.subscribe()` (EventSource path that silently drops the API key — `packages/sdk/src/resources/events.ts:66-126`): a shipped silent-auth-failure, the canonical P2 violation. Meanwhile the TS SDK is behind its own Python sibling: sdk-python has `subscribe_iter` (`engram/resources/events.py:180,301`) and the TS SDK is callback-only via the hand-rolled SSE parser in `subscribeWithFetch` (`src/resources/events.ts:140-250`). `@centient/events` exists precisely to provide AsyncIterable + backpressure and is imported nowhere in `packages/sdk` (seam 2). Fix both with one bounded change; the full optional-peer-dep bridge to `@centient/events` (JSONL persistence/replay of server events) is deferred — see below.

**Files.** `packages/sdk/src/resources/events.ts`, `packages/sdk/src/index.ts` (export the new method's types), `packages/sdk/README.md`, CHANGELOG via changeset.

**Steps.**
1. Mark `subscribe()` `@deprecated` in JSDoc with the exact reason ("EventSource cannot send the API key header; use subscribeWithFetch or subscribeIter") **and** make it throw a typed error unless an explicit `{ allowInsecureEventSource: true }` opt-in is passed — silent credential dropping must not remain reachable by default (P2 over P5; the method is already documented broken, so the contract being "preserved" is a defect). Removal is reserved for 3.0.
2. Add `subscribeIter(...): AsyncIterable<EngramEvent>` implemented as a thin adapter over the existing `subscribeWithFetch` parser (push callback → pull iterator with an internal queue and a bounded high-water mark; on overflow, throw — do not drop silently). Zero new dependencies (the sdk's zero-runtime-deps constraint holds; do NOT import `@centient/events`).
3. README section showing both delivery modes, naming the Python `subscribe_iter` symmetry.

**Acceptance criteria.**
- Calling `subscribe()` without the opt-in flag throws the typed error; with the flag, behaves as before. Covered by tests.
- `for await (const ev of client.events.subscribeIter(...))` yields parsed events from a mocked SSE fetch stream; abort via `AbortSignal` terminates the iterator cleanly (no unhandled rejection).
- Overflow past the high-water mark surfaces as an explicit error on the iterator, tested.
- Minor changeset (`@centient/sdk`), since `subscribe()`'s default behavior change is a breaking-in-spirit fix of a documented defect — flag it prominently in the changeset body and let the release procedure decide minor-vs-major per `.agent/procedures/commits.md`; if the procedure is ambiguous, ship as major-flagged and let mbot review arbitrate. Do not silently ship it as a patch.

**Test plan.** Vitest with a mocked `fetch` returning a `ReadableStream` of SSE frames: multi-event parse, split-frame reassembly (reuse `subscribeWithFetch` fixtures), abort mid-stream, slow-consumer overflow, deprecated-path throw/opt-in. `cd packages/sdk && npm test`; `make check`.

---

## Deferred again (considered, consciously excluded)

- **JSONL follow-mode remainder buffer 1 MB → 100 KB** (`packages/events/src`): tuning with no reported consumer pain; annotate the dimensions doc as re-deferred rather than change a working default.
- **secrets adopting @centient/wal** (seam 3): the session vault's sidecar/file-lock machinery works and is tested; rewriting it onto wal is risk without a driving defect. The repo-level "WAL as primitive" claim gets softened in CLAUDE.md instead if anyone touches that file.
- **sdk ↔ @centient/secrets credential bridge** (seam 4, `apiKey` from `getCredential()`): nice-to-have glue with no issue demanding it; one README example is the right ceiling, and even that waits for a consumer request.
- **sdk AuditResource ↔ logger AuditWriter unification** (seam 1): two audit systems by design (server-side vs local); unifying belongs to the ADR-002 audit-sink ticket (Initiative 5), not standalone work.
- **Events testing utilities (CaptureTransport analog):** no consumer has asked; gold-plating a 0.2.x surface.
- **Performance benchmark baselines** (14 PERF_TESTS-gated skipped benchmarks): converting the perf verdict from assertion to evidence is real, but it needs a stable runner box and baseline-storage decision — recorded as a one-line ticket in the Initiative 5 sweep, not executed this seat.
- **Secrets README expansion to logger's standard** (108 lines for ~60 symbols): real deficit, but the ADR-002 1.0 work will churn that surface; documenting pre-1.0 surface that the roadmap renames is wasted motion. The threat-model ticket carries a docs line item.
- **sdk security pass beyond the non-enumerable API key** (client.ts:353), **events/JSONL replay as input-parsing surface**, **sdk-python key handling audit:** legitimate audit-depth gaps, but they are audit work, not development — they belong to the next `/cl-harden` audit cycle, noted in STATE.md phase 7.
- **release-toolkit summary.sh upstream bug:** verify-only task (does PR #70's "double-zero on clean output" fix cover the STATE.md `lib/summary.sh:211` integer-expression error?); belongs to the toolkit seat per `2026-06-11-release-toolkit-promotion-spec.md` — relay via coordinator, not this repo.
- **Reintroducing CI / npm provenance attestation:** explicitly conditional on a CI publisher returning (T5 item 1); the new ADR (Initiative 5) records the trigger condition.
- **Flat-client/resource-class dedup and sdk README full API reference:** 3.0-scale; no consumer demand on record; P5.