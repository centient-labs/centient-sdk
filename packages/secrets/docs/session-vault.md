# Session-backed vault (`openVault`)

> **Terminology:** this document uses *session vault* as shorthand for session-backed envelope vault; *envelope vault* refers to the encryption scheme.

`openVault()` opens the CLI's encrypted vault file once per process, caches the decrypted contents in RAM, and serves reads without further master-key prompts. It's the recommended API for long-running processes (daemons, workers) that hold multiple credentials across a long lifetime.

## Quick start

```typescript
import { openVault } from "@centient/secrets";

const vault = await openVault();                 // single Keychain prompt here
const apiKey = await vault.get("anthropic-key"); // RAM hit, no prompt
const keys = await vault.list("anthropic.");     // RAM hit
await vault.set("new-key", "some-value");        // atomic file write + sidecar update
vault.close();                                   // release key from RAM
```

## Error handling

Narrow on the concrete error subclasses to decide whether recovery is possible:

```typescript
import { openVault, VaultRollbackError, VaultDecryptError, VaultClosedError } from "@centient/secrets";

try {
  const vault = await openVault();
  // ...
} catch (err) {
  if (err instanceof VaultRollbackError) {
    // Sidecar says version >= err.expected but vault file is at err.actual.
    // This is either a backup-restore or an adversarial downgrade.
    // If intentional, re-open with { acceptRollback: true }.
    console.error(`Rollback detected: sidecar expects >=${err.expected}, vault is at ${err.actual}`);
  } else if (err instanceof VaultDecryptError) {
    // Wrong key, corrupted file, or AAD mismatch (vault path changed).
    // Operator action required — don't auto-recover.
    console.error(`Decrypt failed: ${err.message}`);
  } else if (err instanceof VaultClosedError) {
    // Called a method on a closed vault. Open a new one.
  } else {
    throw err;
  }
}
```

## When to use this vs. the per-item API

| Pattern | Use `openVault` | Use `getCredential` / `storeCredential` |
|---|---|---|
| Long-running daemon holding N creds | ✅ | ❌ (per-item prompt per cred) |
| One-shot script that reads one cred | ❌ (overhead of unlock) | ✅ |
| CLI command with interactive unlock | CLI uses it internally | — |
| Frequent rotation / runtime updates from external CLI | ✅ (mtime-check) | ❌ (process-local cache) |
| Cross-backend portability (Keychain / libsecret / GPG / 1Password) | ✅ | ✅ |

## API surface

```typescript
export async function openVault(opts?: OpenVaultOptions): Promise<SessionVault>;

export interface SessionVault {
  get(name: string): Promise<string | null>;
  list(prefix?: string): Promise<string[]>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
  reload(): Promise<void>;
  close(): void;

  readonly provider: KeyProviderType;
  readonly path: string;
  readonly vaultVersion: number;
}

export interface OpenVaultOptions {
  path?: string;
  sidecarPath?: string;
  coherence?: "mtime-check" | "strict" | "best-effort";
  acceptRollback?: boolean;
  acceptMissingSidecar?: boolean;
  ttlMs?: number;
}
```

### `coherence` strategies

- **`"mtime-check"`** (default) — on every read, `stat` the vault file; re-decrypt if `mtime` advanced. Catches external writes (e.g. `centient secrets set` in another shell) with a single `stat` per read.
- **`"strict"`** — throws `VaultError` with code `VAULT_STALE_SNAPSHOT` if the vault file was modified since the last snapshot. Caller must explicitly `reload()` to continue.
- **`"best-effort"`** — keeps the in-memory snapshot until an explicit `reload()`. Lowest overhead, but external writes are invisible.

### Coherence modes — examples

```typescript
// strict: throws on external writes, caller must explicitly reload
const vault = await openVault({ coherence: "strict" });
try {
  const v = await vault.get("key");
} catch (err) {
  if (err instanceof VaultError && err.code === "VAULT_STALE_SNAPSHOT") {
    await vault.reload();
    const v = await vault.get("key");
  }
}

// best-effort: keeps snapshot until explicit reload
const vault = await openVault({ coherence: "best-effort" });
// ... external writes are invisible
await vault.reload(); // pulls in changes now
```

### Errors

All errors extend `VaultError`, which has a `code` discriminator. Codes without a dedicated subclass surface as the base `VaultError`; match on `error.code`.

| Class | `code` | When |
|---|---|---|
| `VaultError` | various | base class |
| `VaultUnlockError` | `VAULT_UNLOCK_FAILED` | KeyProvider couldn't produce a master key |
| `VaultDecryptError` | `VAULT_DECRYPT_FAILED` | decryption failed (wrong key, corrupted, AAD mismatch) |
| `VaultRollbackError` | `VAULT_VERSION_ROLLBACK_DETECTED` | sidecar expects version >= X, vault reports < X |
| `VaultClosedError` | `VAULT_CLOSED` | method called after `close()` |
| `VaultLockError` | `VAULT_LOCK_FAILED` | write-path lock couldn't be acquired within timeout |

Additional `VaultError` codes (no dedicated subclass):

| Error code | Throwing class | When |
|---|---|---|
| `VAULT_NOT_FOUND` | `VaultError` | `openVault` — vault file absent |
| `VAULT_FILE_MISSING` | `VaultError` | `get` / `list` / `set` / `delete` / `reload` — vault deleted mid-session |
| `VAULT_STALE_SNAPSHOT` | `VaultError` | reads under `coherence: "strict"` — external write advanced mtime |
| `VAULT_ENCRYPT_FAILED` | `VaultError` | internal — encryption returned null (corruption-adjacent) |
| `INVALID_NAME` | `VaultError` | `set()` — name is empty, too long, or contains invalid chars |

## Threat model

**What this protects:**

- Filesystem-read-only adversaries: ciphertext is AEAD-encrypted (AES-256-GCM); forging plaintext requires the master key.
- Live-session and cold-start vault-file rollback by a filesystem-write-only adversary: the combined in-payload `vaultVersion` + sidecar-file `highestSeenVersion` scheme refuses to load a version lower than the highest previously observed.
- Accidental rollback from backup-restore: sidecar persists across sessions; a `cp vault.old.enc vault.enc` or a partial Time Machine restore is caught.

**What this does NOT protect:**

- An adversary with **both** master-key access and filesystem write access — game over for any local envelope vault.
- An adversary with write access to the vault directory who downgrades both vault and sidecar in lockstep. The sidecar lives next to the vault (`~/.centient/secrets/vault.seen-version`) by default. If your threat model includes adversarial writes to that directory, use a secrets service with remote attestation (HashiCorp Vault, AWS Secrets Manager, 1Password Connect) instead.
- Memory exfiltration via core dumps or the Node.js inspector. The session key is in process RAM for the full session lifetime. Operators running daemons SHOULD:
  - Disable core dumps: `ulimit -c 0` (shell) or `prlimit --core=0 --pid $PID` (launchd / systemd).
  - Never run the daemon with `NODE_OPTIONS=--inspect` — the inspector socket grants heap read to anyone who can connect.
- On macOS, a newly-started process will still prompt the user for Keychain access even if another process holds the vault open. Keychain ACLs are per-process, not per-vault-file.
- **Best-effort key zeroing only.** `close()` calls `Buffer.fill(0)` on the key buffer, but if the key ever transited through a string (accidental `String(buf)`, `util.inspect`, `console.log`), those copies linger until V8 GC. The API can't guarantee full memory wipe.

## Rollback protection

The scheme is layered (option 1 + option 3 from the design discussion on [#40](https://github.com/centient-labs/centient-sdk/issues/40)):

1. **In-payload `vaultVersion`** — an integer inside the encrypted payload, incremented on every write. Protects live-session mid-flight rollback because forging a lower version requires the master key (the field is bound by the AEAD auth tag).
2. **Sidecar file** at `~/.centient/secrets/vault.seen-version` — JSON `{ highestSeenVersion: N }`, mode `0600`. Persists `max` across sessions; catches cold-start rollback from backup-restore.

On every successful write, the vault file is renamed atomically first, then the sidecar is updated. A crash between the two leaves the sidecar lagging ("catches up next write"), which is graceful — the reverse ordering would false-positive rollback detection after any partial-write crash.

### Intentional rollback

If you deliberately restore an older vault (e.g. recovering from a bad key rotation):

```typescript
const vault = await openVault({ acceptRollback: true });
// Emits a scary stderr warning; updates sidecar to match the restored vault.
```

### Missing sidecar

If the sidecar is absent (first use, or someone tidied `~/.centient`):

- Default: auto-initialize `seenVersion = vaultVersion`, warn on stderr.
- With `acceptMissingSidecar: true`: suppress the warning (for test fixtures / fresh installs).

## Concurrent writers

`set` and `delete` acquire an advisory lock on `{vaultPath}.lock` (native `O_EXCL` file lock, no new dependency). Writers that crash leave stale locks older than 30 s, which are stolen by the next waiter. Reads don't need a lock — `mtime-check` coherence handles stale reads on the next read cycle.

## Policy integration

Every `get` / `list` / `set` / `delete` flows through the `SecretsPolicy` middleware layer ([PR #26](https://github.com/centient-labs/centient-sdk/pull/26)). Operators can enable central audit logging with:

```typescript
import { setSecretsPolicies, auditTrail, openVault } from "@centient/secrets";

setSecretsPolicies([
  auditTrail({
    sink: (event) => fs.appendFileSync("/var/log/centient-secrets-audit.log", JSON.stringify(event) + "\n"),
    includeReads: true,
  }),
]);

const vault = await openVault();
// All vault operations now emit audit events to the configured sink.
```

`SecretsEvent.backend` is `"session-vault"` for operations through `openVault`.

## Migration from per-item API

Before (per-item, one Keychain prompt per cred):

```typescript
import {
  storeCredential,
  getCredential,
  listCredentials,
  deleteCredential,
} from "@centient/secrets";

await storeCredential("anthropic-key", "sk-...");
const key = await getCredential("anthropic-key");
const keys = await listCredentials("anthropic.");
await deleteCredential("anthropic-key");
```

After (`openVault`, one prompt for the whole session):

```typescript
import { openVault } from "@centient/secrets";

const vault = await openVault();
await vault.set("anthropic-key", "sk-...");
const key = await vault.get("anthropic-key");
const keys = await vault.list("anthropic.");
await vault.delete("anthropic-key");
```

Mapping:

| Per-item API | `openVault` equivalent |
|---|---|
| `storeCredential(name, value)` | `vault.set(name, value)` |
| `getCredential(name)` | `vault.get(name)` |
| `listCredentials(prefix?)` | `vault.list(prefix?)` |
| `deleteCredential(name)` | `vault.delete(name)` |

The per-item `storeCredential` / `getCredential` / `listCredentials` / `deleteCredential` APIs remain intact and functional for callers that want per-item semantics.

## Name validation

`set()` rejects names containing control characters, `/`, `\`, null bytes, or exceeding 256 characters. This is a hardening step against callers that might route user-controlled input through `set()`; the existing per-item library accepts anything.

## Operational topics

### Credential rotation mid-session

If `centient secrets set` runs in another shell while the daemon has a session open, the next `vault.get()` stats the vault file, sees the new mtime, and re-decrypts automatically. For zero-gap rotation, call `vault.reload()` proactively.

### Backup and restore

Back up BOTH `vault.enc` AND `vault.seen-version` together. Restoring only the vault file (e.g. from Time Machine, or `cp vault.old.enc vault.enc`) without the matching sidecar triggers `VaultRollbackError` on next open. To intentionally restore an older vault, pass `{ acceptRollback: true }` to `openVault` — this updates the sidecar to match and emits a stderr warning.

### CI and cross-machine use

`openVault` is designed for single-operator dev machines. CI and containerized contexts need a KeyProvider other than the default OS keychain — `OnePasswordProvider` (via the `op` CLI) works well. For fully headless environments where no master-key unlock is possible, use a secrets service with remote attestation (HashiCorp Vault, AWS Secrets Manager) instead of `openVault`.

### Session TTL (`ttlMs`)

```typescript
// Short-lived script that should auto-lock after 10 minutes
const vault = await openVault({ ttlMs: 10 * 60 * 1000 });
```

Default: no TTL. Session key stays in memory until `close()` is called. Daemons should not set `ttlMs` — forced re-auth every N minutes undoes the point of a session vault.

## Schema stability

The encrypted payload format (`{ schema: 1, vaultVersion, secrets }`) is stable from v0.6.0. The `schema` field exists so future migrations can detect format without guessing, and the AAD binding (`schema || vault-path`) ensures a v2 payload cannot be substituted into a v1 vault path undetected. Migration to `schema: 2` (if ever needed) will require a read-v1 / write-v2 compat window documented in the package's `CHANGELOG.md`.
