# ADR-002: Long-Term Architecture for `@centient/secrets` — Provider, Policy, Client

**Status:** Accepted
**Date:** 2026-04-15
**Deciders:** Owen Johnson
**Principles:** P3 (Transparent Evolution), P4 (Observable Architecture), P9 (Composability Over Completeness), P10 (Categorical Symmetry), P13 (Auditability as a First-Class Feature), P15 (Secure by Default)
**Supersedes:** none
**Related:** ADR-001 (Key Provider Abstraction for Headless Vault Unlock)

## Status note

This ADR is a **forward-looking architectural record**, not a retroactive rationalization of shipped code. It captures the target architecture for `@centient/secrets` over the next three releases (0.5.0 → 1.0.0 → 2.0.0) and the migration path to reach it. The current `0.4.0` state is the starting point. Implementation is staged: each release delivers a subset of the architecture, with each subset usable on its own and not requiring future work to be useful.

## Context

### Where we are today (0.4.0)

`@centient/secrets` is a cross-platform credentials vault with five backends (macOS Keychain, GNOME libsecret, Windows Credential Manager, GPG file vault, env-var fallback) selected at module load via a `detect() → backend` cascade. It exposes four public functions — `storeCredential`, `getCredential`, `deleteCredential`, and (as of 0.4.0) `listCredentials` — plus a small operator-facing CLI.

It is actively consumed by the `soma` orchestration package for pooled Claude credential management, and is a runtime dependency of the centient MCP server. Its current design goals are modest: let a developer on a Mac laptop store a handful of auth tokens in the OS keychain without thinking about it, and fall back gracefully on Linux and in CI.

### Where consumers are going

Likely near-term consumers include applications deployed in regulated environments — finance platforms handling payment credentials, government integrations touching controlled data, healthcare systems under HIPAA, and internal services chasing SOC 2 Type II certification. The **immediate priority** is SOC 2, with PCI-DSS, HIPAA, FedRAMP Moderate, FedRAMP High, FIPS 140-2, StateRAMP, and CMMC as longer-horizon targets whose specific requirements should not constrain 0.5.0 but should shape the trajectory.

This is a large shift in what the library needs to be. A regulated consumer does not think of a credentials library as "a way to read a string from the keychain." They think of it as a **trust boundary inside the application** — one that auditors will inspect, security teams will threat-model, and compliance automation will test. The library's API shape, default behavior, observability surface, and supply-chain story all become the consumer's problem.

The five properties a regulated consumer needs from a credentials library — and the current state of each in 0.4.0:

| Property | What it means | 0.4.0 status |
|---|---|---|
| **Auditability** | Every credential operation produces a tamper-evident record an auditor can reconstruct months later | ❌ No events emitted; no audit writer wired |
| **Policy enforcement** | Access control, rate limiting, attestation enforced inside the library, not trusted to the caller | ❌ No policy layer exists |
| **Hardware-backed storage** | Private keys live in tamper-resistant hardware (Secure Enclave, TPM, HSM, cloud KMS) | ❌ Software-only storage; Keychain and libsecret are OS-level but not hardware-backed in the strong sense |
| **Non-exfiltration** | Caller never sees raw secret bytes; receives a handle that can perform crypto without materializing the key | ❌ API returns `string`, which lives in V8 heap indefinitely |
| **Supply-chain integrity** | Signed releases, SBOM, reproducible builds, minimal dependency surface, FIPS-mode crypto | ✅ Zero runtime deps, ❌ not signed, ❌ no SBOM, ❌ not FIPS-validated |

Four of five properties are fully absent. The fifth is partially in place (the "minimal dependency surface" piece) but the rest of the supply-chain story isn't yet built. Closing these gaps is a multi-release effort that cannot and should not happen in one PR.

### Why the current API shape is the blocker

The current public API is four module-level functions backed by a single module-level `activeBackend` selected at import time:

```ts
// packages/secrets/src/vault/vault.ts
const { backend: activeBackend, type: activeVaultType } = initVaultBackend();

export async function storeCredential(key, value): Promise<boolean> { ... }
export async function getCredential(key): Promise<string | null> { ... }
export async function deleteCredential(key): Promise<boolean> { ... }
export async function listCredentials(prefix?): Promise<string[]> { ... }
```

Every cross-cutting concern a regulated consumer cares about — audit, rate limit, ACL, attestation, metrics — has **no place to land** in this shape. There is nowhere to insert a middleware. The only path is either:

1. Monkey-patching the module-level functions (fragile, non-composable, defeats tree-shaking).
2. Wrapping every call site in the consumer's own code (misses calls from transitive dependencies, creates a cross-package coordination problem).
3. Forking the package (nuclear option, loses upstream fixes).

None of these are acceptable for a consumer that's about to be audited. The library must grow an explicit seam for cross-cutting concerns before it can serve regulated consumers at all.

### Constraints and assumptions

- **Backwards compatibility is non-negotiable until 2.0.** The four existing public functions must keep working unchanged through 0.5.x and 1.x. Breaking them means breaking the centient MCP server and the soma integration, which we can't justify.
- **Zero runtime dependencies is a real asset and worth preserving where possible.** Each new dependency expands the attack surface we ask consumers to accept. We add dependencies only when the functional gain is significant and the dependency is well-maintained, pure JS, and widely used.
- **We do not ship certification.** This package will not be FIPS 140-2 certified itself — we use FIPS-validated crypto implementations under the hood (Node in FIPS mode, OpenSSL FIPS module) but we do not enter the certification process for our own code.
- **We do not implement hardware.** We wrap existing, well-reviewed hardware interfaces (PKCS#11 via `graphene-pk11` for HSMs, Secure Enclave via `@ids-com/node-secure-enclave` or similar, TPM via `node-tpm2-tss`). We do not invent our own HSM driver.
- **We do not build a credential broker.** Process-isolated credential storage — a dedicated broker process that enforces attestation-based access — is a legitimate architecture for the highest-security deployments but is an order of magnitude more work than the rest of this ADR. It belongs in a separate package (`@centient/vault-broker` or similar) and is explicitly out of scope for `@centient/secrets` itself.

### Alternatives considered at the architecture level

Before landing on the three-pillar design below, three alternative high-level shapes were considered and rejected.

**Alternative 1: Make the existing module-level API configurable via a single options object.**

```ts
configureSecrets({
  auditor: ...,
  rateLimiter: ...,
  acl: ...,
});
```

Rejected because:

- Still global mutable state, but now with O(N) fields instead of O(1).
- No natural place for per-call context (e.g. the caller's identity for ACL checks).
- Every new cross-cutting concern adds a new field, creating API thrash across minor releases.
- Testing isolation is difficult — one test configuring the global affects every other test unless every test remembers to reset.
- Can't run two configurations side-by-side in the same process, which multi-tenant consumers eventually need.

**Alternative 2: Leave the module-level API and introduce a parallel class-based `SecretsClient` for advanced users.**

```ts
// Existing API unchanged
await getCredential("...");

// New, parallel advanced API
const client = new SecretsClient({ ... });
await client.getCredential("...");
```

Rejected because:

- Two APIs doing the same thing is a cognitive tax and a documentation tax.
- Inevitably consumers mix them up, writing some calls via the module-level API (missing the policy stack) and some via the client (hitting it), producing audit gaps that are hard to detect.
- Violates P5 (Principle of Least Surprise) and P6 (Single Source of Truth).
- Forks evolution — every new feature has to be added in two places.

**Alternative 3: Ship `@centient/secrets-advanced` as a separate package for regulated consumers.**

Rejected because:

- Package proliferation for what should be a single consistent story.
- Soma (the active consumer) would be forced to choose between "simple API, insecure defaults" and "advanced API, re-learn everything" — neither is right.
- Creates a version skew problem between the two packages.
- Most of the architecture (audit, rate limit, ACL) is useful to non-regulated consumers too, so gating it behind a separate package is artificial.

The three-pillar architecture below is a **single unified design** that serves both simple and regulated consumers from one package, with the module-level API as a convenience wrapper over a default client.

## Decision

Adopt a three-pillar architecture for `@centient/secrets`, staged across three releases, with explicit non-goals and an explicit compliance-target roadmap.

### Pillar 1: Provider / Policy / Client separation

Restructure the library into three layered concepts:

```
          Consumer code
              │
              ▼
    ┌─────────────────────┐
    │   SecretsClient     │   public API — stable, narrow, typed
    │   (what callers     │   getCredential / listCredentials / etc.
    │    actually use)    │   created by factory with explicit config
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────┐
    │   Policy stack      │   cross-cutting concerns as middleware
    │   (audit, rate      │   each policy can reject, transform, emit
    │    limit, ACL,      │   fail-closed: one rejection aborts
    │    attestation)     │
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────┐
    │   SecretsProvider   │   SPI for storage backends
    │   (keychain, HSM,   │   pluggable, can be local or remote
    │    Vault, KMS,      │   handle-returning where supported
    │    Secure Enclave)  │
    └─────────────────────┘
```

**`SecretsClient`** is the public API. Consumers call `client.getCredential(...)`, `client.listCredentials(...)`, etc. The client is created by a factory function and holds a provider and a policy list. Multiple clients can coexist in one process with different policies and different providers.

**`SecretsPolicy`** is the middleware layer. A policy is an object implementing `before(op)`, `after(event)`, or both. `before` runs before the operation reaches the provider and can reject the operation by throwing. `after` runs after the operation completes (successfully or otherwise) and receives a structured event describing what happened. Policies are applied in the order they're listed; `before` hooks run top-to-bottom, `after` hooks run bottom-to-top (canonical middleware onion semantics). If any `before` hook throws, the operation is aborted and `after` hooks on already-entered policies still run with a failure event — ensuring rejected operations are still audited.

**`SecretsProvider`** is the service-provider interface for storage backends. It defines the primitive operations (`store`, `retrieve`, `delete`, `listKeys`) and, for providers that support them, handle-returning variants (`getCredentialHandle`, etc.). The existing `VaultBackend` interface becomes a subset of `SecretsProvider` — all current backends keep working with zero changes to their implementation.

### Pillar 2: Handle-based API (long-term, not 0.5.0)

For the highest-security deployments, introduce a handle-based API that avoids materializing secret values in the Node heap at all:

```ts
using handle = await client.getCredentialHandle("soma.anthropic.token1");
const response = await fetch(url, {
  headers: { Authorization: handle.asBearer() },
});
// handle.dispose() runs automatically at end of `using` block; secret zeroed
```

A `CredentialHandle`:

- May be used once per operation (single-use semantics for token leakage defense).
- Performs crypto inside the handle (sign JWT, present TLS client cert, produce HMAC) without surfacing raw bytes to JS.
- Can be passed to a subprocess via file descriptor without copying through JS memory.
- Is scoped to a `using` block via TC39 explicit resource management, guaranteeing deterministic zeroing at scope exit.

Not every provider supports handles. Keychain, libsecret, and GPG return plaintext bytes, so their `getCredentialHandle` implementation materializes the secret in a protected region and zeroes it on dispose — marginally better than the current state but not hardware-grade. Hardware-backed providers (Secure Enclave, TPM, HSM, cloud KMS) support handles natively — the signing operation happens in hardware and the raw key never leaves the device boundary.

Consumers audit their own call sites for `getCredential` and upgrade to `getCredentialHandle` where their provider supports it. Both APIs coexist; neither is deprecated.

### Pillar 3: Telemetry via OpenTelemetry + OCSF

All audit output is emitted via OpenTelemetry spans with attributes conforming to the [OCSF Credential Activity schema](https://schema.ocsf.io/categories/iam) (category 3004). The built-in `auditTrail` policy wraps the existing OpenTelemetry tracer and emits spans with:

- `activity_id` — one of OCSF's defined credential activities (create, read, update, delete, enumerate)
- `actor.user` — identity of the process performing the operation
- `credential.name` — the key name
- `credential.vault.name` — which provider handled the operation (`keychain`, `libsecret`, `hsm`, etc.)
- `status_id` — OCSF status code (success, failure, denied)
- `time` — operation start time
- `duration` — end-to-end wall-clock duration
- `previous_hash` and `sequence_number` — for HMAC-chained tamper detection (optional, opt-in)

Consumers deploy a standard OpenTelemetry collector (`@opentelemetry/exporter-otlp-http`) pointed at their SIEM. No custom adapters, no bespoke event schema. Regulated consumers already run OTel pipelines for every other observability concern; this inherits that infrastructure instead of requiring a parallel one.

The choice of OTel + OCSF is deliberate: it's the combination that regulated consumers' existing security tooling already understands. Any other shape — custom EventEmitter, custom iterable streams, vendor-specific SDKs — forces the consumer to write a bridge layer, and bridge layers have historically been where audit gaps hide.

## Migration path — three releases

The architecture above is the target. Getting there without breaking existing consumers requires staging the work across three releases. Each stage is individually shippable and individually useful.

### 0.5.0 — "start of the road to hardened"

**Theme:** introduce the policy seam, stabilize the backend interface, fix the latent security smells from 0.4.0.

- **Item 1** — Relax `isValidKey` to permit dots (shipped as PR #21, awaiting merge).
- **Item 2** — In-process TTL cache for `listAccountsInKeychain` to mitigate the O(total-keychain-size) cost documented in the 0.4.0 JSDoc.
- **Item 3** — `--json` output flag on `centient secrets list-backend-keys` for scriptable consumption.
- **Item 4** — Migrate libsecret enumeration from the `secret-tool search --all` CLI (which emits decrypted secret values on stdout) to a real D-Bus client via the `dbus-next` library. This requires making `VaultBackend.listKeys` async, which is a compile-time breaking change to the SPI. **We accept this as a minor bump under the 0.x convention** because (a) no external implementations of `VaultBackend` are known, (b) 1.0 hasn't shipped, and (c) doing it properly now saves a larger breaking change later.
- **Item 8** — Introduce the `SecretsPolicy` interface and `setSecretsPolicies(policies)` configurator. Ship exactly **one** built-in policy: `auditTrail({ sink, includeReads })`. No rate limiting, no ACL, no attestation yet — the API shape is the contribution, not the catalog of policies. Names are chosen to fit the 1.0 target without needing to be rewritten.
- **This ADR** — document the architecture, migration path, and non-goals so subsequent PRs can reference it.
- **Repo-level** — `RELEASING.md` documenting the exact flow for version bumps (preventing a recurrence of the 0.4.0 publish snag), and a CI check that fails if the `CLAUDE.md` package table drifts from real `package.json` versions.

0.5.0 does **not** ship: `SecretsClient` factory, `SecretsProvider` SPI, handle-based API, OpenTelemetry integration, OCSF event schema, rate limit / ACL / attestation policies, any compliance-specific features.

### 1.0.0 — "policy stack + client factory"

**Theme:** full middleware architecture, OpenTelemetry as default, first compliance-ready shape.

- Introduce `createSecretsClient({ provider, policies })` as the primary public API. The existing module-level `storeCredential` / `getCredential` / `deleteCredential` / `listCredentials` functions become thin shims over a default client, keeping every 0.5.x consumer working unchanged.
- Ship the `SecretsProvider` SPI as a stable public interface. Refactor the existing backends (Keychain, libsecret, Windows, GPG, env) as implementations of the SPI. The old `VaultBackend` interface becomes an alias for `SecretsProvider` during a deprecation window.
- Built-in policies: `auditTrail`, `rateLimit`, `accessControl`, `attestation` (optional). Each is independently testable and composable.
- OpenTelemetry sink as the default audit output. OCSF-compatible event schema. JSONL and syslog sinks available for non-OTel deployments.
- Event chain integrity: optional HMAC-SHA256 chaining with `previous_hash` and `sequence_number`, letting auditors detect post-hoc tampering.
- Deprecate the 0.5.0 `setSecretsPolicies` setter in favor of the client factory. Keep it working for a full major-version window.
- Publish a documented threat model for the library as a docs page — what attacks are in scope, what attacks are explicitly out of scope, where trust boundaries are.
- **Target compliance fit: SOC 2 Type II.** Specifically, the library's audit surface, access control, and change management story should be sufficient that a SOC 2 assessor reviewing a consuming application can check "credential management" off their list by looking at our OTel stream and this ADR.

1.0.0 does **not** ship: hardware-backed providers, handle-based API, FIPS mode, remote backends (HashiCorp Vault, cloud KMS), the `@centient/vault-broker` package.

### 2.0.0 — "hardware-backed + handle API"

**Theme:** the full long-term architecture, suitable for FedRAMP Moderate / PCI-DSS / HIPAA deployments.

- `SecretsProvider` implementations for remote and hardware-backed backends:
  - `HashiCorpVaultProvider` (HTTP API against Vault servers)
  - `AwsKmsProvider`, `GcpKmsProvider`, `AzureKeyVaultProvider` (cloud KMS)
  - `Pkcs11Provider` (PKCS#11 interface for physical and cloud HSMs)
  - `SecureEnclaveProvider` (macOS Secure Enclave via native binding)
  - `TpmProvider` (Linux TPM 2.0 via `node-tpm2-tss` or equivalent)
- `CredentialHandle` type and `client.getCredentialHandle(...)` API.
- FIPS mode: library configures Node's crypto to use only FIPS-validated algorithms when the consumer opts in via `createSecretsClient({ fipsMode: true })`.
- Signed release artifacts via Sigstore / npm provenance.
- SBOM generation in the release pipeline.
- `@centient/vault-broker` published as a **separate** package for consumers who want process-isolated credential storage with attestation. `@centient/secrets` gains a `BrokerProvider` that talks to the broker over a local socket.
- **Target compliance fit: PCI-DSS, HIPAA, FedRAMP Moderate.** FedRAMP High and FIPS 140-2 module certification remain separate efforts and are not in 2.0 scope.

## Consequences

### Positive

- **Regulated consumers become possible.** Today they are not — the shape of the API actively precludes a compliant deployment. This ADR is the difference between "this package can be used in a SOC 2 Type II audit" and "it cannot." (P13, P15)
- **No breaking changes for existing consumers through 1.x.** Module-level `storeCredential` / `getCredential` / `deleteCredential` / `listCredentials` keep working. The `soma` integration, the centient MCP server, and any other 0.x consumer picks up the new behavior — default client with no policies, behaves identically to today — without changing a line of code. (P3 Transparent Evolution)
- **Policy composition is category-complete.** Any cross-cutting concern — audit, rate limit, ACL, attestation, metrics, tracing — can be added as a policy without changing the client, the providers, or the public API signature. (P9 Composability Over Completeness, P10 Categorical Symmetry)
- **Test isolation improves.** Instance-based clients replace module-level global state. A test can create a `SecretsClient` with a mock provider and no policies, run assertions, and discard it — without affecting any other test. Today's module-level singleton makes parallel test execution dangerous; the new model removes that hazard. (P11 Honest Uncertainty)
- **Observability becomes first-class.** An auditor, an SRE running an incident retrospective, or a security engineer doing a post-mortem can reconstruct exactly what credential operations happened, when, from where, with what outcome — via a standard OTel pipeline they already have. (P4 Observable Architecture, P13 Auditability as a First-Class Feature)
- **Hardware backends stop being a fantasy.** The provider SPI lets `Pkcs11Provider`, `SecureEnclaveProvider`, `TpmProvider` fit in as peers to the existing Keychain and libsecret providers, without any change to consumer code. A consumer can swap from file-based storage to HSM by editing one line in their client factory call. (P10 Categorical Symmetry)
- **Supply chain hardening becomes tractable.** Once the architecture is stable, adding SBOM generation, Sigstore signing, and FIPS-mode crypto is a release-process concern, not a redesign. (P15 Secure by Default)

### Negative

- **Surface area grows.** The package goes from 4 public functions to a client factory, a provider SPI, a policy interface, a set of built-in policies, and a family of providers. Each new abstraction is a learning cost for new contributors and a documentation cost for the maintainers. We mitigate this by keeping the module-level API as the "simple path" and documenting the client factory as the "advanced path."
- **Runtime dependencies will appear.** 0.4.0 ships zero runtime dependencies. Item 4 of 0.5.0 adds `dbus-next` (pure JS, well-maintained, needed for the libsecret security fix). 1.0 may add an OpenTelemetry SDK. 2.0 will add native bindings for PKCS#11, Secure Enclave, and TPM. Each addition is a deliberate tradeoff: we accept the dependency when the security or functional gain justifies the supply-chain cost. We do not add dependencies casually.
- **Breaking changes to internal interfaces.** `VaultBackend` becomes `SecretsProvider` in 1.0. `listKeys` becomes async in 0.5.0. External implementers of these interfaces — of which we have none today — would need to update. This is called out explicitly in each release's changeset.
- **Compliance target is a commitment.** Declaring SOC 2 as a target in this ADR means future PRs have to keep SOC 2 fit in mind. A reviewer can reject a PR that compromises the audit trail even if the PR otherwise looks clean. This is the intended behavior but it is a constraint on future velocity.
- **The three-release phasing slows down features that might otherwise ship in 0.5.** `createSecretsClient`, the full policy stack, OpenTelemetry integration — all of these would be nice to have in 0.5.0, but bundling them into one release would make the release a multi-month effort and risk shipping an API we'd want to change later. The phased approach trades throughput for soundness.

### Neutral

- **The hardware-backed story is real but distant.** 2.0 is a meaningful amount of work, some of which depends on external libraries (PKCS#11 bindings, Secure Enclave wrappers) that may have their own evolution pressures. The roadmap is directional, not a commitment to a specific calendar date.
- **`@centient/vault-broker` is explicitly out of scope for this ADR.** The highest-security deployments want a dedicated broker process with attestation-based access control. We leave the door open for it — a `BrokerProvider` would implement the same SPI as every other provider — but we do not design or build the broker itself in this document.
- **FIPS certification of `@centient/secrets` itself is a non-goal.** We use FIPS-validated crypto implementations under the hood when the consumer opts in, but we do not enter the certification process. A consumer that requires FIPS 140-2 certification of every cryptographic module in their stack will need to obtain separate FIPS builds of Node, OpenSSL, and any native HSM bindings we depend on.

## Non-goals

Explicitly listed here so future PR reviews can reject scope creep that claims the ADR as justification:

1. **Not a zero-trust credential broker.** Process-isolated credential storage with remote attestation is a legitimate architecture but belongs in `@centient/vault-broker`, not here.
2. **Not an HSM implementation.** We wrap PKCS#11 via an existing binding; we do not write our own HSM driver or cryptographic module.
3. **Not a policy language.** Policies are TypeScript functions. If a consumer wants externally-configurable policy expressed as YAML, Rego, OPA, or any other DSL, they write a `ConfigurablePolicy` adapter that parses the DSL and produces TypeScript policy instances. The core library does not ship a policy language.
4. **Not a key management service.** We do not ship a service for creating, rotating, distributing, or revoking credentials. Those are the consumer's problem (or the problem of the remote backend they pick — HashiCorp Vault, AWS KMS, etc.).
5. **Not a secrets synchronization mechanism.** The library does not sync credentials between machines, devices, or cloud accounts. A consumer that wants that pattern uses 1Password, a cloud KMS, or HashiCorp Vault as their provider.
6. **Not FIPS 140-2 certified itself.** We enable FIPS-mode crypto when the consumer opts in, but the library's own code is not submitted for module-level FIPS certification.
7. **Not a general-purpose cryptographic library.** `@centient/secrets` stores, retrieves, and mediates access to credentials. It does not expose primitives for arbitrary encryption, signing, or key derivation operations — those live in the consumer's code or in dedicated crypto libraries.

## Threat model

The threat model evolves across the three releases. This ADR documents both the current (0.4.0) threat model and the target (2.0.0) threat model so consumers can map their own security requirements to the right release.

### 0.4.0 threat model (current)

**Defends against:**

- Casual local filesystem attacks: another process on the same machine without elevated privileges cannot read the contents of the OS keychain entry or the GPG-encrypted vault file.
- Plaintext credentials in source code: by storing credentials in a vault rather than in environment variables or config files, the library prevents accidental credential commits.
- Basic shell injection: the `isValidKey` validation prevents credential names from being interpolated into subprocess argv in ways that would break argument parsing.

**Does NOT defend against:**

- Code execution within the consuming process: a malicious library or an RCE in the consumer can call `getCredential(...)` directly and exfiltrate values.
- Memory dumps: credential values live in Node heap as `string` instances and can be recovered from core dumps, heap snapshots, or live debugger sessions.
- Filesystem access by a privileged attacker: root on the local machine can read the keychain or decrypt the vault file.
- Network attackers: there is no remote backend; the "network" is not a threat surface but only because we don't use it.
- Insider threats: there is no access control on credential reads; any code path that can import the library can read any credential.
- Tampering with audit logs: there are no audit logs.

### 2.0.0 threat model (target)

**Additionally defends against:**

- Memory dumps and heap snapshots: the handle-based API prevents raw secret material from ever entering the Node heap for hardware-backed providers.
- Insider threats at the application layer: the `accessControl` policy can enforce per-key, per-caller, per-operation ACLs inside the library, so an attacker with code execution in one part of the app cannot reach credentials they shouldn't.
- Runaway credential access: the `rateLimit` policy caps reads per window, making bulk exfiltration via stolen code execution detectable and slow.
- Tampering with audit logs: the `auditTrail` policy supports HMAC-chained events with `previous_hash` and `sequence_number`, so an attacker who compromises the audit log storage cannot insert, delete, or reorder events without detection.
- Loss of hardware custody: private keys in PKCS#11 HSMs, Secure Enclave, and TPMs never leave hardware. A full OS compromise of the consuming machine does not surrender the raw keys; it surrenders only the ability to perform signing operations for as long as the compromise persists.

**Still does NOT defend against:**

- Full compromise of the hardware root of trust (successful HSM attack, Secure Enclave exploit, TPM bypass) — these are outside the library's defenses.
- Social engineering of operators with legitimate access.
- Supply-chain attacks on Node itself, or on well-trusted dependencies we rely on.
- Consumers that misuse the library (e.g. reading credentials and immediately logging them to stdout).
- Side-channel attacks on the backing crypto (timing, power analysis, cache attacks) — these are the concern of the underlying hardware and crypto module.

The full threat model will live in `docs/threat-model.md` starting in 1.0, with the 2.0 additions appearing when hardware backends ship. This ADR is the reference point until that doc exists.

## Compliance target roadmap

Not every release is aimed at every certification. The following table lays out which compliance frameworks each release is designed to support (though never to certify), and which specific capabilities each framework requires from this library.

| Framework | Required capabilities | Target release |
|---|---|---|
| **SOC 2 Type II** | Auditable trail of credential access, access control, change management via ADR record | **1.0.0** (primary target) |
| **PCI-DSS** | FIPS-validated crypto for cardholder data encryption, key rotation, audit trails | 2.0.0 (partial); full PCI compliance is the consumer's responsibility |
| **HIPAA** | Access control, audit, encryption at rest and in transit | 1.0.0 (encryption already in place; access control and audit in 1.0) |
| **FedRAMP Moderate** | FIPS 140-2 validated crypto, continuous monitoring via OTel, detailed audit trail | 2.0.0 |
| **FedRAMP High** | Hardware-backed key storage, strict access control, comprehensive audit | 2.0.0+ (may require work beyond 2.0 depending on specific agency requirements) |
| **FIPS 140-2** | FIPS-validated cryptographic module | 2.0.0 FIPS mode (library opts into validated implementations; library itself is not certified) |
| **StateRAMP** | Generally aligns with FedRAMP Moderate | 2.0.0 |
| **CMMC Level 2+** | NIST SP 800-171 controls including audit (AU), access control (AC), identification and authentication (IA) | 1.0.0 for most controls, 2.0.0 for crypto (SC) controls |

SOC 2 is the near-term priority. Everything else is a future goal whose requirements should inform design decisions directionally but must not dictate 0.5.0 scope.

## Compatibility and migration

### Consumer migration — the easy path

Consumers who use `@centient/secrets` through the module-level API (`storeCredential`, `getCredential`, `deleteCredential`, `listCredentials`) need to make **zero changes** through 0.5.x, 0.6.x, ... up through 1.x. The module-level API is preserved as a thin shim over a default client with no policies, giving identical behavior to today.

This is the primary mode the `soma` integration uses, and the mode the centient MCP server uses. Neither repo needs to be touched as part of the 0.5.0 or 1.0.0 releases. They will naturally pick up the latest behavior when they bump the dependency.

### Consumer migration — the regulated path

Consumers deploying in regulated environments need to switch to the client factory as soon as it ships in 1.0:

```ts
// Before (0.5.x)
import { getCredential, setSecretsPolicies, auditTrail } from "@centient/secrets";
import { otelAuditSink } from "@centient/secrets/sinks";

setSecretsPolicies([auditTrail({ sink: otelAuditSink() })]);
const value = await getCredential("soma.anthropic.token1");

// After (1.0)
import { createSecretsClient, auditTrail, rateLimit } from "@centient/secrets";
import { otelAuditSink } from "@centient/secrets/sinks";
import { KeychainProvider } from "@centient/secrets/providers/keychain";

const client = createSecretsClient({
  provider: new KeychainProvider({ service: "soma-prod" }),
  policies: [
    auditTrail({ sink: otelAuditSink(), chain: "hmac-sha256" }),
    rateLimit({ reads: 1000, window: "1m" }),
  ],
});
const value = await client.getCredential("soma.anthropic.token1");
```

The migration is mechanical: replace module-level function imports with a `createSecretsClient` call plus per-client method calls. 1.0.0 ships a codemod script (`scripts/migrate-to-client.mjs`) that handles the rewrite automatically for most idiomatic call patterns.

### Backend implementer migration

External implementations of `VaultBackend` need to update for 0.5.0 (async `listKeys`) and again for 1.0.0 (rename to `SecretsProvider`). No external implementations are known at the time of this ADR; the changesets for 0.5.0 and 1.0.0 call this out explicitly, and the 1.0.0 release will include a deprecation period where `VaultBackend` remains exported as an alias.

## Open questions

A few design questions remain unresolved and will be decided in the PRs that implement them, not in this ADR:

1. **How do policies access per-operation context?** A `before` hook needs to know who the caller is, what credential is being requested, and potentially the call stack. We need a `SecretsOperation` type that carries enough context for meaningful ACL and rate-limit decisions without leaking implementation details. Decision deferred to the PR that introduces `createSecretsClient`.
2. **Do handles support subprocess forwarding via FD in Node?** The TC39 explicit resource management proposal is shipping in Node 22+, but the underlying story for passing secret material to subprocesses without copying is still murky. May require a native binding. Decision deferred to the 2.0.0 design phase.
3. **How does the audit chain HMAC key get established and rotated?** The chain's integrity depends on the HMAC key not being compromised. A naive implementation reads it from a file at startup; a better one derives it from a hardware attestation. Decision deferred to 1.0.0.
4. **Should `createSecretsClient` be a module-level function or a class constructor?** Factory function matches the pattern used by `createEngramClient`, `createLogger`, `createEventStream`, `createAuditWriter` — all of the sister packages use `createXxx()` factories. Leaning factory for consistency, but final decision is in the PR that introduces it.
5. **What's the story for `dbus-next` on macOS and Windows?** The `dbus-next` dependency is pure JS and installs cleanly on every platform, but the libsecret backend is only selected on Linux, so on macOS/Windows the import is dead code. We accept the install-time weight for API surface stability. Worth revisiting if dbus-next grows native dependencies.

## References

- [OCSF Credential Activity schema (category 3004)](https://schema.ocsf.io/categories/iam)
- [PKCS#11 Cryptographic Token Interface Base Specification](https://docs.oasis-open.org/pkcs11/pkcs11-base/v3.0/pkcs11-base-v3.0.html)
- [NIST SP 800-53 rev 5 — Security and Privacy Controls](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) (AC, AU, IA, SC families)
- [NIST FIPS 140-2 — Security Requirements for Cryptographic Modules](https://csrc.nist.gov/publications/detail/fips/140/2/final)
- [SOC 2 Trust Services Criteria (TSC) 2017](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services)
- [TC39 Explicit Resource Management proposal](https://github.com/tc39/proposal-explicit-resource-management)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/)
- ADR-001 — Key Provider Abstraction for Headless Vault Unlock (the existing key-provider abstraction is architecturally parallel to the `SecretsProvider` SPI this ADR introduces; the two concepts will be reconciled in 1.0)
- `.agent/DESIGN-PHILOSOPHY.md` — the 15 principles referenced in the header
