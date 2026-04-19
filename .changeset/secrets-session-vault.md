---
"@centient/secrets": minor
---

Add `openVault()` — a public session-backed envelope vault API. Closes #40.

Long-running daemons (centient-labs/maintainer) that hold N credentials across a long lifetime previously had to choose between:
- per-item `getCredential()` calls that prompt the OS keychain on every first-read (and silently fail when the keychain auto-locks), or
- reimplementing session-backed vault logic inline

`openVault()` exposes the CLI-internal session machinery as a first-class public API: one KeyProvider prompt at startup, subsequent reads hit RAM, external writes (e.g. `centient secrets set` in another shell) become visible via mtime-check coherence.

## New public API

```typescript
import { openVault, type SessionVault } from "@centient/secrets";

const vault = await openVault();                 // single Keychain prompt
const apiKey = await vault.get("anthropic-key"); // RAM hit
const keys = await vault.list("anthropic.");     // RAM hit
await vault.set("new-key", "some-value");        // atomic write + sidecar
vault.close();                                   // release key from RAM
```

Full surface: `openVault`, `SessionVault`, `OpenVaultOptions`, `CoherenceStrategy`, `VAULT_SCHEMA_VERSION`, `DEFAULT_VAULT_PATH`, `DEFAULT_SIDECAR_PATH`, and six typed error classes (`VaultError`, `VaultUnlockError`, `VaultDecryptError`, `VaultRollbackError`, `VaultClosedError`, `VaultLockError`).

## Security hardening (landed alongside the extraction)

- **AAD binding on encrypt/decrypt.** `encrypt`, `decrypt`, `encryptObject`, `decryptObject` now accept an optional `aad` parameter. The session vault uses `sha256("centient-secrets-vault:v1:{vault-path}")` as AAD so ciphertext from one vault cannot be substituted into another vault's path — auth-tag verification fails cleanly. Backward-compatible: existing callers that pass no `aad` see unchanged behavior.
- **Monotonic `vaultVersion` inside the encrypted payload.** Increments on every write. Forging a lower version requires the master key (bound by the AEAD auth tag).
- **Sidecar file** `~/.centient/secrets/vault.seen-version` tracks `highestSeenVersion` across sessions. Persists rollback protection across process restarts. `openVault` refuses to load a vault whose version is lower than the highest previously observed, unless `{ acceptRollback: true }` is explicitly passed (emits a scary stderr warning).
- **Sidecar + vault permission warnings.** `openVault` stats both files and warns on stderr if either is world-readable or group-readable. Mirrors the defensive posture callers expect.
- **Write-path advisory file lock.** `set` and `delete` acquire an exclusive O_EXCL lock on `{vault}.lock` to serialize concurrent writers from the same or different processes. Stale locks older than 30 s are stolen. Reads don't need a lock (mtime-check handles stale reads).
- **Write ordering: vault first, sidecar second.** A crash between them leaves the sidecar lagging ("catches up next write") — graceful, not a false-positive rollback trigger.
- **`SecretsPolicy` integration.** Every `get` / `list` / `set` / `delete` flows through the existing middleware layer (PR #26). Operators can enable `auditTrail` centrally for the whole package, including new vault operations.
- **Name validation on `set`.** Rejects names with control characters, slashes, backslashes, null bytes, or exceeding 256 characters.
- **`close()` semantics.** Best-effort key zeroing via `Buffer.fill(0)`; subsequent method calls throw `VaultClosedError`; `close()` is idempotent.
- **Optional `ttlMs`** for short-lived script consumers that want defense-in-depth auto-close. Not set by default — daemons run forever and forced re-auth undoes the session vault's purpose.

## Threat-model documentation

`packages/secrets/docs/session-vault.md` explicitly documents what this API protects (FS-read, FS-write, cold-start rollback, accidental backup restore) and what it doesn't (adversary with master key + FS write; adversary with write access to the vault directory doing lockstep downgrade; memory exfiltration via core dumps or Node inspector). The honest framing recommends HashiCorp Vault / AWS Secrets Manager / 1Password Connect for threat models this local-file primitive can't support.

## Format stability

The encrypted payload format (`{ schema: 1, vaultVersion, secrets }`) is stable from this release. Future schema migrations will require a documented read-v1/write-v2 compat window.

## Tests

29 new integration tests cover: encrypt/decrypt round-trip with AAD binding, rollback detection + sidecar update on accepted rollback, missing-sidecar auto-init with and without the opt-in, mtime-check coherence, best-effort coherence ignoring external writes until `reload()`, close() + read throwing `VaultClosedError`, ttlMs auto-close, AAD path-swap detection, nonce uniqueness across 20 writes, concurrent-writer serialization via file lock, permission warnings for vault and sidecar, crash-between-writes recovery (vault ahead of sidecar), and name validation (6 invalid-name cases).

Existing 130 secrets tests pass unchanged. Total: 159 secrets tests.

## Backwards compatibility

The existing per-item API (`storeCredential` / `getCredential` / `listCredentials` / `deleteCredential`) is unchanged. New consumers should prefer `openVault` for multi-credential workloads; per-item APIs remain appropriate for one-shot scripts.

## Downstream migration path

Once this lands, `centient-labs/maintainer`'s `src/credentials.ts` (~50 LOC) can migrate off per-item `getCredential` calls. Eliminates per-review Keychain prompts, fixes silent failures on keychain auto-lock, and enables credential rotation without daemon restart. Tracked as a follow-up PR in the maintainer repo.
