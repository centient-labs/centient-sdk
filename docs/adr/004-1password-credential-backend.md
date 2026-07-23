# ADR-004: 1Password Credential Backend (`OnePasswordVault`)

**Status:** Accepted
**Date:** 2026-06-24
**Accepted:** 2026-07-22
**Deciders:** Owen Johnson
**Principles:** P2 (No Silent Degradation), P3 (Transparent Evolution), P6 (Single Source of Truth), P9 (Composability Over Completeness), P15 (Secure by Default), P16 (Authority Outside the Sandbox)
**Supersedes:** none
**Related:** ADR-001 (Key Provider Abstraction — the *existing* 1Password support, at a different layer), ADR-002 (Long-Term Architecture — this backend becomes a `SecretsProvider` in 1.0); issue #102 (`op` argv visibility)

## Context

`@centient/secrets` has **two independent credential layers**, and 1Password is
supported at only one of them today.

1. **KeyProvider layer (ADR-001).** Retrieves the 32-byte AES-256-GCM key that
   decrypts the local `vault.enc` session vault. `OnePasswordProvider`
   (`key-providers/onepassword-provider.ts`) already implements this — it shells
   out to `op read`/`op item create`/`op item edit` to store the *vault key*.
   Here 1Password holds **the key, not the secrets**.

2. **VaultBackend cascade (this ADR).** The `storeCredential` / `getCredential`
   / `deleteCredential` / `listCredentials` API (`vault/vault.ts`) stores the
   actual *credential values* (auth tokens, API keys) directly in an OS keystore.
   The cascade is **Keychain → Windows → Libsecret → GPG → Env**, first
   `detect()` wins, selected once at module load (`initVaultBackend()`,
   `vault/vault.ts:77-86`). **There is no 1Password backend here, and no
   configuration input into the cascade at all.**

This ADR adds a `OnePasswordVault implements VaultBackend` so the credential
values themselves can live in 1Password.

### Motivating use cases

1. **Team-shared credentials** — an operator stores `soma.anthropic.token1` once
   in a shared 1Password vault; every teammate's host reads it without a
   per-machine keychain copy.
2. **Headless / CI** — a Linux runner with no desktop keychain authenticates via
   `OP_SERVICE_ACCOUNT_TOKEN` and reads credentials directly, no `vault.enc` file
   to sync.
3. **Cross-machine sync** — 1Password is the source of truth; rotating a token in
   1Password propagates to every consumer on next read.

### Constraints discovered (from codebase + `op` CLI research)

- **`VaultBackend` is a public, implementable interface** (`index.ts:7`), so a
  new backend is additive, not a breaking change.
- **`isValidKey`** (`vault/vault-utils.ts:15`) constrains keys to
  `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/`, ≤64 chars — no uppercase, underscores,
  whitespace, or shell metacharacters. Keys are therefore safe to interpolate
  into `op` argv positions (item title, `--vault`); **secret values are not.**
- **Secure-write requirement (P15, issue #102).** 1Password explicitly warns
  that command arguments are visible in process listings and shell history;
  sensitive values must be passed via a **JSON template piped over stdin**
  (`op item template get … | op item create --vault … -`), never as
  `field=value` argv. The *existing* `OnePasswordProvider` (ADR-001) passes the
  key as argv (`password=${keyHex}`, `onepassword-provider.ts:148,165`) — this
  backend must **not** repeat that pattern, and the fix is portable back to the
  key provider (tracked separately, see "Consequences").
- **`op item list --vault X --format=json`** returns item metadata (titles, ids)
  **without** secret values — secure enumeration, strictly better than the
  libsecret `secret-tool search` fallback that materializes values on stdout.
- **Service accounts cannot access the Private vault** — a named vault must be
  configured; we must fail closed with an actionable error when it is not.
- **Each backend enforces `isValidKey` itself** and namespaces its items
  (`AUTH_KEYCHAIN_SERVICE="centient-auth"`, libsecret `SERVICE_ATTR="centient"`).
  The 1Password backend needs an equivalent scope so `listKeys` returns only
  centient-owned items.

## Decision

Add `OnePasswordVault` as a `VaultBackend`, selectable **only by explicit
opt-in**, writing secret values exclusively over stdin.

### 1. Explicit opt-in — never auto-cascade

`op` being installed must **not** silently capture credentials: a developer with
1Password on their laptop should not have engram tokens routed into their
personal vault as a side effect. This is a P15/P2 decision — surprising secret
placement is a security defect, and silent backend substitution is silent
degradation.

We therefore introduce the cascade's **first configuration seam**.
`initVaultBackend()` consults opt-in configuration (reusing the existing
`loadConfig()` reader from `key-providers/resolve.ts`, the single source of truth
for `~/.centient/config.json` → P6) before falling back to auto-detection:

```jsonc
// ~/.centient/config.json
{
  "secrets": {
    "backend": "1password",                // explicit selection; omit = auto-cascade
    "onePasswordBackend": {                // SEPARATE from "onePassword" (see below)
      "vault": "centient-credentials",     // REQUIRED — no default; absence = fail closed
      "tag": "centient"                    // optional; defaults to "centient"
    }
  }
}
```

**Why a separate `onePasswordBackend` block (resolves open question #1).** ADR-001
already defines `secrets.onePassword` (`key-providers/types.ts:80-93`) meaning
*"the 1Password vault + item holding the vault-encryption **key**."* That is a
different purpose from *"the vault holding the **credential values**."* An operator
may legitimately keep the key in `Private` but credentials in a shared
`centient-credentials` vault — or use 1Password for credentials while the key
lives in the Keychain. Overloading one `onePassword.vault` field would conflate
the two independent layers, so the credential backend gets its own block. The two
read cleanly side by side:

```jsonc
"secrets": {
  "provider": "keychain",                  // KEY layer (ADR-001): key stays in Keychain
  "backend": "1password",                  // CREDENTIAL layer (ADR-004): values in 1Password
  "onePasswordBackend": { "vault": "centient-credentials" }
}
```

**Vault name is required, with no default (resolves open question #2).** Unlike
ADR-001's key block (which defaults `vault` to `"Private"`), the credential
backend has **no default vault**: an unset `onePasswordBackend.vault` under an
explicit `backend: "1password"` is a configuration error that **fails closed**
with an actionable message. Defaulting would risk writing credentials to an
unexpected (possibly personal) vault — the P15/P2 surprise this whole opt-in
model exists to prevent.

Environment override (highest precedence, mirrors ADR-001's env > config order):
`CENTIENT_SECRETS_BACKEND=1password` + `CENTIENT_OP_VAULT=<name>` (the env vault
is likewise required when the env backend selects 1Password).

Selection logic:

```
1. Explicit backend ("secrets.backend" or CENTIENT_SECRETS_BACKEND):
   construct that backend. If it is "1password" and EITHER the vault is
   unconfigured OR detect() fails, FAIL CLOSED with an actionable error
   (do NOT silently fall through to the auto-cascade — that would defeat
   the explicit choice, P2).
2. No explicit backend: the existing auto-cascade, unchanged.
   1Password is NEVER auto-selected.
```

### 2. `detect()` semantics

`OnePasswordVault.detect()` returns true only when **both**: the backend is
explicitly opted in, **and** `op` is available and authenticated. The `op`
availability + auth probe is the same logic as `OnePasswordProvider.detect()`
(binary in PATH; `OP_SERVICE_ACCOUNT_TOKEN` set, or `op account list` non-empty)
— extracted into a shared helper (see §6) rather than duplicated (P6). Because
selection is opt-in, `detect()` never competes in the auto-cascade.

### 3. Namespacing

- **Vault** — a dedicated 1Password vault named by `onePasswordBackend.vault`
  (or `CENTIENT_OP_VAULT`). **Required, no default** (§1); we never write to the
  Private vault (service-account-incompatible) and never guess a vault name.
- **Item title** — the credential key verbatim (`isValidKey`-constrained, argv-safe).
- **Tag** — every item tagged `centient` (configurable). `listKeys` filters by
  `--tags centient` so unrelated items in a shared vault are excluded.
- **Field** — the secret value lives in the standard `password` field
  (`op://<vault>/<key>/password`).

### 4. Secure write — stdin JSON only (the core security decision)

`store(key, value)` builds the item JSON **in-process** and pipes it to
`op item create -`; the value never appears in argv. Update is modeled as
replace (delete-then-create) so both create and update go through the same
no-argv path:

```
// pseudocode — value travels via stdin `input`, never argv
const item = { title: key, category: "PASSWORD", vault: { name: vault },
               tags: [tag], fields: [{ id: "password", type: "CONCEALED", value }] };
execFileSync("op", ["item", "create", "--format=json", "-"],
             { input: JSON.stringify(item), stdio: ["pipe","pipe","pipe"], timeout });
```

This both implements the backend and demonstrates the argv-safe pattern that
issue #102 wants retrofitted to the key provider.

### 5. Read / list / delete

| Op | Command | Notes |
|----|---------|-------|
| `retrieve(key)` | `op read "op://<vault>/<key>/password"` | value on stdout; `null` on not-found |
| `listKeys(prefix?)` | `op item list --vault <vault> --tags <tag> --format=json` | parse titles; **no secret values in output**; filter by prefix in-process |
| `delete(key)` | `op item delete <key> --vault <vault>` | key is argv-safe; idempotent (missing item ⇒ success, matching other backends) |

### 6. Shared `op` helper (refactor, P6)

Extract the `op`-availability/auth probe and a thin `runOp(args, {input?})` wrapper
into `key-providers/op-cli.ts` (or `vault/op-common.ts`), consumed by both
`OnePasswordProvider` (key) and `OnePasswordVault` (credential). Single source of
truth for `op` invocation, timeouts, and auth detection.

### 7. Error handling — VaultBackend contract + no silent degradation

Honor the contract (`vault/types.ts:92`): `store`/`retrieve`/`delete` return
`false`/`null` on failure; `listKeys` returns `[]` on empty but **throws** on
transient failure so callers can retry. Apply the libsecret lesson (#121): an
**unexpected** `op` failure (authenticated but the call errored — not a simple
not-found) emits a one-time stderr warning so a misconfiguration is observable,
never silent (P2). An auth/availability failure under an *explicit* opt-in fails
closed at selection time (§1), not per-operation.

### 8. Caching — list-cache only, never cache values (resolves open question #3)

Every 1Password read is an `op` subprocess + network round-trip (or desktop-app
IPC) — ~100ms–1s versus microseconds for a local keystore — and the common
"`listCredentials` then `getCredential` per key" pattern multiplies it. Three
options were weighed:

| Option | Latency win | Risk |
|--------|-------------|------|
| A. Stateless (no cache) | none | none; slow hot paths |
| B. **List-cache only** (mirror keychain) | helps enumerate-then-read | low — caches key *names*, not values |
| C. Read-through value cache (TTL) | large | security + staleness (below) |

**Decision: Option B.** Cache `listKeys` results with a short TTL, invalidated on
`store`/`delete` — exactly the existing keychain pattern
(`KEYCHAIN_LIST_CACHE_TTL_MS = 5000`, ADR-002 item 2). It caches only metadata
(key names), never secret values.

**Option C is rejected** on two grounds: (1) **security** — caching decrypted
values would hold them in the Node heap for the whole TTL instead of only the
read window, weakening the "value resident only briefly" property ADR-001's P16
analysis relies on; (2) **staleness** — 1Password is the source of truth, so a
cached value would serve a *rotated/revoked* token until expiry, a correctness
and security problem for credentials specifically. Callers that genuinely need
hot-path value caching wrap `getCredential` themselves and own that tradeoff
explicitly.

### 9. Type + observability wiring

- Add `"1password"` to the `VaultType` union (`vault/types.ts:73`);
  `getActiveVaultType()` returns it; the `secrets list-backend-keys --json` CLI
  surfaces it with no further change.
- **Policy/audit comes free.** The cascade wraps every backend call in
  `runBeforeHooks`/`runAfterHooks` (`vault/vault.ts`), so 1Password operations
  are audited (incl. the `*_rejected` events from #120) with zero backend-side
  work.

## Security considerations (threat model)

- **argv (process list / shell history):** secret values **never** placed in
  argv — stdin only (§4). Keys/vault names are `isValidKey`/config-constrained.
  This is the headline improvement over the ADR-001 key provider.
- **stdout:** `op read` returns the value on the child's stdout, captured into a
  Node string for the read window — identical residence to every other backend
  (keychain/libsecret return values the same way) and to the P16 analysis in
  ADR-001. Not a sandbox-safe store; operator/host trust domain only.
- **Service-account token:** `OP_SERVICE_ACCOUNT_TOKEN` lives in the process env
  — same trust assumptions as any env-borne credential; document that it grants
  vault access and should be scoped to the `centient` vault only.
- **Network dependency:** unlike local keystores, 1Password reads hit the network
  (or local desktop app). Implies real timeouts (reuse `op`'s 30s pattern) and
  latency on every `getCredential` — callers doing hot-path reads should cache.
- **Shared-vault blast radius:** anyone with the `centient` vault sees all
  centient credentials. This is the intended team-sharing model, called out so
  it is a choice, not a surprise.

## Consequences

### Positive
- Closes the 1Password gap at the credential-value layer; enables team-shared and
  headless credential access (the motivating use cases).
- **Argv-safe write pattern** established and reusable — fixes issue #102's class
  of leak and is portable back to `OnePasswordProvider`.
- Secure enumeration (metadata-only `op item list`) — no value materialization,
  unlike the libsecret fallback.
- First config seam in the cascade, paving the way for ADR-002's
  `createSecretsClient({ provider })` selection.
- Zero new runtime deps — `execFileSync` only (consistent with ADR-001's
  no-`@1password/sdk` decision).

### Negative
- Introduces configuration into a previously zero-config cascade — added surface
  and a new failure mode (opt-in set but vault unreachable ⇒ fail closed).
- Network/latency on every read; a new external-tool dependency (`op`) for a
  core path.
- Like the existing `op` provider, the live round-trip is **not exercisable in
  CI** (no `op` binary) — mitigated by the opt-in integration test (below) rather
  than left code-present-only (the ADR-001 audit gap we are explicitly avoiding
  repeating).

### Neutral / follow-ups
- ADR-002's backend list omits 1Password; this ADR adds it to the trajectory.
  When the `SecretsProvider` SPI lands (1.0), `OnePasswordVault` becomes a
  `SecretsProvider` like the other backends.
- Retrofitting the argv-safe write to `OnePasswordProvider` (key layer) is a
  separate change tracked under issue #102.

## Alternatives considered

1. **Auto-insert 1Password into the cascade when `op` is present.** Rejected —
   silent, surprising secret placement into a personal vault (P15/P2 violation).
2. **Use `@1password/sdk` (native) instead of the `op` CLI.** Rejected for now —
   adds a runtime dependency, breaking the package's zero-external-dep rule;
   `op` CLI parity with ADR-001 keeps one auth model.
3. **Extend `OnePasswordProvider` to also store credential values.** Rejected —
   conflates two distinct interfaces (`KeyProvider` returns a `Buffer` key;
   `VaultBackend` stores string values keyed by name). Separate classes, shared
   `op` helper (§6).
4. **`op item edit 'field=value'` for updates.** Rejected — argv leak. Update =
   delete-then-create over stdin (§4). (If a confirmed `op item edit -` stdin
   path exists in the supported `op` version, adopt it as an optimization later.)

## Testing strategy

Mock `child_process.execFileSync` via the `vi.hoisted` + `vi.mock` pattern used
by `vault-windows.test.ts` / `vault-libsecret.test.ts`. Required cases:

- **store(): the value is passed via `input` (stdin) and is NOT present in the
  args array** — the load-bearing security assertion (grep the recorded argv for
  the secret, assert absent).
- read parses stdout; not-found ⇒ `null`.
- listKeys parses `op item list --format=json`, filters by prefix, returns `[]`
  on empty, throws on transient error; asserts no secret value appears in the
  list command output handling.
- delete idempotency; key argv-safety.
- detect()/selection: opt-in gating — `op` present but not opted in ⇒ not
  selected; opted in but `op` missing ⇒ fail closed.
- **Opt-in integration test** gated on `op` availability + a
  `CENTIENT_OP_TEST_VAULT` env var, doing a real create→read→list→delete
  round-trip — so this backend is not perpetually code-present-only (directly
  addressing the ADR-001 audit finding).

## Resolved design questions

1. **Config layering vs. ADR-001 — RESOLVED.** The credential backend uses its
   own `secrets.onePasswordBackend` block, kept separate from ADR-001's
   `secrets.onePassword` (the vault-key item). The two layers are independent and
   read cleanly together (Decision §1).
2. **Default vault name — RESOLVED.** No default. `onePasswordBackend.vault` (or
   `CENTIENT_OP_VAULT`) is required under an explicit `backend: "1password"`;
   absence fails closed (Decision §1).
3. **Caching — RESOLVED.** List-cache only (mirroring the keychain pattern);
   never cache secret values (Decision §8).

## Open questions

- **`op item edit -` stdin support.** Update is modeled as delete-then-create
  over stdin (Alternative 4). If the supported `op` version exposes a confirmed
  stdin edit path, adopt it as an in-place optimization. Verify against the
  pinned `op` version during implementation.
