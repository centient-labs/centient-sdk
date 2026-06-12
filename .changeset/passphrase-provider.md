---
"@centient/secrets": minor
---

Add a passphrase key provider for headless vault unlock. The provider derives the vault key with scrypt from a typed passphrase plus per-vault salt, persists only KDF metadata plus an HMAC verifier beside the vault, and fails closed when no interactive TTY is available.
