# Threat model — `@centient/secrets`

**Covers:** `@centient/secrets` **0.9.0** (the version in `packages/secrets/package.json` at the
time of writing).
**Status:** current-state record. Every "defends against" claim below names the file and symbol that
implements it; every claim that could not be grounded in code is stated as undefended or unverified
rather than assumed.
**Supersedes as the reference point:** [ADR-002 §Threat model](adr/002-secrets-long-term-architecture.md#threat-model),
which said *"The full threat model will live in `docs/threat-model.md` starting in 1.0 … This ADR is
the reference point until that doc exists."* This is that doc. ADR-002's own section is retained as
the architectural roadmap; where the two differ, **this doc describes the code and ADR-002 describes
the intent** — the divergences are enumerated in [§8](#8-where-adr-002-and-the-code-diverge).

---

## How to read this document

Per **P11 (Honest Uncertainty)**, the "does NOT defend against" list is the primary content of this
document, not a footnote to it. It appears at the same heading level, at comparable length, before
the roadmap. A reader who stops after [§4](#4-what-this-library-does-not-defend-against) has read the
part that matters for a deployment decision.

Three distinctions are load-bearing throughout:

| Distinction | Meaning |
|---|---|
| **Capability vs. default** | A defense a consumer *can* switch on is not a defense the library *has*. Anything mitigable-but-not-mitigated-by-default is listed under **does NOT defend against**, with the opt-in named. |
| **P15 vs. P16** | **P15 (Secure by Default)** governs *posture* — read-only default, credentials provisioned intentionally. **P16 (Authority Outside the Sandbox)** governs *placement* — which side of an isolation boundary the credential lives on. A system can satisfy P15 and still violate P16. Both are assessed separately below. |
| **Verified vs. present** | Code being present is not the same as a property holding at runtime. Properties that have been through adversarial re-audit are marked as such and cite their evidence; properties resting on code-reading alone say so. |

---

## 1. Assets

What an attacker is after, in descending order of value:

1. **The vault master key** — the 32-byte AES-256-GCM key. Held in the OS Keychain
   (`crypto/vault-common.ts`), in a 1Password item (`key-providers/onepassword-provider.ts`), or
   derived on demand from an operator passphrase (`key-providers/passphrase-provider.ts` —
   never persisted). Compromising it compromises every credential in the vault at once.
2. **Credential values** — the plaintext secrets stored under the vault
   (`vault/vault.ts`, `vault/session-vault.ts`).
3. **The credential name space** — `listCredentials()` / `SessionVault.list()`. Names alone leak
   which systems a host talks to.
4. **Vault integrity and freshness** — the ability to substitute an old or forged vault file.
   Guarded by the AEAD tag plus the monotonic-version + sidecar scheme (`vault/session-vault.ts`,
   `vault/sidecar.ts`).
5. **The audit record** — where a consumer has installed one (`vault/policy.ts`). Its integrity is
   the concern of **P13 (Auditability)**; see [§4.6](#46-audit-tamper-evidence-p13).

---

## 2. Trust boundaries (P16)

The library draws exactly **two** boundaries it can enforce, and depends on a third it cannot.

### B1 — Process boundary (enforced by the OS)

Everything inside the Node process that opens the vault is one trust domain. The master key lives
here as a `Buffer` for the whole unlock window; credential values live here as immutable JS
`string`s. **The library has no intra-process boundary**: any code that can `import
"@centient/secrets"` — first-party, transitive dependency, or injected — can call `getCredential()`
and read anything the vault holds. There is no per-caller access control in 0.9.0 (`vault/policy.ts`
ships the seam, and an `auditTrail` policy, but no `accessControl` policy).

### B2 — Key-store boundary (enforced by the OS / 1Password / the operator's memory)

The master key at rest sits on the far side of a store the library does not control: the macOS
Keychain ACL, the Windows Credential Manager, GNOME libsecret, a GPG private key, a 1Password
account, or — for `PassphraseProvider` — nothing at rest at all, only the operator's memory plus a
non-secret KDF sidecar. **This boundary is the library's principal defense.** It is only as strong
as the store: a Keychain item whose ACL admits every process on the machine is not a boundary.

### B3 — Sandbox boundary (NOT enforced, and NOT enforceable here)

**This library must run on the protected side of any untrusted-code boundary. It cannot create that
boundary.** ADR-001 Amendment 1 states this for the passphrase provider and it generalizes to all
three providers:

> the key is derived **inside the same process** that opens the vault and is held in the Node heap
> as a `Buffer` for the unlock window — identical residence to the Keychain- and 1Password-retrieved
> keys. … this provider is for a **protected trust domain that does not execute untrusted input**
> … It is *not* suitable for a sandbox that runs PR-/agent-authored code or LLM-driven tool calls.
> — [ADR-001 §Authority placement (P16)](adr/001-key-provider-abstraction.md#authority-placement-p16)

**P16 litmus test, applied:** does the vault-opening process execute untrusted input — agent-authored
code, LLM output that can trigger tools, deserialized artifacts, template expansion? If yes, the
credential is on the wrong side of the boundary, and **no option in this library moves it back**.
Sandbox isolation protects the host *from* the untrusted code; it does not protect a co-resident
master key *from* it.

The one partial control the library offers here is `isAgentEnvironment()`
(`platform/agent-detect.ts`) — see [§4.4](#44-the-agent-block-is-a-cli-guardrail-not-a-boundary) for
what it is and is not.

---

## 3. What this library defends against

Each item names the implementing code. Absent a citation, a claim does not belong on this list.

### 3.1 Credentials at rest on the filesystem

Vault contents are AES-256-GCM (`crypto/vault-common.ts`: `ALGORITHM`, `IV_LENGTH`,
`AUTH_TAG_LENGTH`, `KEY_LENGTH`). An attacker who copies `vault.enc` without the master key gets
ciphertext. The session vault additionally binds **AAD** over the schema version and the vault's
resolved real path (`vault/session-vault.ts`: `VAULT_AAD_PREFIX`, `deriveAad`), so a payload lifted
from one vault file cannot be substituted into another, and a v2 payload cannot be replayed as v1.

### 3.2 Vault rollback (live-session and cold-start)

An attacker with *write-only* access to the vault directory cannot silently restore an older vault to
resurrect a revoked credential. Two layers (`vault/session-vault.ts`, `vault/sidecar.ts`):

- an in-payload monotonic `vaultVersion`, bound by the AEAD tag — forging a lower one requires the key;
- a `vault.seen-version` sidecar (mode `0600`) holding the highest version ever observed, which
  persists across sessions and so catches a cold-start `cp vault.old.enc vault.enc` or a partial
  backup restore.

Rollback detection is **on by default and cannot be disabled globally** — accepting a detected
rollback requires an explicit per-call `acceptRollback: true` and emits a loud stderr warning
(`VaultRollbackError`, `OpenVaultOptions.acceptRollback`). `rekeyVault()` enforces the same refusals,
so a rekey cannot launder a rolled-back vault past later checks.

### 3.3 Credentials in source code and process environment

Storing credentials in a vault rather than in `.env` files or committed config removes the accidental-
commit path. This is a design consequence, not a runtime check — the library cannot stop a consumer
from also writing the value somewhere else.

### 3.4 Shell metacharacter injection via credential names

`isValidKey()` (`vault/vault-utils.ts`) constrains key names to
`/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/`, max 64 chars — no underscores, uppercase, whitespace, quotes,
`$`, or other shell metacharacters. Since #168 the grammar is enforced once at the cascade
(`vault/vault.ts`) and again at each backend, so a non-conforming name is rejected before any
subprocess is built.

**The invocation style is mixed, and the guarantee differs by backend.** Do not rely on a
package-wide no-shell invariant; it does not exist.

| Path | Invocation | What prevents name injection |
|---|---|---|
| macOS Keychain (`crypto/vault-common.ts`) | `execFileSync`, argv array, no shell | Argv separation — structural |
| GPG file backend (`vault/vault-gpg.ts`) | `execFileSync`, argv array, no shell | Argv separation — structural |
| 1Password (`key-providers/op-cli.ts`, `onepassword-provider.ts`) | `execFileSync`, argv array, no shell | Argv separation — structural |
| **libsecret (`vault/vault-libsecret.ts`)** | **`execSync` with an interpolated shell command string** | **The key grammar alone** |
| Platform probes (`platform/platform.ts`) | `execSync("which open")` / `("which xdg-open")` | Constant strings, no user input |

On the libsecret path the key is interpolated directly into the command —
`secret-tool store --label "…" service … key "${key}"` (lines 72, 95, 118, 270) — so **the grammar
is the sole barrier there, not defense in depth**. It is sufficient today only because the grammar
excludes every character that could break out of the surrounding double quotes (`"`, `$`, `` ` ``,
`\`, `;`, whitespace). That coupling is load-bearing and undocumented in the code: any future
loosening of `isValidKey` — permitting `$`, a quote, or a backslash — becomes a **command-injection
vulnerability on Linux**, not merely a naming-convention change.

The `LABEL` and `SERVICE_ATTR` operands in those strings are module constants, not caller input.
Credential *values* are never interpolated on any path: libsecret passes the value on **stdin**
(`input: value`), as does the 1Password credential backend.

**Recommended hardening (not done here — docs-only PR):** convert `vault-libsecret.ts` to
`execFileSync` with an argv array, matching the other three backends, which would make argv
separation structural everywhere and demote the grammar to genuine defense in depth.

### 3.5 Silent backend substitution

An explicitly selected backend **fails closed rather than falling through**
(`vault/vault.ts` `initVaultBackend`, ADR-004 §1): if config or `CENTIENT_SECRETS_BACKEND` names
1Password and `op` is missing or unauthenticated, the call throws instead of quietly storing the
credential in the Keychain. 1Password is **never auto-selected** — `op` being installed on the box is
not consent to route credentials into it.

### 3.6 Non-interactive unlock of a passphrase vault

`promptHiddenSync()` (`cli/hidden-prompt.ts:80-81`) throws `HiddenPromptError` when
`stdin.isTTY !== true`. There is no environment variable, no flag, and no fallback that turns a
passphrase unlock into a headless one. A CI runner or an agent subprocess cannot unlock a
passphrase-backed vault at all.

### 3.7 Wrong-passphrase corruption

The passphrase metadata sidecar stores an HMAC-SHA256 verifier (not the key), compared with
`timingSafeEqual`, so a wrong passphrase fails with `PASSPHRASE_VERIFICATION_FAILED` rather than
producing a garbage key that corrupts the vault on the next write
(`key-providers/passphrase-provider.ts`).

### 3.8 Unbounded hidden input and terminal-state loss on signal

Both properties from ADR-001 Amendment 1; see [§6](#6-adr-001-amendment-1-properties-in-this-model)
for their verification status and residual caveats.

### 3.9 Concurrent-writer corruption

`set`/`delete` on the session vault take an advisory `O_EXCL` lock on `{vaultPath}.lock`
(`vault/file-lock.ts`), with 30 s stale-lock stealing. This is an integrity control against
concurrent *cooperating* writers — it is not a security control and an adversarial writer simply
ignores it.

### 3.10 Permissive-mode detection

`checkVaultPerms()` (`vault/session-vault.ts`) and the sidecar reader warn on stderr when the vault
or sidecar file is group- or world-accessible. **This warns; it does not refuse.** It is a
detection control, not a preventive one.

---

## 4. What this library does NOT defend against

This is the operative section. Everything here is a live gap in 0.9.0.

### 4.1 The shared `centient-vault` master-key item is still the default (issue #80)

**Issue [#80](https://github.com/centient-labs/centient-sdk/issues/80) is closed as completed, and the
exposure it names is still present on the default path.** Both halves of that sentence are true and
neither alone is accurate.

What shipped is an **opt-in** per-consumer key. `ResolveKeyProviderOptions.keychain`
(`key-providers/resolve.ts:35-47`) and `OpenVaultOptions.keychain` (`vault/session-vault.ts`) let a
consumer name its own Keychain item, and `openVault({ keyProvider })` lets it supply a provider
outright. The code says exactly what it preserved:

> Omitted/undefined fields fall back to the historical defaults, so the no-options path is
> byte-identical to before. — `key-providers/resolve.ts:41-44`

`DEFAULT_KEYCHAIN_SERVICE = "centient-vault"` and `DEFAULT_KEYCHAIN_ACCOUNT = "vault-key"` remain the
defaults (`key-providers/keychain-provider.ts:27-28`).

**Therefore: mitigable, but not mitigated by default.** Every consumer on a machine that calls
`openVault()` with no `keychain` or `keyProvider` option still shares **one** master-key item. Any
process that can read that item unlocks *every* such consumer's vault — the blast radius is the
machine, not the application. This is a **P16 placement failure that P15 does not catch**: the key is
provisioned intentionally (P15 satisfied) into a domain shared with every other consumer, including
ones with a weaker trust posture (P16 violated).

**Consumer action:** pass `keychain: { service: "<your-app>-vault" }` to `openVault()`, or inject a
`keyProvider`. Documented in `packages/secrets/README.md` §Per-consumer vault keys. Until a consumer
does this, treat its vault as compromised by the compromise of any other consumer on the same host.

### 4.2 Positive human auth is not a global unlock requirement (issue #11)

**Issue [#11](https://github.com/centient-labs/centient-sdk/issues/11) is closed as completed. What
shipped is human auth on specific paths, not an unlock-wide requirement.** Precisely:

| Path | Positive human auth? | Mechanism |
|---|---|---|
| `PassphraseProvider` unlock | **Yes — proof of knowledge, and fails closed without a TTY** | `key-providers/passphrase-provider.ts` (scrypt, `N=2^17, r=8, p=1`) behind `cli/hidden-prompt.ts`, which throws on non-TTY |
| macOS `KeychainProvider` unlock | **Delegated to the OS, not enforced here** | `security find-generic-password` (`crypto/vault-common.ts`). Whether Touch ID or a password is demanded is a Keychain ACL property of the item, set outside this library. An already-unlocked login keychain prompts for nothing. |
| `OnePasswordProvider` unlock | **No, when a service account is in use** | `OP_SERVICE_ACCOUNT_TOKEN` is explicitly a headless mode (ADR-001 Amendment 1 provider table) |
| `getCredential()` / `SessionVault.get()` after unlock | **No** | Once the vault is open, reads are unauthenticated for the life of the session |
| Env-var backend (`EnvVault`) | **No** | Last-resort fallback, always detects true (`vault/vault-env.ts`) |

Two further limits, both from `packages/secrets/README.md` §Passphrase provider and confirmed in code:

- **A typed passphrase proves knowledge, not presence.** It cannot satisfy a policy requiring fresh
  per-operation human auth. Nothing in the library re-prompts per credential read.
- **The passphrase is the security ceiling on that path.** A Keychain key is a random 256-bit value;
  a passphrase-derived key is worth its passphrase. An attacker holding `vault.passphrase.json` or
  the vault file can guess offline at roughly one candidate per 128 MB scrypt derivation.

### 4.3 The master key transits argv on two write paths

Two key-*write* paths put the hex-encoded master key in a subprocess argv, where it is visible in
`ps` to any local user for the duration of the call:

- **macOS Keychain store** — `security add-generic-password … -w <keyHex>`
  (`crypto/vault-common.ts` `storeKeyInKeychain`).
- **1Password key provider** — `createItem`/`updateItem` pass `password=<hex>` in argv. The code
  documents this as a known gap and names the fix and its ticket
  (`key-providers/onepassword-provider.ts:18-23`, issue #102): `runOp`'s `input` option is the
  argv-safe seam, and `OnePasswordVault.store` (the credential-*value* backend) already uses it.

**Not in ADR-002's list.** The window is short and requires a local attacker polling `ps` at the
moment of a key write or rotation, but it is a real plaintext-master-key exposure and it is not
mitigated today.

### 4.4 The agent block is a CLI guardrail, not a boundary

`isAgentEnvironment()` (`platform/agent-detect.ts`) tests six environment variables
(`CLAUDE_PROJECT_DIR`, `MCP_CONTEXT`, `CLAUDE_CODE_SESSION`, `CLAUDE_CODE_ENTRY_POINT`,
`ANTHROPIC_API_KEY_SOURCE`, `MCP_SERVER_NAME`). It gates:

- the entire `centient secrets` CLI (`cli/secrets-cli.ts` `runSecrets`), and
- environment switching / mutation in `environment/EnvironmentManager.ts`.

It does **not** gate the programmatic API. `getCredential()`, `storeCredential()`, `openVault()`, and
`SessionVault.get()` contain no agent check — verified by grep across `packages/secrets/src`: the
only call sites are `index.ts` (re-export), `EnvironmentManager.ts`, and `secrets-cli.ts`. (The
docstring on `agent-detect.ts` claims it is "Shared by: vault.ts, cli, secrets-cli.ts"; `vault.ts`
does not use it. The comment is stale.)

It is also **trivially defeated**: it reads environment variables the agent process controls. `env -u
CLAUDE_PROJECT_DIR …` clears it. Treat it as a **guardrail against accidental agent use of the
operator CLI**, never as an enforcement boundary. Per **B3**, the real control is not running the
vault-opening process inside a domain that executes untrusted input.

### 4.5 Anything with code execution in the consuming process

Unchanged from ADR-002 and still the dominant risk. A malicious transitive dependency, an RCE, or a
`--require`-injected module can call `getCredential()` and exfiltrate every value. There is no
per-caller `accessControl` policy, no rate limit on reads, and no per-key ACL in 0.9.0 — the
`SecretsPolicy` seam exists (`vault/policy.ts`) but the only built-in policy shipped is `auditTrail`.

### 4.6 Audit tamper-evidence (P13)

**P13 (Auditability) is partially served, and its integrity half is not served at all.**

What exists: a live policy pipeline. `runBeforeHooks`/`runAfterHooks` are wired into every credential
operation in both `vault/vault.ts` (write/read/delete/enumerate) and `vault/session-vault.ts`, with
14 event types including `*_rejected` variants so a policy-denied operation is still recorded rather
than vanishing. A built-in `auditTrail(opts)` policy formats events to a caller-supplied sink.

What does not exist:

- **No audit by default.** `activePolicies` starts empty (`vault/policy.ts`). Unless the consumer
  calls `setSecretsPolicies([...])`, **nothing is recorded**. ADR-002's "there are no audit logs" is
  stale, but "audit logs are on" would be wrong too.
- **No tamper-evidence.** There is no HMAC chaining, no `previous_hash`, no `sequence_number`. An
  attacker who can write to the sink can insert, delete, or reorder events undetectably. The chained
  scheme is a **2.0.0 target** in ADR-002, not shipped.
- **Audit failure is silent by design.** `after`-hook exceptions are swallowed with a *one-time*
  stderr warning, on the stated principle that audit-infrastructure failure must never break a
  credential operation (`runAfterHooksForRange`). An attacker who breaks the sink silences the audit
  and the operation proceeds. This is a deliberate availability-over-auditability tradeoff; a
  consumer with the opposite requirement must detect sink failure out of band.
- **The sink is the consumer's.** File permissions, rotation, retention, and remote shipping are all
  outside this library.

### 4.7 Memory disclosure

Credential values are immutable JS `string`s and the master key is a `Buffer` living in the Node heap
for the whole session. Core dumps, `--inspect` heap access, and live debugger sessions all recover
them. `close()` calls `Buffer.fill(0)` on the key, which is **best-effort only** — any copy that
transited a string (an accidental `String(buf)`, `util.inspect`, `console.log`) lingers until GC. The
typed passphrase is likewise an immutable string that cannot be zeroed; only the transient `readSync`
byte buffer is wiped (`cli/hidden-prompt.ts`). Operator mitigations (`ulimit -c 0`; never run a
vault-holding daemon with `NODE_OPTIONS=--inspect`) are in
`packages/secrets/docs/session-vault.md` §Threat model.

### 4.8 A privileged local attacker

Root, or the operator's own uid with a debugger, reads the Keychain, decrypts the GPG vault, attaches
to the process, or downgrades vault **and** sidecar in lockstep (they sit in the same directory by
default). If adversarial writes to `~/.centient/secrets/` are in your threat model, this library is
not the right tool — use a service with remote attestation.

### 4.9 The env-var fallback backend stores nothing securely

`EnvVault` (`vault/vault-env.ts`) is the last cascade entry and its `detect()` **always returns
true**, so a host with no Keychain, no Credential Manager, no libsecret, and no GPG lands here
silently. It surfaces `ENGRAM_API_KEY` as the `auth-token` credential, refuses all writes, and offers
no encryption at all — the credential is a process environment variable, readable from
`/proc/<pid>/environ` and inherited by every child process. Check `getActiveVaultType()` at startup
and refuse to run if it returns `"env"` where you expected a real store.

### 4.10 Name-space disclosure

`listCredentials()` / `SessionVault.list()` are unauthenticated for anyone inside B1, and key names
are not encrypted in the 1Password backend's names-only list cache. Name your keys assuming they leak.

---

## 5. Explicitly out of scope

These are not gaps; they are deliberate non-goals. ADR-002 §Non-goals is authoritative — summarized
here so a reader of this document alone does not mistake them for oversights.

- **Network attackers.** There is no remote backend in 0.9.0; the network is not a surface only
  because it is unused. (The 1Password backend shells to a local `op` binary; `op`'s own network
  posture is 1Password's.)
- **Supply-chain compromise of Node itself or of trusted dependencies.**
- **Social engineering of an operator with legitimate access.** A passphrase prompt is a
  proof-of-knowledge check; it does not resist a coerced or deceived operator.
- **Consumer misuse** — reading a credential and logging it, forwarding it, or storing a copy.
- **Side-channel attacks** (timing, power, cache) on the underlying crypto — the concern of Node's
  OpenSSL and the host hardware.
- **Hardware-root-of-trust compromise** — HSM attack, Secure Enclave exploit, TPM bypass. Relevant
  only from 2.0.0, when hardware backends exist at all.
- **Key management as a service** — creation, rotation schedules, distribution, revocation. The
  library re-encrypts under a new key (`rekeyVault()`); it does not decide when that should happen.
- **Secret synchronization across machines**, **policy as a DSL**, **FIPS certification of this
  module**, and **a general-purpose crypto toolkit** — all ADR-002 non-goals.

---

## 6. ADR-001 Amendment 1 properties in this model

Two security properties from commit `895b88d` are named in
[ADR-001 Amendment 1](adr/001-key-provider-abstraction.md#security-relevant-properties--re-audited-2026-06-23).
Their status **changed after this document's tracking ticket was written**: the amendment records
them as re-audited on **2026-06-23** through a scoped adversarial `cl-adr-audit` (audit → refutation),
with **both surviving refutation and verified at runtime, not merely test-exercised**. They are
recorded here at that status, with the caveats that survive alongside them.

1. **64 KiB hidden-input cap — VERIFIED (2026-06-23).** `MAX_HIDDEN_INPUT_LENGTH = 65_536`
   (`cli/hidden-prompt.ts:52`) bounds accumulated hidden input; the check sits *inside* the read loop
   (`:143-148`), not behind an earlier return, so a hostile or broken input source feeding endless
   bytes with no submit throws `HiddenPromptError` and drops the reference rather than growing the
   buffer without bound. Evidence: `tests/hidden-prompt.test.ts` feeds `cap + 512` bytes and asserts
   both the throw and the terminal restore, and separately accepts exactly the cap.
   **Residual caveat, unchanged:** the accumulated input is an immutable JS string and cannot be
   zeroed; it lingers until GC. Only the transient `readSync` byte buffer is wiped
   (`cli/hidden-prompt.ts:152`).
2. **Deferred-one-tick signal handling — VERIFIED at runtime (2026-06-23).** The prompt is
   synchronous, so a `SIGINT`/`SIGTERM`/`SIGHUP` arriving while `readSync` blocks is queued by libuv
   and dispatched only after the prompt unwinds. Listeners installed via `process.once` suppress the
   immediate default kill — which would strand the terminal in raw mode with echo off — and their
   removal is deferred one tick via `setImmediate` so the queued dispatch is not *dropped*
   (`cli/hidden-prompt.ts:114-160`). Evidence: a real child-process test in
   `tests/hidden-prompt.test.ts` confirms `child.exitCode === null` while the prompt blocks, the
   prompt returning its value, and a queued `SIGTERM` then re-raised to its default disposition with
   no `SIGNAL_SWALLOWED`.

**Placement (P16) — the amendment's own framing, carried forward.** The passphrase-derived key lives
process-internal, in the Node heap, for the unlock window — identical residence to the Keychain- and
1Password-retrieved keys. The interactive-TTY requirement is *incidentally* aligned with the correct
placement (untrusted sandbox code has no human at a keyboard), but it is **not** the mechanism that
enforces it. See [B3](#b3--sandbox-boundary-not-enforced-and-not-enforceable-here).

---

## 7. Evolution across releases

Mirrors [ADR-002 §Threat model](adr/002-secrets-long-term-architecture.md#threat-model). Only the
"current" column is a statement about code; the rest are commitments in the ADR and may move.

| Threat | 0.9.0 (current) | 1.0.0 (target) | 2.0.0 (target) |
|---|---|---|---|
| Filesystem read of vault at rest | **Defended** (AES-256-GCM + AAD) | unchanged | unchanged |
| Vault rollback / stale restore | **Defended** (version + sidecar) | unchanged | unchanged |
| Silent backend substitution | **Defended** (explicit selection fails closed) | unchanged | unchanged |
| Non-interactive passphrase unlock | **Defended** (fails closed on non-TTY) | unchanged | unchanged |
| Shared master-key item across consumers | **NOT defended by default** (opt-in only, §4.1) | per-consumer key as the default is the natural close-out; **not currently committed in ADR-002** | — |
| Master key in argv on key write | **NOT defended** (§4.3, issue #102) | argv-safe stdin path | — |
| Shell injection via credential name | **Defended, but structurally only on 3 of 4 backends** (§3.4) — libsecret interpolates into a shell string and relies on the key grammar alone | convert libsecret to `execFileSync` so argv separation is structural everywhere | — |
| Audit recorded at all | **Opt-in** (`setSecretsPolicies`) | SOC 2 Type II is ADR-002's 1.0 target | unchanged |
| Audit tamper-evidence | **NOT defended** (§4.6) | — | HMAC-chained `previous_hash` + `sequence_number` |
| Insider / in-process code execution | **NOT defended** (§4.5) | policy seam matures | `accessControl` per-key/caller/operation ACLs |
| Bulk exfiltration rate | **NOT defended** | — | `rateLimit` policy |
| Memory dumps / heap snapshots | **NOT defended** (§4.7) | — | handle-based API; raw material never enters the heap for hardware providers |
| Loss of hardware custody | **NOT defended** (no hardware backend) | — | PKCS#11 / Secure Enclave / TPM |
| Hardware root-of-trust compromise | out of scope | out of scope | out of scope |
| Social engineering, supply chain, side channels, consumer misuse | out of scope | out of scope | out of scope |

---

## 8. Where ADR-002 and the code diverge

ADR-002's threat-model section is labeled **"0.4.0 threat model (current)"**. The shipped package is
**0.9.0**. Five differences matter to a reader who arrives via the ADR:

1. **Version label is stale.** "0.4.0 (current)" describes a state five minor versions back.
2. **"Tampering with audit logs: there are no audit logs" is no longer accurate.** A live policy
   pipeline with 14 event types and a built-in `auditTrail` policy ships in `vault/policy.ts`, wired
   into both vault implementations. The *tamper-evidence* claim still holds — there is no chaining —
   but the "no audit logs at all" framing understates what exists and overstates what is missing.
   See §4.6 for the accurate split.
3. **The backend count changed.** ADR-002 §"Where we are today" says five backends; 1Password was
   added by ADR-004, making six, with explicit opt-in selection that fails closed.
4. **The session vault did not exist in the 0.4.0 model.** Envelope encryption, AAD path-binding,
   monotonic-version rollback protection, the sidecar, and `rekeyVault()` are all defenses ADR-002's
   current-state list does not mention. `packages/secrets/docs/session-vault.md` §Threat model is the
   detailed record for that subsystem and remains accurate.
5. **Two current-state weaknesses are absent from ADR-002's list**: the argv master-key exposure
   (§4.3) and the shared-default Keychain item (§4.1).

Where this document and ADR-002 conflict, **this document describes the code**. ADR-002 remains
authoritative for the 1.0.0/2.0.0 targets and for the non-goals.

---

## 9. Deployment checklist

Derived entirely from the sections above; each line names what it addresses.

- [ ] **Pass `keychain: { service: "<your-app>-vault" }` or inject a `keyProvider`** — otherwise you
      share one master key with every other `@centient/secrets` consumer on the host (§4.1).
- [ ] **Assert `getActiveVaultType() !== "env"` at startup** if you expected a real store (§4.9).
- [ ] **Install a policy** via `setSecretsPolicies([auditTrail({ sink })])` — there is no audit
      otherwise — and monitor the sink out of band, since hook failures are swallowed (§4.6).
- [ ] **Do not open the vault in a process that executes untrusted input** — agent-authored code,
      LLM-driven tool calls, deserialized artifacts. No option in this library makes that safe (B3,
      §4.4).
- [ ] **`ulimit -c 0`; never `NODE_OPTIONS=--inspect`** on a vault-holding daemon (§4.7).
- [ ] **Confirm the Keychain item's ACL** — the OS boundary is only as strong as the ACL, and
      positive human auth on that path is the OS's decision, not this library's (§4.2, B2).
- [ ] **If using the passphrase provider**, use a long high-entropy passphrase and protect
      `vault.passphrase.json` — it enables offline guessing if exfiltrated (§4.2).
- [ ] **`chmod 600`** the vault and sidecar; the library warns but does not refuse (§3.10).
- [ ] **Rotate off any key written while an attacker could have been polling `ps`** (§4.3).

---

## References

- [ADR-001 — Key provider abstraction](adr/001-key-provider-abstraction.md), incl. Amendment 1
- [ADR-002 — Secrets long-term architecture](adr/002-secrets-long-term-architecture.md) §Threat model
- [ADR-004 — 1Password credential backend](adr/004-1password-credential-backend.md)
- [`packages/secrets/README.md`](../packages/secrets/README.md)
- [`packages/secrets/docs/session-vault.md`](../packages/secrets/docs/session-vault.md) §Threat model
- [`.agent/DESIGN-PHILOSOPHY.md`](../.agent/DESIGN-PHILOSOPHY.md) — P11, P13, P15, P16
- Issues: [#11](https://github.com/centient-labs/centient-sdk/issues/11) (positive human auth),
  [#80](https://github.com/centient-labs/centient-sdk/issues/80) (shared Keychain item),
  [#102](https://github.com/centient-labs/centient-sdk/issues/102) (1Password argv exposure)
