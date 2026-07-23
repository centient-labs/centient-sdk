---
"@centient/secrets": minor
---

feat(secrets): `OnePasswordVault` credential backend (ADR-004)

Implements ADR-004, accepted 2026-07-22. Credential *values* can now live in a
dedicated 1Password vault — a separate layer from ADR-001's `OnePasswordProvider`,
which stores the vault *encryption key*. The two carry independent config blocks,
so the key can stay in the Keychain while credentials live in 1Password, or the
reverse.

Two properties this backend is built around:

- **Never auto-selected.** `op` being installed is not consent to route
  credentials into someone's personal vault, so `OnePasswordVault` sits outside
  the auto-cascade entirely and is reachable only via an explicit
  `secrets.backend: "1password"` (or `CENTIENT_SECRETS_BACKEND`). An explicit
  choice also **fails closed** — a missing vault name or an unavailable `op`
  throws rather than silently falling back to another backend.
- **Secret values never touch argv.** Writes build the item JSON in-process and
  pipe it to `op item create -`, so nothing readable in `ps` carries a secret.
  Update is modeled as delete-then-create so both write paths share that one
  argv-safe route.

Also adds:

- `secrets.onePasswordBackend` config (`vault` **required, no default**; `tag`
  defaults to `centient`) and the `CENTIENT_OP_VAULT` env override.
- `"1password"` in the `VaultType` union, so `getActiveVaultType()` and
  `secrets list-backend-keys --json` surface it with no further change.
- A shared `op-cli.ts` helper (`detectOpCli`, `runOp`, `OpCliError`) — one source
  of truth for how `op` is invoked, consumed by both the key provider and the new
  backend. Its `input` option is the argv-safe seam that #102's retrofit needs.
- List-cache of key **names** only (5s TTL, mirroring the Keychain backend),
  invalidated on write/delete. Values are never cached: that would both hold
  plaintext in the heap for the TTL and serve a rotated or revoked credential
  until expiry.

Policy/audit hooks wrap the new backend for free, since the cascade already
wraps every backend call.
