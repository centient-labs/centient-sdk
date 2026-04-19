# @centient/secrets

Cross-platform secrets vault with AES-256-GCM encryption and platform-native key storage.

> **Daemons / long-running processes:** see [Session-backed vault (`openVault`)](./docs/session-vault.md) for the recommended API — single master-key unlock per session, in-memory cached reads, mtime-check coherence with the CLI, rollback protection via monotonic version + sidecar.

## Installation

```bash
npm install @centient/secrets
```

Or with pnpm:

```bash
pnpm add @centient/secrets
```

## Features

- AES-256-GCM authenticated encryption for secrets at rest
- Platform-native key storage (macOS Keychain, Linux secret-service)
- Pluggable key providers (Keychain, 1Password)
- Credential vault with session management
- Environment detection (CI, Docker, SSH, headless, agent)
- Built-in CLI for interactive secret management

## Quick Start

```typescript
import { storeCredential, getCredential, deleteCredential } from "@centient/secrets";

// Store a credential
await storeCredential("my-service", "api-key", "sk-abc123");

// Retrieve it
const value = await getCredential("my-service", "api-key");

// Delete when no longer needed
await deleteCredential("my-service", "api-key");
```

### Encryption Utilities

```typescript
import { encrypt, decrypt } from "@centient/secrets";

const key = crypto.randomBytes(32);
const encrypted = encrypt("sensitive data", key);
const decrypted = decrypt(encrypted, key);
```

### Platform Detection

```typescript
import { isCIEnvironment, isDockerContainer, isAgentEnvironment } from "@centient/secrets";

if (isCIEnvironment()) {
  // Use environment variable fallback
}
```

## Key Providers

| Provider | Platform | Description |
|----------|----------|-------------|
| `KeychainProvider` | macOS/Linux | Uses OS keychain (Keychain Access / secret-service) |
| `OnePasswordProvider` | Any | Uses 1Password CLI for team secret sharing |

## License

MIT
