---
"@centient/secrets": minor
---

Introduce the `SecretsPolicy` middleware layer and ship `auditTrail` as the first built-in policy.

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
