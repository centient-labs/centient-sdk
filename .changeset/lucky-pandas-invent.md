---
"@centient/secrets": minor
---

feat(secrets): implement `migrate --to passphrase` via vault rekey (#122)

`centient secrets migrate passphrase` no longer refuses. It now fulfils the
ADR-001 Amendment 1 commitment: the passphrase route goes through `setupKey()`
(never `storeKey()`, which a deriving provider cannot honour) and re-encrypts
the vault under the derived key. Provider-to-provider moves that only relocate
the same master key (`keychain`, `1password`) are unchanged.

Adds a public `rekeyVault()` to the session-vault surface — the primitive that
re-encrypts an existing vault under a new master key:

- atomic temp-then-rename ciphertext swap under the existing write lock
- a `commit` seam that runs after the new ciphertext lands and rolls it back
  byte-for-byte if it throws, so an external commitment (the CLI's
  `secrets.provider` write) is part of the same all-or-nothing step
- the same rollback / missing-sidecar refusals `openVault()` enforces, so a
  rekey cannot launder a rolled-back vault at a fresh version
- legacy AAD-less vaults upgraded to schema 1 in the same step
