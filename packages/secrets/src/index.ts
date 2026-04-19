// Encryption
export { encrypt, decrypt, encryptObject, decryptObject } from "./crypto/vault-common.js";
export { ALGORITHM, IV_LENGTH, AUTH_TAG_LENGTH, KEY_LENGTH } from "./crypto/vault-common.js";

// Credential vault
export { storeCredential, getCredential, deleteCredential, listCredentials, getActiveVaultType, isSessionValid } from "./vault/vault.js";
export type { VaultBackend, VaultType, StoredCredentialMeta } from "./vault/types.js";

// Platform detection
export { isTTY, canUnicode, isHeadless, canLaunchBrowser, isCIEnvironment, isDockerContainer, isSSHSession } from "./platform/platform.js";
export { isAgentEnvironment } from "./platform/agent-detect.js";

// Environment management
export { getEnvironmentManager, EnvironmentManager } from "./environment/EnvironmentManager.js";

// CLI
export { runSecrets } from "./cli/secrets-cli.js";
export type { SecretsOptions } from "./cli/secrets-cli.js";

// Key storage helpers (legacy — prefer key-providers for vault key access)
export { getKeyFromKeychain, storeKeyInKeychain, storeStringInKeychain, getStringFromKeychain, deleteFromKeychain } from "./crypto/vault-common.js";

// Key providers
export type { KeyProvider, KeyProviderType, OnePasswordConfig, SecretsConfig, CentientConfig } from "./key-providers/types.js";
export { KeychainProvider } from "./key-providers/keychain-provider.js";
export { OnePasswordProvider } from "./key-providers/onepassword-provider.js";
export { resolveKeyProvider, getProviderByType, loadConfig, saveSecretsConfig } from "./key-providers/resolve.js";

// Validation
export { isValidKey } from "./vault/vault-utils.js";

// Policy
export { setSecretsPolicies, getActivePolicies, auditTrail } from "./vault/policy.js";
export type { SecretsPolicy, SecretsEvent, SecretsEventType, SecretsOperation, AuditTrailOptions } from "./vault/policy.js";

// Session-backed vault (envelope encryption, single unlock per session)
// Recommended for long-running processes (daemons) holding N credentials;
// supersedes per-item `getCredential` calls for those consumers. See
// packages/secrets/docs/session-vault.md and issue #40 for the threat model.
export { openVault, VAULT_SCHEMA_VERSION, VAULT_AAD_PREFIX, DEFAULT_VAULT_PATH, DEFAULT_SIDECAR_PATH } from "./vault/session-vault.js";
export {
  VaultError,
  VaultUnlockError,
  VaultDecryptError,
  VaultRollbackError,
  VaultClosedError,
  VaultLockError,
} from "./vault/session-vault.js";
export type { SessionVault, OpenVaultOptions, CoherenceStrategy } from "./vault/session-vault.js";
