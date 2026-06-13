# ADR-001: Key Provider Abstraction for Headless Vault Unlock

**Status:** Accepted  
**Date:** 2026-04-05  
**Deciders:** Owen Johnson  
**Principles:** P3 (Transparent Evolution), P10 (Categorical Symmetry), P15 (Secure by Default), P9 (Composability)

## Context

`@centient/secrets` stores the vault encryption key in the macOS Keychain via `security` CLI. This requires Touch ID or system password for every unlock — making it impossible to unlock the vault over SSH, on headless cloud instances, or after an unattended reboot. This blocks remote operation of the centient MCP server.

The vault file itself is AES-256-GCM encrypted with a 32-byte key. Only the key retrieval method needs to change — the encryption format, session TTL, and vault file structure remain unchanged.

### Current architecture

```
secrets-cli.ts
  └─ getKeyFromKeychain("centient-vault", "vault-key")
       └─ security find-generic-password (macOS CLI)
            └─ Returns Buffer (hex-decoded 32 bytes)
```

The keychain functions are hardcoded into the CLI. No abstraction exists between "retrieve the vault key" and "use the macOS Keychain."

### Motivating use cases

1. **SSH sessions** — operator connects to a Mac mini running centient; Touch ID is unavailable.
2. **Cloud/CI** — centient server runs on Linux without any desktop keychain.
3. **Unattended reboot** — server restarts and must auto-unlock using a service account token.

### Deployment topology

The vault key and the vault file are independent concerns:

- **Vault key** — lives in the provider's storage (Keychain on local macOS, or 1Password's cloud). The 1Password `op` CLI retrieves it over the network; the 1Password desktop app does **not** need to be installed on the machine performing the unlock.
- **Vault file** (`~/.centient/secrets/vault.enc`) — must be present on the machine doing the decryption. It is not synced by the provider.

Typical remote/CI setup:

```
Machine A (operator's Mac, with 1Password app)
  └─ centient secrets init              → generates key
  └─ centient secrets migrate --to 1password
  └─ copies vault.enc to remote host

Machine B (remote server / CI runner)
  └─ has `op` CLI binary installed
  └─ has OP_SERVICE_ACCOUNT_TOKEN env var set
  └─ has ~/.centient/secrets/vault.enc (copied/synced from Machine A)
  └─ has ~/.centient/config.json with secrets.provider: "1password"
  └─ centient secrets unlock  → op reads key from 1Password cloud → decrypts local vault
```

The 1Password desktop app is only needed on the machine where the operator initially stores the key (and even then, only if using interactive auth rather than a service account).

## Decision

Introduce a **KeyProvider** interface that abstracts vault key storage. The current Keychain logic becomes `KeychainProvider`. A new `OnePasswordProvider` wraps the `op` CLI for both interactive and headless auth.

### KeyProvider interface

```typescript
interface KeyProvider {
  readonly name: KeyProviderType;
  getKey(): Buffer | null;
  storeKey(key: Buffer): boolean;
  deleteKey(): boolean;
}

type KeyProviderType = "keychain" | "1password";
```

Deliberately minimal — matches the existing `Buffer | null` / `boolean` return contract used throughout `vault-common.ts` (P2: no silent degradation while keeping the API honest about failures).

### Provider implementations

| Provider | Backend | Auth modes | Platform |
|----------|---------|-----------|----------|
| `KeychainProvider` | macOS `security` CLI | Touch ID / system password | macOS only |
| `OnePasswordProvider` | `op` CLI | Desktop app, service account (`OP_SERVICE_ACCOUNT_TOKEN`), CLI session | Any (requires `op` binary) |

### Provider selection

Configured via `~/.centient/config.json`:

```json
{
  "secrets": {
    "provider": "1password",
    "onePassword": {
      "vault": "Private",
      "item": "centient-vault-key"
    }
  }
}
```

Resolution order:
1. Explicit config (`secrets.provider` field) — if set, use it; fail if unavailable.
2. Auto-detection fallback — if no config, check `op` availability + authentication, then fall back to Keychain on macOS.

Auto-detection is a convenience for first-time setup and simple environments. Explicit config is recommended for production/CI.

### 1Password item structure

The vault key is stored as a concealed `password` field on a Password-category item:

```
op://Private/centient-vault-key/password
```

- **Vault:** Configurable (default: `"Private"`)
- **Item:** Configurable (default: `"centient-vault-key"`)
- **Field:** `password` (1Password Password-category default)
- **Format:** 64-character hex string (32 bytes)

### Migration

`centient secrets migrate --to <provider>` transfers the vault key between providers:

1. Read key from current provider
2. Store key in target provider
3. Verify round-trip (read back from target, compare)
4. Update `~/.centient/config.json`
5. Print confirmation

The vault file is untouched — only the key storage location changes. The old provider's key is not automatically deleted (operator can remove it manually for defense in depth).

### No new dependencies

The 1Password provider shells out to `op` CLI via `execFileSync` — same pattern as the existing Keychain provider's use of `security` CLI. No `@1password/sdk` package dependency (P12: cost-aware, P15: minimal attack surface).

## Consequences

### Positive

- **Headless unlock** — `OP_SERVICE_ACCOUNT_TOKEN` enables fully automated vault access on remote/CI machines.
- **Category-complete** (P10) — the KeyProvider interface naturally accommodates future providers (passphrase/KDF, AWS KMS, etc.) without changing the CLI or consumer code.
- **Non-breaking** — existing macOS Keychain users see zero behavior change; auto-detection defaults to Keychain on macOS when no config exists.
- **Consumer isolation** — the centient MCP server calls `resolveKeyProvider().getKey()` instead of `getKeyFromKeychain()`. Provider choice is invisible to the consumer.

### Negative

- **`op` CLI dependency** — 1Password provider requires `op` binary installed and configured. Detection at resolve-time provides a clear error if missing.
- **Process argument visibility** — hex key is passed as a CLI argument to `op item create/edit`, visible in `ps` output momentarily. This is consistent with the existing `security` CLI approach. A future improvement could use 1Password Connect or SDK for process-internal key handling.
- **Global config file** — introduces `~/.centient/config.json` as a new file. Per-environment configs in `~/.centient/environments/<name>/config.json` are unchanged. The vault key provider is global because all environments share one encryption key.

### Neutral

- Migration is a one-time operation. Most users will set up 1Password once and never touch it again.
- The `deleteKey()` method exists for symmetry and testing; migration does not call it automatically.

## File structure

```
packages/secrets/src/key-providers/
├── types.ts                 # KeyProvider interface, KeyProviderType
├── keychain-provider.ts     # macOS Keychain (wraps vault-common.ts)
├── onepassword-provider.ts  # 1Password op CLI
├── resolve.ts               # Config loading + auto-detection
└── index.ts                 # Barrel exports
```

## Consumer migration guide (centient MCP server)

The centient MCP server repo imports from `@centient/secrets` and calls keychain functions directly. These call sites need to switch to the provider abstraction.

### Import changes

```typescript
// Before
import {
  getKeyFromKeychain,
  storeKeyInKeychain,
} from "@centient/secrets";

// After
import { resolveKeyProvider } from "@centient/secrets";
```

### Usage changes

```typescript
// Before
const key = getKeyFromKeychain("centient-vault", "vault-key");
storeKeyInKeychain("centient-vault", "vault-key", key);

// After
const result = resolveKeyProvider();
if (!result.ok) {
  // Handle error: result.error.code, result.error.message
  return;
}
const provider = result.provider;

const key = provider.getKey();       // Buffer | null
provider.storeKey(key);              // boolean
provider.deleteKey();                // boolean (if needed)
```

### Key differences

1. **No service/account args** — the provider encapsulates its own storage details.
2. **Resolution can fail** — `resolveKeyProvider()` returns a result type. Check `result.ok` before accessing `result.provider`. The error includes an actionable message (e.g., "Install the 1Password CLI").
3. **Provider name available** — `result.provider.name` returns `"keychain"` or `"1password"` for display purposes.
4. **Resolution method** — `result.method` is `"config"` or `"auto"` indicating how the provider was selected.

---

## Amendment 1 (2026-06-12): Passphrase provider

**Status:** Accepted (extension) — **security properties PENDING RE-AUDIT**
**Date:** 2026-06-12
**Trigger:** Issue #67 merged the passphrase provider (PR #67, commit `b171141`); the hidden-input cap and signal-handling fixes landed in commit `895b88d`. ADR-001's `KeyProviderType` union, provider table, resolution order, and config schema were written before this provider existed and did not cover it. This amendment reconciles the record with the shipped code (`packages/secrets/src/key-providers/passphrase-provider.ts`, `cli/hidden-prompt.ts`, `cli/hidden-input.ts`). It is an **append**, not a rewrite of the original decision.

### Why a third provider

The original two providers each assume an external trust store: Keychain needs macOS + an interactive desktop session, 1Password needs the `op` binary plus either the desktop app or a service-account token. A headless **Linux** host with neither — a bare CI runner or a minimal cloud VM — had no way to unlock the vault. The passphrase provider closes that gap: it derives the 32-byte AES-256-GCM vault key from an operator-typed passphrase via scrypt, persisting only non-secret KDF metadata (salt, cost params) plus an HMAC verifier beside the vault. No key material is stored at rest.

### `KeyProviderType` union (amended)

The union shipped in `packages/secrets/src/key-providers/types.ts:17` is now:

```typescript
type KeyProviderType = "keychain" | "1password" | "passphrase";
```

(This is the authoritative union for the ADR; the original at line 70 above and the category-completeness aside in Consequences → Positive both predate this provider. The aside *anticipated* a "passphrase/KDF" provider; it does not constitute the type-level commitment — this amendment does.)

### Provider table (amended)

| Provider | Backend | Auth modes | Platform |
|----------|---------|-----------|----------|
| `KeychainProvider` | macOS `security` CLI | Touch ID / system password | macOS only |
| `OnePasswordProvider` | `op` CLI | Desktop app, service account (`OP_SERVICE_ACCOUNT_TOKEN`), CLI session | Any (requires `op` binary) |
| `PassphraseProvider` | scrypt KDF over a typed passphrase | Hidden interactive TTY prompt (`promptHiddenSync`) | Any (requires an interactive TTY at unlock time) |

### Resolution order (amended)

The order in `resolve.ts` now has a third tier. Explicit config (`secrets.provider`) is honored strictly as before — `"passphrase"` is a valid explicit value and `resolveExplicit()` constructs a `PassphraseProvider` unconditionally (TTY availability is only checked at prompt time, where a non-TTY fails closed via `HiddenPromptError`). Auto-detection now falls through to passphrase last:

1. Explicit config (`secrets.provider`) — use it; fail if unavailable.
2. Auto-detection: 1Password if `op` is available → else Keychain on macOS → **else `PassphraseProvider` when `process.stdin.isTTY === true`** (`PassphraseProvider.detect()`).
3. If none detect, `resolveAuto()` returns `NO_PROVIDER` with an actionable message naming all three options.

Passphrase is intentionally **last** in auto-detection: it requires a human at a keyboard, so it is the fallback for hosts with no OS key store, not a default for hosts that have one.

### Config schema (amended)

`secrets.provider` accepts `"passphrase"`. The provider needs no provider-specific config block (no analogue to `onePassword`) — its only external input is the vault path, which `resolveKeyProvider({ vaultPath })` already threads through. Metadata location is derived from the vault path (`vault.enc` → `vault.passphrase.json`, see `passphraseMetadataPathForVault`).

```json
{
  "secrets": { "provider": "passphrase" }
}
```

### Provider contract notes (passphrase-specific)

- **`storeKey()` is unsupported.** A passphrase provider derives the key; it does not store a caller-supplied random key. `storeKey()` returns `false` and records an `UNSUPPORTED_OPERATION` diagnostic. Vault bootstrap uses the optional **`setupKey()`** method on the `KeyProvider` interface (`types.ts:57`), which prompts twice (entry + confirmation), writes the metadata sidecar, and returns the derived key. Migration *to* passphrase must therefore route through `setupKey()`, not `storeKey()`.
- **Verifier, not stored key.** The metadata sidecar stores an HMAC-SHA256 verifier (`createHmac(key).update(PASSPHRASE_VERIFIER_CONTEXT)`), checked with `timingSafeEqual`, so a wrong passphrase fails with `PASSPHRASE_VERIFICATION_FAILED` rather than corrupting the vault. The verifier does not reveal the key.

### Security-relevant properties — PENDING RE-AUDIT

ADR-001 was affirmed at phase-2 spot-check (`docs/hardening/STATE.md`) **before** this provider existed, so the affirmation does not cover it. The following two properties from `895b88d` are the audit-critical ones and have **not** been through an adversarial `cl-adr-audit`; they are recorded here as claims to be refuted, not as verified facts. A scoped re-run is tracked in STATE.md phase 7.

1. **64 KiB hidden-input cap.** `MAX_HIDDEN_INPUT_LENGTH = 65_536` (`cli/hidden-prompt.ts:52`) bounds accumulated hidden input; a hostile or broken input source feeding endless bytes with no submit cannot grow `state.input` without bound — the prompt throws `HiddenPromptError` and drops the reference. **To re-audit:** that the cap is actually reached on the unbounded-input path (not dead behind an earlier return) and that the dropped string carries the documented GC-residue caveat, not a stronger zeroing claim the immutable-string model cannot honor.
2. **Deferred-one-tick signal handling.** Because the prompt is synchronous, an external `SIGINT`/`SIGTERM`/`SIGHUP` received while `readSync` blocks is queued by libuv and dispatched only after the prompt unwinds. Listeners are installed to suppress the immediate default kill (which would leave the terminal in raw mode with echo off), and their removal is **deferred one tick** via `setImmediate` so the queued dispatch is not dropped (`cli/hidden-prompt.ts:114-160`). **To re-audit:** that removing the listeners synchronously would in fact swallow the queued signal (the failure mode the deferral guards against), that the re-raise reaches the default disposition, and that no sibling handler can fire after the prompt completes.

### Authority placement (P16)

Where the passphrase-derived key lives relative to the untrusted side: the key is derived **inside the same process** that opens the vault and is held in the Node heap as a `Buffer` for the unlock window — identical residence to the Keychain- and 1Password-retrieved keys. The typed passphrase is returned as an immutable JS `string` that cannot be zeroed and lingers until GC (the transient `readSync` byte buffer **is** zeroed before return). **P16 consequence:** this provider is for a **protected trust domain that does not execute untrusted input** (an operator at an interactive terminal unlocking a host process). It is *not* suitable for a sandbox that runs PR-/agent-authored code or LLM-driven tool calls — co-resident untrusted code can read the derived `Buffer` and the residual passphrase string from the heap, exactly as it could the other providers' keys. The headless-unlock use case this provider enables is the operator/host side of the boundary, never the sandbox side. The interactive-TTY requirement is incidentally aligned with this: code running in an untrusted sandbox has no human at a keyboard to type the passphrase.

### Updated file structure

```
packages/secrets/src/key-providers/
├── types.ts                  # KeyProvider interface, KeyProviderType (now 3-member)
├── keychain-provider.ts      # macOS Keychain (wraps vault-common.ts)
├── onepassword-provider.ts   # 1Password op CLI
├── passphrase-provider.ts    # scrypt KDF over a typed passphrase (Amendment 1)
├── resolve.ts                # Config loading + auto-detection (3-tier)
└── index.ts                  # Barrel exports
packages/secrets/src/cli/
├── hidden-prompt.ts          # synchronous hidden TTY read (64 KiB cap, signal handling)
└── hidden-input.ts           # hidden-input state machine / parser
```

### Cross-reference

The passphrase provider and its security properties are also the subject of the ADR-002 1.0 KeyProvider ↔ SecretsProvider reconciliation ticket; the `op` argv-visibility negative (Consequences → Negative above) has its own ticket. Both are linked from `docs/hardening/STATE.md` phase 7.
