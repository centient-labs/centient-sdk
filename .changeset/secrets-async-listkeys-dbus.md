---
"@centient/secrets": minor
---

Make `VaultBackend.listKeys` async (`Promise<string[]>`) and replace libsecret's `secret-tool search --all` CLI with a D-Bus client via `dbus-next`.

**Interface change:** `VaultBackend.listKeys(prefix?)` now returns `Promise<string[]>` instead of `string[]`. This is a compile-time breaking change for any external implementations of `VaultBackend`. No external implementations are known; accepting as a minor bump under 0.x semver per ADR-002 §0.5.0.

**Security fix (libsecret):** The previous implementation shelled out to `secret-tool search --all`, which emitted every stored credential's decrypted value on stdout alongside the attribute lines we parsed. The new D-Bus path calls `org.freedesktop.secrets.Service.SearchItems`, which returns item object paths without decrypting secret values — secret material never crosses process memory during enumeration.

**Fallback:** If the D-Bus session bus is unavailable (e.g. SSH without `DBUS_SESSION_BUS_ADDRESS`, headless server), the libsecret backend falls back to the `secret-tool` CLI parser automatically. The fallback carries the same transient-exposure trade-off as before; the JSDoc documents this.

**Other backends:** Keychain, Windows Credential Manager, GPG file vault, and EnvVault simply mark their `listKeys` as `async` — the underlying sync work is unchanged, auto-wrapped in a resolved promise.

**New runtime dependency:** `dbus-next@^0.10.2` (pure JavaScript, no native bindings). This is the first runtime dependency on `@centient/secrets`. It is dynamically imported inside `listKeysViaDbus` so it is only loaded on Linux when the libsecret backend is active and D-Bus is available.
