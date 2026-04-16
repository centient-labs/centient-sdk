---
"@centient/secrets": minor
---

Add in-process TTL cache for macOS Keychain enumeration and `--json` output flag for `list-backend-keys` CLI subcommand.

**Keychain cache:** `listAccountsInKeychain` now caches results for 5 seconds, keyed by `{service, prefix}`. Repeated `listCredentials` calls within the TTL window return cached results without re-spawning `security dump-keychain`. The cache is automatically invalidated when `storeStringInKeychain` or `deleteFromKeychain` is called, so stale reads after a write are not possible.

**`--json` CLI flag:** `centient secrets list-backend-keys --json` outputs a sorted JSON array of key strings instead of the human-readable formatted list. On enumeration failure, outputs `{"error": "..."}` instead of the emoji-prefixed stderr message. Designed for scripting — e.g. `centient secrets list-backend-keys --prefix soma.anthropic. --json | jq '.[]'`.
