---
"@centient/secrets": minor
---

Close two ADR-002 P0 audit gaps surfaced by the scoped `cl-adr-audit` re-run:
policy-rejected operations are now audited, and a security-relevant libsecret
enumeration fallback is no longer silent.

**#120 — denied operations are audited (ADR-002 §1.0.0).** Previously, when a
`before` policy hook rejected an operation by throwing, the error propagated to
the caller but **no `after` event fired** — a denied credential operation left
no audit trace, the exact gap ADR-002 line 158 warns against (the `policy.ts`
docstring even contradicted the ADR). `runBeforeHooks` now implements the
documented behavior: on a before-hook throw at policy `i`, the `after` hooks of
the already-entered policies (`0..i-1`, bottom-to-top) fire with a new
`*_rejected` event, then the original error is re-thrown. The rejecting policy's
own `after` hook does not fire (its `before` did not complete). Wired through
both the cascade vault (`storeCredential`/`getCredential`/`deleteCredential`/
`listCredentials`) and the session vault's `withAudit` helper.

**Minor (not patch) — additive public surface.** `SecretsEventType` gains four
members: `credential_read_rejected`, `credential_write_rejected`,
`credential_delete_rejected`, `credential_enumerate_rejected`. A new
`rejectedEventType(op)` helper (operation → rejected-event-type) is exported as
the single source of truth for the mapping. Existing event types and emission
are unchanged, so consumers that only `switch` on the prior types keep working.

**#121 — libsecret D-Bus→secret-tool fallback is no longer silent.** The
`secret-tool search` fallback briefly materializes secret values on stdout, so
reverting to it from the secure D-Bus enumeration path is a security-relevant
degradation. The bare `catch {}` that swallowed all D-Bus errors now emits a
one-time stderr warning **when a session bus is advertised
(`DBUS_SESSION_BUS_ADDRESS` set) yet the D-Bus path still fails** — i.e. the
path that should have worked didn't. A genuinely bus-less host (SSH session,
headless server) stays quiet, since the fallback is the documented, expected
behavior there.
