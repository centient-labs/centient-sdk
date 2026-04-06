# @centient/secrets

## 0.3.0

### Minor Changes

- Add KeyProvider abstraction for pluggable vault key storage. New `OnePasswordProvider` enables headless/remote unlock via `op` CLI and service account tokens. Existing macOS Keychain behavior unchanged (auto-detected when no config present). New `centient secrets migrate <provider>` command for switching between providers.

## 0.2.0

### Minor Changes

- Initial release — cross-platform secrets vault with AES-256-GCM encryption and platform-native key storage
