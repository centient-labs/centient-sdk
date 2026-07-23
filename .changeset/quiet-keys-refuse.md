---
"@centient/secrets": minor
---

fix(secrets)!: enforce the credential-key grammar at the cascade, and fail loudly (#168)

**Breaking behavior change** in a 0.x package. `storeCredential`,
`getCredential`, `deleteCredential` and `listCredentials` now **throw
`InvalidCredentialKeyError`** for a key that does not match the documented key
grammar, instead of passing it through to whichever backend happens to be
active.

### Why

`vault.ts` documented the rule and enforced it nowhere on the shared path. The
cascade's first backend (`KeychainVault`, the active one on every Mac) and its
last (`EnvVault`, the always-available fallback) accepted anything, while GPG,
libsecret, Windows Credential Manager and 1Password could not address such a
key at all. A key like `Auth_Token` therefore **stored successfully on macOS and
was unreadable on every other backend** — the silent write/read asymmetry the
invariant exists to prevent, and reachable today through any CLI that takes the
key as an operator-typed argument.

The three enforcing unix/windows backends compounded it: they returned `null`
from `retrieve` on a non-conforming key, which is indistinguishable from "no
such credential". A malformed key is not a missing one, and only a
distinguishable failure says so (P2, No Silent Degradation).

### What changes

- The grammar is enforced **once at the cascade**, before any backend is
  dispatched to. Nothing is written and no backend is contacted on rejection.
- `InvalidCredentialKeyError extends VaultError` (code
  `VAULT_INVALID_CREDENTIAL_KEY`) carries `key`, `operation` and `kind`, and is
  exported from the package root.
- Backends (`GpgVault`, `LibsecretVault`, `WindowsVault`, `OnePasswordVault`)
  assert the same grammar with the same typed error rather than returning
  `false`/`null`. They are individually constructible and several interpolate
  the key into a shell string or an `op://` reference, so the check stays as
  defense in depth — but with one outcome, not two.
- `OnePasswordVault`'s private warn-once `acceptKey` (added in #167, when the
  cascade enforced nothing and a lone throwing backend would have been the odd
  one out) is removed. A thrown error names the key, the operation and the
  reason, and unlike a stderr warning it cannot be missed.
- New `isValidKeyPrefix()` / `assertValidKeyPrefix()`. `listCredentials(prefix)`
  is validated against the **prefix** grammar, not the key grammar, so the
  documented `listCredentials("soma.anthropic.")` keeps working — a prefix may
  end on a separator. `""` and omitted are both "no filter". A prefix ending in
  a separator is capped at 63 rather than 64: a key must end alphanumeric and
  caps at 64, so a 64-character separator-terminated prefix could only extend
  to a 65-character key and therefore matches nothing.
- Rejections are audited: the policy `after` hooks fire with the same
  `credential_*_rejected` event a policy denial produces, so a refused
  operation is never invisible to the audit trail. Validation runs *before* the
  `before` hooks — a malformed key is a caller-contract violation, not a policy
  decision.

### Migration

Keys must be 2-64 characters of lowercase alphanumerics with `-` or `.` as
separators, beginning and ending with an alphanumeric —
`/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/`. No uppercase, underscores, whitespace,
slashes or shell metacharacters.

A survey of write-path consumers across the org found **every documented in-use
key already conforms**, so no known caller breaks. If you store keys
programmatically from operator input, validate at your own boundary first:

```ts
import { isValidKey, InvalidCredentialKeyError } from "@centient/secrets";

if (!isValidKey(key)) {
  // reject at the CLI/API edge, where you can name the offending input
}

try {
  await storeCredential(key, value);
} catch (err) {
  if (err instanceof InvalidCredentialKeyError) {
    // err.key, err.operation, err.kind
  }
}
```

Callers that relied on `getCredential()` returning `null` for a malformed key
must now catch. That return value was the bug: it reported an impossible key as
an absent one.
