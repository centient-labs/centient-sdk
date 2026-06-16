---
"@centient/secrets": minor
---

Per-consumer vault keys (issue #80). Previously `KeychainProvider` hardcoded
`service="centient-vault"`/`account="vault-key"` and `openVault()` resolved its
provider internally with no injection point, so every consumer on a machine
encrypted its vault with the same Keychain master key. Two additive,
complementary mechanisms now let each consumer name its own key or supply its
own provider:

- `OpenVaultOptions.keyProvider?: KeyProvider` — inject a provider explicitly.
  When set, `openVault()` uses it directly and skips internal resolution. This
  also makes `openVault()` headlessly testable against a throwaway in-memory
  stub provider (no real Keychain).
- `KeychainProvider` now accepts `{ service?, account? }` constructor options,
  and `ResolveKeyProviderOptions` / `OpenVaultOptions` thread a
  `keychain?: { service, account }` field through internal resolution — so a
  consumer can name its own Keychain item (e.g. `"burnrate-vault"`) without
  injecting a whole provider. Exposed `DEFAULT_KEYCHAIN_SERVICE` /
  `DEFAULT_KEYCHAIN_ACCOUNT` constants and the `KeychainProviderOptions` type.

Defaults are unchanged: with no options, `KeychainProvider` targets
`centient-vault`/`vault-key` and `openVault()` resolves internally exactly as
before, so existing vaults keep opening.
