---
"@centient/secrets": minor
---

Session-vault hardening pass — remediate all 4 Critical, 8 High, and most Medium/Low findings from the PR #41 code review.

### 🔴 Critical

- **CLI migrated to `openVault`.** `packages/secrets/src/cli/secrets-cli.ts` no longer maintains its own `sessionKey` + `SESSION_TTL` + parallel `encrypt`/`decrypt` (which wrote AAD-less ciphertext). The CLI now opens a single `SessionVault` on unlock and routes every `get`/`set`/`list`/`delete` through it. Existing CLI-written vaults (AAD-less) continue to work via the new legacy-upgrade path (below) and are transparently upgraded to AAD-bound schema-1 format on first write. Fixes the cross-API corruption hazard where a `centient secrets set` and an `openVault().get()` on the same file produced mutually unreadable ciphertext.
- **`acceptMissingSidecar` default flipped from `true` → `false`.** `openVault` now **refuses** to open a vault when the sidecar is absent, throwing `VaultError("VAULT_SIDECAR_MISSING")`. Callers with legitimate first-use contexts (fresh install, post-migration, test fixtures) must explicitly opt in. Restores the "rollback protection is always in effect" invariant against the prior silent-auto-init behaviour. Legacy vault detection implicitly permits sidecar auto-init so the CLI migration path is not bricked.
- **File-lock busy-wait removed.** `acquireWriteLock` in the new `packages/secrets/src/vault/file-lock.ts` is now async and uses `await new Promise(r => setTimeout(r, LOCK_RETRY_INTERVAL_MS))` instead of a 25 ms hot CPU spin. Under write contention the daemon no longer starves its own async workloads.
- **AAD now binds to the resolved real path** (`fs.realpathSync`), not the lexical `path.resolve`. A vault reachable via a symlink or bind mount produces the same AAD regardless of which path the caller passed. ENOENT during open falls back to lexical resolution.

### 🟠 High

- **Legacy AAD-less decrypt path (with auto-upgrade)** added to `openVault`, `maybeReload`, and `reload()`. Pre-openVault CLI vaults (flat `{name: value}` top-level, no AAD) are detected, opened read-only as schema 0, and auto-upgraded to schema 1 with AAD binding on the next successful write. No silent data loss; the legacy entry must be a map of string values or decryption fails closed.
- **`validatePayload` strengthened** to require `Number.isInteger`, `>= 0`, `<= MAX_SAFE_INTEGER` for `schema` and `vaultVersion`, and explicitly reject any unknown schema value.
- **TTL / concurrent-op race fixed.** `withAudit` re-invokes `assertOpen()` after `runBeforeHooks`, and `writeOp` re-invokes it after `acquireWriteLock`. A timer-fired `close()` during an in-flight await now surfaces as `VaultClosedError` rather than a null-dereference TypeError.
- **Missing error codes documented.** `VAULT_NOT_FOUND`, `VAULT_FILE_MISSING`, `VAULT_STALE_SNAPSHOT`, `VAULT_ENCRYPT_FAILED`, `VAULT_SIDECAR_MISSING`, `INVALID_NAME` now appear in the docs error table with preamble explaining these surface as base `VaultError` (match on `error.code`).
- **Test coverage expanded by 12 new tests:** strict coherence VAULT_STALE_SNAPSHOT round-trip, KeyProvider failure (`VaultUnlockError`, two failure modes), lock timeout, stale-lock detection, decrypt error on corrupt vault, SecretsPolicy integration (three scenarios verifying `backend: "session-vault"` flows through), name-length boundary at 256/257, empty vault, reload-after-close, acceptRollback+missing-sidecar, legacy vault migration, auto-upgrade on first write.

### 🟡 Medium

- **Module extraction.** `session-vault.ts` split into three modules: `file-lock.ts` (write-path advisory lock), `sidecar.ts` (sidecar I/O + permission checks + file/dir mode constants), `session-vault-errors.ts` (VaultError hierarchy with `Object.setPrototypeOf` for robust `instanceof`).
- **DRY `withAudit` wrapper** replaces ~100 LOC of audit-scaffolding boilerplate across `get`/`list`/`set`/`delete`.
- **Stale-lock race closed.** Lock files now contain the holder's PID; stealing a stale lock verifies ownership via re-read after unlink+create.
- **Redundant `existsSync` and `chmodSync` removed** from `maybeReload` and the write path.
- **`ttlMs: 50` test converted to fake timers** (was real `setTimeout(80)` — flaky under CI load).

### 🟢 Low

- `VAULT_AAD_PREFIX` exported from the package index.
- `Object.setPrototypeOf(this, new.target.prototype)` in every `VaultError` subclass.
- Magic numbers extracted to constants (`MAX_NAME_LENGTH`, `VAULT_FILE_MODE`, `VAULT_DIR_MODE`, `VAULT_AAD_PREFIX`).
- Name validation rejects Unicode RTL override, line separators, leading/trailing whitespace.
- `readSidecar` distinguishes "missing" from "corrupt" via stderr warning.
- Duplicate `path` import consolidated; all built-in imports use `node:` prefix in new code.
- `close()` inlined — no more split between public method and private `closeInternal`.
- `BuildVaultArgs.mtimeMs` dropped — computed inline from `statSync`.
- JSDoc added to `openVault`, `SessionVault`, `OpenVaultOptions`, `CoherenceStrategy`.
- Docs: error-handling code example with `instanceof` branching; coherence-mode code examples for `strict` and `best-effort`; rotation / backup / CI sections; `ttlMs` example; `getCredential` migration-example signature corrected.

### Deferred

- **Thrown errors vs Result type** (systemic, `patterns/error-handling.md` aspirational across the package). Not a blocker; file an ADR.
- **`process.stderr.write` vs `@centient/logger`** (systemic; the whole secrets package does this). File a follow-up to migrate wholesale.
- **Sync I/O inside async surface** (`fs.readFileSync` etc.). Acceptable for <100 KB vault; file follow-up to migrate to `fs/promises`.

### Tests

174 / 174 secrets tests pass. Full workspace build + lint + test green.
