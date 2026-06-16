// Key Provider abstraction
export type { KeyProvider, KeyProviderError, KeyProviderType, OnePasswordConfig, SecretsConfig, CentientConfig } from "./types.js";
export {
  KeychainProvider,
  DEFAULT_KEYCHAIN_SERVICE,
  DEFAULT_KEYCHAIN_ACCOUNT,
} from "./keychain-provider.js";
export type { KeychainProviderOptions } from "./keychain-provider.js";
export { OnePasswordProvider } from "./onepassword-provider.js";
export {
  PassphraseProvider,
  DEFAULT_PASSPHRASE_KDF_PARAMS,
  DEFAULT_PASSPHRASE_VAULT_PATH,
  PASSPHRASE_KDF,
  PASSPHRASE_METADATA_VERSION,
  PASSPHRASE_SALT_LENGTH,
  PASSPHRASE_VERIFIER_ALGORITHM,
  PASSPHRASE_VERIFIER_CONTEXT,
  passphraseMetadataPathForVault,
  derivePassphraseKey,
} from "./passphrase-provider.js";
export type {
  PassphraseKdfParams,
  PassphraseMetadata,
  PassphrasePrompt,
  PassphraseProviderOptions,
} from "./passphrase-provider.js";
export { resolveKeyProvider, getProviderByType, loadConfig, saveSecretsConfig } from "./resolve.js";
export type { ResolveKeyProviderOptions } from "./resolve.js";
