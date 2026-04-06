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
