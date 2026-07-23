# @centient/secrets

Cross-platform secrets vault with AES-256-GCM encryption and platform-native key storage.

> **Daemons / long-running processes:** see [Session-backed vault (`openVault`)](./docs/session-vault.md) for the recommended API — single master-key unlock per session, in-memory cached reads, mtime-check coherence with the CLI, rollback protection via monotonic version + sidecar.

## Installation

```bash
npm install @centient/secrets
```

Or with pnpm:

```bash
pnpm add @centient/secrets
```

## Features

- AES-256-GCM authenticated encryption for secrets at rest
- Platform-native key storage (macOS Keychain, Linux secret-service)
- Pluggable key providers (Keychain, 1Password, passphrase)
- Credential vault with session management, plus an opt-in 1Password credential backend
- Environment detection (CI, Docker, SSH, headless, agent)
- Built-in CLI for interactive secret management

## Quick Start

```typescript
import { storeCredential, getCredential, deleteCredential } from "@centient/secrets";

// Store a credential
await storeCredential("my-service", "api-key", "<your-api-key>");

// Retrieve it
const value = await getCredential("my-service", "api-key");

// Delete when no longer needed
await deleteCredential("my-service", "api-key");
```

### Encryption Utilities

```typescript
import { encrypt, decrypt } from "@centient/secrets";

const key = crypto.randomBytes(32);
const encrypted = encrypt("sensitive data", key);
const decrypted = decrypt(encrypted, key);
```

### Platform Detection

```typescript
import { isCIEnvironment, isDockerContainer, isAgentEnvironment } from "@centient/secrets";

if (isCIEnvironment()) {
  // Use environment variable fallback
}
```

## Key Providers

| Provider | Platform | Description |
|----------|----------|-------------|
| `KeychainProvider` | macOS/Linux | Uses OS keychain (Keychain Access / secret-service) |
| `OnePasswordProvider` | Any | Uses 1Password CLI for team secret sharing |
| `PassphraseProvider` | Any (interactive TTY) | Derives the vault key from a typed passphrase via scrypt — no OS keychain required |

Provider auto-detection prefers OS-backed storage: 1Password, then Keychain,
then passphrase as the last fallback. Set `secrets.provider: "passphrase"` in
`~/.centient/config.json` to select it explicitly.

## Credential storage backends

The **key** layer above decides where the vault *encryption key* lives. This is
the separate **credential** layer: where secret *values* are stored.

| Backend | Platform | Selection |
|---|---|---|
| `KeychainVault` | macOS | auto |
| `WindowsVault` | Windows / WSL | auto |
| `LibsecretVault` | Linux | auto |
| `GpgVault` | Linux / WSL | auto |
| `EnvVault` | Any | auto (last resort) |
| `OnePasswordVault` | Any (needs `op`) | **explicit opt-in only** |

The first five form an auto-cascade, picked by `detect()` in that order.
`OnePasswordVault` is deliberately **outside** it: having the 1Password CLI
installed is not consent to route credentials into your personal vault, so it is
reachable only when you ask for it by name (ADR-004).

```jsonc
// centient config file
{
  "secrets": {
    "provider": "keychain",              // KEY layer  — key stays in the Keychain
    "backend": "1password",              // VALUE layer — credentials in 1Password
    "onePasswordBackend": {
      "vault": "centient-credentials",   // REQUIRED — no default
      "tag": "centient"                  // optional
    }
  }
}
```

Environment equivalents, which take precedence:
`CENTIENT_SECRETS_BACKEND=1password` and `CENTIENT_OP_VAULT=<name>`.

Two behaviours worth knowing:

- **No default vault, and it fails closed.** Unlike the key block (which defaults
  to `Private`), an unset `onePasswordBackend.vault` under an explicit
  `backend: "1password"` is an error. Guessing could write credentials into a
  vault you did not intend.
- **An explicit choice is never silently substituted.** If you name `1password`
  and `op` turns out to be missing or unauthenticated, startup throws rather than
  quietly falling back to the Keychain — otherwise your secrets would land
  somewhere other than where you said.

Secret values are written over **stdin** (`op item create -`), never as argv, so
they never appear in `ps`. Only key *names* are cached (5s TTL, mirroring the
Keychain backend); values are never cached, so a rotated or revoked credential is
never served from memory.

**Key constraint.** This backend enforces `isValidKey` (lowercase alphanumeric
with `-` or `.` separators, 2–64 chars) on every operation, and refuses anything
else rather than storing it. Reads address the value as
`op://<vault>/<key>/password`, which is path-structured: a key containing `/`
would store fine — a 1Password item title is just a string — and then re-parse on
read into a different item and field, so the write would be silently unreadable.
Refusing is the better failure; a caller believing a credential is saved when it
cannot be read back is worse than a caller told no.

### Per-consumer vault keys

By default `KeychainProvider` targets a single shared Keychain item
(`service="centient-vault"`, `account="vault-key"`), so every consumer on a
machine unlocks its vault with the *same* master key. Two complementary options
let each consumer use its own key (issue #80). Both are additive — with no
options the behaviour is byte-identical to before, and existing vaults keep
opening.

**Name your own Keychain item** — the lightweight path. Pass `keychain` to
`openVault()` (threaded into internal provider resolution) so your consumer's
master key lives under its own Keychain item:

```ts
import { openVault } from "@centient/secrets";

// Encrypts/decrypts this vault under the "burnrate-vault" Keychain item
// instead of the global "centient-vault" item.
const vault = await openVault({ keychain: { service: "burnrate-vault" } });
```

Or construct the provider directly:

```ts
import { KeychainProvider } from "@centient/secrets";

const provider = new KeychainProvider({ service: "burnrate-vault", account: "k" });
```

**Inject your own provider** — full control, and the headless-testability path.
Pass `keyProvider` and `openVault()` uses it verbatim, skipping internal
resolution (config + auto-detection) entirely. This lets you drive `openVault()`
in tests against a throwaway in-memory provider with no real Keychain:

```ts
import { openVault, type KeyProvider } from "@centient/secrets";

const stub: KeyProvider = {
  name: "keychain",
  getKey: () => myTestMasterKey, // 32-byte Buffer
  storeKey: () => true,
  deleteKey: () => true,
};

const vault = await openVault({ keyProvider: stub });
```

A custom provider can also wrap any backend (remote KMS, HSM, env-injected key)
as long as it implements the `KeyProvider` interface.

### Passphrase provider

For hosts without an OS keychain or 1Password CLI (e.g. a headless Linux box
over SSH), the vault key is derived from a passphrase typed at an interactive
terminal using scrypt (`N=2^17, r=8, p=1`, 32-byte key — ~128 MB memory cost
per derivation, in line with current OWASP guidance). The passphrase and the
derived key are never persisted. A sidecar file (`vault.passphrase.json`,
mode `0600`, beside the vault) stores only the salt, the KDF parameters, and
an HMAC-SHA256 verifier used to detect a wrong passphrase without revealing
the key.

Security tradeoffs vs OS-backed providers — choose deliberately:

- **Passphrase strength is the security ceiling.** Keychain keys are random
  256-bit values guarded by the OS; a passphrase-derived key is only as strong
  as the passphrase. The scrypt cost is the sole brake on brute force.
- **The sidecar enables offline guessing if exfiltrated.** An attacker holding
  `vault.passphrase.json` (or the vault file) can test candidate passphrases
  offline at ~one guess per 128 MB-scrypt derivation. Use a long, high-entropy
  passphrase.
- **No human-presence guarantee.** Unlike Keychain with Touch ID, typing a
  passphrase proves knowledge, not presence; it cannot satisfy policies that
  require fresh per-operation human auth.
- **Interactive TTY required — fails closed otherwise.** In CI, agent, or
  other non-interactive contexts the provider refuses to prompt and unlock
  fails with an actionable error. Configure keychain/1Password for
  non-interactive use.
- **Unlock blocks the event loop.** Key derivation is synchronous (~hundreds
  of ms); daemons should call `openVault()` once at startup, before entering
  their hot loop.

## License

MIT
