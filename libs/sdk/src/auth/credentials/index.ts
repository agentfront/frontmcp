// auth/credentials/index.ts (Checkpoint 3b)

// DI providers + vault token
export { SESSION_CREDENTIAL_VAULT, createCredentialsProviders, resolveRequestSub } from './credentials.providers';

// Context extension (`this.credentials`)
export { credentialsContextExtension, getCredentials, tryGetCredentials } from './credentials.context-extension';
