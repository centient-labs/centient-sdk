# @centient/secrets

## 0.6.0

### Minor Changes

- 7316921: Session-vault hardening pass — remediate all 4 Critical, 8 High, and most Medium/Low findings from the PR #41 code review.

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

- 0a61e0a: Add `openVault()` — a public session-backed envelope vault API. Closes #40.

  Long-running daemons (centient-labs/maintainer) that hold N credentials across a long lifetime previously had to choose between:

  - per-item `getCredential()` calls that prompt the OS keychain on every first-read (and silently fail when the keychain auto-locks), or
  - reimplementing session-backed vault logic inline

  `openVault()` exposes the CLI-internal session machinery as a first-class public API: one KeyProvider prompt at startup, subsequent reads hit RAM, external writes (e.g. `centient secrets set` in another shell) become visible via mtime-check coherence.

  ## New public API

  ```typescript
  import { openVault, type SessionVault } from "@centient/secrets";

  const vault = await openVault(); // single Keychain prompt
  const apiKey = await vault.get("anthropic-key"); // RAM hit
  const keys = await vault.list("anthropic."); // RAM hit
  await vault.set("new-key", "some-value"); // atomic write + sidecar
  vault.close(); // release key from RAM
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

### Patch Changes

- 7d9378e: Fix `centient secrets set` silently truncating multi-line values at the first newline. Closes #37.

  ### Symptom

  Pasting a multi-line secret (PEM private key, multi-line config blob) into the interactive hidden prompt stored only the content up to the first `\n` — e.g. a PEM would store just the header line (`BEGIN RSA PRIVATE KEY`) and drop the rest. `secrets get` then returned the truncated 30-char header, breaking any downstream consumer expecting a valid PEM. Blocked the maintainer daemon's credential-migration workflow.

  ### Root cause

  `prompt()` in `src/cli/secrets-cli.ts` listened for raw-mode `data` events and resolved on the first `\n` / `\r`. For a terminal paste, the first newline between the header line and the key body terminated input.

  ### Fix

  Two independent paths, both correct now:

  - **Piped / non-TTY stdin** (`cat key.pem | centient secrets set ...`): detect `!process.stdin.isTTY` and read the whole stream to EOF via `for await (const chunk of process.stdin)`. Trim a single trailing newline (pipe artifact); preserve all other whitespace.
  - **Interactive TTY**: enable VT100 bracketed-paste mode (`\x1b[?2004h`). Content wrapped in `\x1b[200~ ... \x1b[201~` is treated atomically — newlines inside a paste are literal content, not submit signals. Single typed `\n` still submits (preserves password UX). `Ctrl-D` is an explicit end-of-input escape hatch for terminals without bracketed-paste support.

  ### Testing

  Extracted the parsing state machine into `src/cli/hidden-input.ts` as a pure function so it can be unit-tested without stubbing `process.stdin`. 16 new tests cover:

  - Bracketed paste with embedded newlines preserved (#37 regression)
  - Paste markers split across multiple data chunks
  - Paste delivered one char per chunk (worst-case timing)
  - Ctrl-D multi-line submit
  - Single-line Enter-to-submit (backward-compat)
  - Backspace behavior
  - Unrelated escape sequences (arrow keys, Delete `\x1b[3~`) silently swallowed via CSI terminator detection — no more `~` leaking into input
  - Typed + pasted content interleaved
  - Empty paste, empty input

  ### Supported terminals

  Bracketed paste is supported by iTerm2, kitty, Alacritty, foot, WezTerm, xterm, GNOME Terminal, and VS Code's integrated terminal. On terminals without bracketed-paste support, Ctrl-D is the multi-line escape hatch.

## 0.5.0

### Minor Changes

- f473113: Relax `isValidKey` to permit `.` as a namespace separator in credential key names. The validation regex is now `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/` — lowercase alphanumeric plus hyphen and dot, first and last character alphanumeric, up to 64 characters.

  Both conventions work now — pick whichever reads best:

  ```ts
  await storeCredential("soma-anthropic-token1", value); // hyphen-delimited
  await storeCredential("soma.anthropic.token1", value); // dot-delimited
  ```

  Strictly additive — every key that validated under the previous `[a-z0-9-]` regex still validates. Underscores, uppercase, whitespace, and shell metacharacters remain rejected so keys can be safely interpolated into subprocess argv positions without additional escaping.

  Motivation: the natural namespace shape for pooled Anthropic credentials is `soma.anthropic.token1`, matching dot-delimited conventions used elsewhere in the soma project. Prior to this change, callers had to pick hyphens to satisfy the vault's stricter-than-necessary validation, even though hyphens and dots are equally safe under the shell-escaping constraint the regex is actually protecting.

- 9512d50: Make `VaultBackend.listKeys` async (`Promise<string[]>`) and replace libsecret's `secret-tool search --all` CLI with a D-Bus client via `dbus-next`.

  **Interface change:** `VaultBackend.listKeys(prefix?)` now returns `Promise<string[]>` instead of `string[]`. This is a compile-time breaking change for any external implementations of `VaultBackend`. No external implementations are known; accepting as a minor bump under 0.x semver per ADR-002 §0.5.0.

  **Security fix (libsecret):** The previous implementation shelled out to `secret-tool search --all`, which emitted every stored credential's decrypted value on stdout alongside the attribute lines we parsed. The new D-Bus path calls `org.freedesktop.secrets.Service.SearchItems`, which returns item object paths without decrypting secret values — secret material never crosses process memory during enumeration.

  **Fallback:** If the D-Bus session bus is unavailable (e.g. SSH without `DBUS_SESSION_BUS_ADDRESS`, headless server), the libsecret backend falls back to the `secret-tool` CLI parser automatically. The fallback carries the same transient-exposure trade-off as before; the JSDoc documents this.

  **Other backends:** Keychain, Windows Credential Manager, GPG file vault, and EnvVault simply mark their `listKeys` as `async` — the underlying sync work is unchanged, auto-wrapped in a resolved promise.

  **New runtime dependency:** `dbus-next@^0.10.2` (pure JavaScript, no native bindings). This is the first runtime dependency on `@centient/secrets`. It is dynamically imported inside `listKeysViaDbus` so it is only loaded on Linux when the libsecret backend is active and D-Bus is available.

- e90d11b: Add in-process TTL cache for macOS Keychain enumeration and `--json` output flag for `list-backend-keys` CLI subcommand.

  **Keychain cache:** `listAccountsInKeychain` now caches results for 5 seconds, keyed by `{service, prefix}`. Repeated `listCredentials` calls within the TTL window return cached results without re-spawning `security dump-keychain`. The cache is automatically invalidated when `storeStringInKeychain` or `deleteFromKeychain` is called, so stale reads after a write are not possible.

  **`--json` CLI flag:** `centient secrets list-backend-keys --json` outputs a sorted JSON array of key strings instead of the human-readable formatted list. On enumeration failure, outputs `{"error": "..."}` instead of the emoji-prefixed stderr message. Designed for scripting — e.g. `centient secrets list-backend-keys --prefix soma.anthropic. --json | jq '.[]'`.

- ab27f5d: Introduce the `SecretsPolicy` middleware layer and ship `auditTrail` as the first built-in policy.

  **New API surface:**

  - `SecretsPolicy` interface — `{ name, before?(op), after?(event) }`. Policies are cross-cutting concerns (audit, rate limiting, access control) applied to every credential operation. `before` hooks run top-to-bottom before the backend operation (can reject by throwing); `after` hooks run bottom-to-top with a structured event (exceptions swallowed with one-time stderr warning).
  - `setSecretsPolicies(policies: SecretsPolicy[])` — configure the active policy stack. Default: empty (no policies, zero overhead). Names and shapes are designed to fit the 1.0 `createSecretsClient({ policies })` factory without renaming.
  - `getActivePolicies()` — read the current policy list (useful for diagnostics).
  - `auditTrail({ sink, includeReads? })` — factory for an audit-only policy that forwards `SecretsEvent` objects to a caller-provided sink function. `includeReads` defaults to `true`; set to `false` to suppress `credential_read` and `credential_read_missing` events in hot-path scenarios.

  **Event shape (`SecretsEvent`):**

  - `type` — one of 9 event types: `credential_read`, `credential_read_missing`, `credential_read_failed`, `credential_written`, `credential_write_failed`, `credential_deleted`, `credential_delete_failed`, `credential_enumerated`, `credential_enumerate_failed`.
  - `timestamp` — ISO-8601 string.
  - `backend` — which vault backend handled the operation.
  - `key` / `prefix` / `keyCount` — operation-specific context.
  - `error` — error message on `*_failed` events (never stack trace).
  - `durationMs` — wall-clock time of the operation.

  **Integration:** all four public functions (`storeCredential`, `getCredential`, `deleteCredential`, `listCredentials`) now run through the policy stack. No changes to their signatures or return types — existing consumers are unaffected.

  **Designed for growth:** the `SecretsPolicy` interface, `setSecretsPolicies` array, and `SecretsOperation` descriptor are the same shapes that ADR-002's 1.0 `createSecretsClient({ provider, policies })` factory will use. The 0.5.0 global setter is a stepping stone, not a dead end.

  Motivation: per ADR-002, regulated consumers (SOC 2 target) need an auditable trail of credential operations. This is the first middleware seam in `@centient/secrets`, enabling audit now and rate limiting / access control / attestation in 1.0.

## 0.4.0

### Minor Changes

- 48d155e: Add `listCredentials(prefix?)` API and a new `list-backend-keys` CLI subcommand for enumerating keys on the backend-abstracted credential path (keychain, libsecret, Windows Credential Manager, GPG file vault, env-var).

  New `VaultBackend.listKeys(prefix?)` synchronous method backs the public API; all built-in backends implement enumeration. Backends that cannot efficiently enumerate return `[]`. Transient enumeration failures (keychain access denied, libsecret timeout, filesystem permission errors) propagate so the caller can retry or surface the problem.

  The new `list-backend-keys` CLI subcommand is distinct from the existing `list` command: `list` reads the encrypted file vault at `~/.centient/secrets/vault.enc`, while `list-backend-keys` reads whatever backend `storeCredential` / `getCredential` is writing to. The two storage paths remain separate in this release; reconciliation is a future concern.

  Motivation: soma orchestration needs to enumerate pooled Anthropic credentials stored under a shared key prefix to enable round-robin rotation across multiple Claude Pro/Max OAuth tokens or API keys. Prior to this change, enumeration required hardcoding known key names, which broke multi-credential management.

  Purely additive for consumers of the public API — no existing consumers of `storeCredential` / `getCredential` / `deleteCredential` need to change.

  Note for anyone who implements `VaultBackend` externally: the interface now requires a `listKeys(prefix?)` method. This is a compile-time breaking change under strict TypeScript, but no external implementations are known at the time of this release.

## 0.3.0

### Minor Changes

- Add KeyProvider abstraction for pluggable vault key storage. New `OnePasswordProvider` enables headless/remote unlock via `op` CLI and service account tokens. Existing macOS Keychain behavior unchanged (auto-detected when no config present). New `centient secrets migrate <provider>` command for switching between providers.

## 0.2.0

### Minor Changes

- Initial release — cross-platform secrets vault with AES-256-GCM encryption and platform-native key storage
