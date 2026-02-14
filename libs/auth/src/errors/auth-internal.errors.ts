import { AuthInternalError } from './auth-internal.error';

/**
 * Thrown when encryption context is not set.
 */
export class EncryptionContextNotSetError extends AuthInternalError {
  constructor() {
    super('Encryption context is not set', 'ENCRYPTION_CONTEXT_NOT_SET');
  }
}

/**
 * Thrown when loading a vault fails.
 */
export class VaultLoadError extends AuthInternalError {
  readonly originalError?: Error;

  constructor(vaultId: string, originalError?: Error) {
    super(`Failed to load vault "${vaultId}"${originalError ? `: ${originalError.message}` : ''}`, 'VAULT_LOAD_ERROR');
    this.originalError = originalError;
  }
}

/**
 * Thrown when a vault entity is not found.
 */
export class VaultNotFoundError extends AuthInternalError {
  constructor(entityType: string, id: string) {
    super(`${entityType} "${id}" not found in vault`, 'VAULT_NOT_FOUND');
  }
}

/**
 * Thrown when a token is not available (e.g., expired, not yet obtained).
 */
export class TokenNotAvailableError extends AuthInternalError {
  constructor(message: string) {
    super(message, 'TOKEN_NOT_AVAILABLE');
  }
}

/**
 * Thrown when a token store is required but not configured.
 */
export class TokenStoreRequiredError extends AuthInternalError {
  constructor(context: string) {
    super(`Token store is required for ${context}`, 'TOKEN_STORE_REQUIRED');
  }
}

/**
 * Thrown when no provider ID is available.
 */
export class NoProviderIdError extends AuthInternalError {
  constructor(message: string) {
    super(message, 'NO_PROVIDER_ID');
  }
}

/**
 * Thrown when a potential token leak is detected.
 */
export class TokenLeakDetectedError extends AuthInternalError {
  constructor(detail: string) {
    super(`Token leak detected: ${detail}`, 'TOKEN_LEAK_DETECTED');
  }
}

/**
 * Thrown when a session secret is required but not configured.
 */
export class SessionSecretRequiredError extends AuthInternalError {
  constructor(component: string) {
    super(`Session secret is required for ${component}`, 'SESSION_SECRET_REQUIRED');
  }
}

/**
 * Thrown when a credential provider is already registered.
 */
export class CredentialProviderAlreadyRegisteredError extends AuthInternalError {
  constructor(name: string) {
    super(`Credential provider "${name}" is already registered`, 'CREDENTIAL_PROVIDER_ALREADY_REGISTERED');
  }
}

/**
 * Thrown when auth providers are not configured.
 */
export class AuthProvidersNotConfiguredError extends AuthInternalError {
  constructor() {
    super('Auth providers are not configured', 'AUTH_PROVIDERS_NOT_CONFIGURED');
  }
}

/**
 * Thrown when orchestrated auth is not available.
 */
export class OrchestratedAuthNotAvailableError extends AuthInternalError {
  constructor() {
    super('Orchestrated auth is not available', 'ORCHESTRATED_AUTH_NOT_AVAILABLE');
  }
}

/**
 * Thrown when encryption key is not configured.
 */
export class EncryptionKeyNotConfiguredError extends AuthInternalError {
  constructor() {
    super('Encryption key is not configured', 'ENCRYPTION_KEY_NOT_CONFIGURED');
  }
}

/**
 * Thrown when session ID is empty.
 */
export class SessionIdEmptyError extends AuthInternalError {
  constructor(storeName: string) {
    super(`Session ID must not be empty (${storeName})`, 'SESSION_ID_EMPTY');
  }
}

/**
 * Thrown when elicitation secret is required but not configured.
 */
export class ElicitationSecretRequiredError extends AuthInternalError {
  constructor() {
    super('Elicitation secret is required', 'ELICITATION_SECRET_REQUIRED');
  }
}

/**
 * Thrown when scope access is denied for a provider.
 */
export class ScopeDeniedError extends AuthInternalError {
  constructor(providerId: string) {
    super(`Scope access denied for provider "${providerId}"`, 'SCOPE_DENIED');
  }
}

/**
 * Thrown when an in-memory store is required but not available.
 */
export class InMemoryStoreRequiredError extends AuthInternalError {
  constructor(component: string) {
    super(`In-memory store is required for ${component}`, 'INMEMORY_STORE_REQUIRED');
  }
}

/**
 * Thrown when orchestrator JWKS is not available.
 */
export class OrchestratorJwksNotAvailableError extends AuthInternalError {
  constructor() {
    super('Orchestrator JWKS is not available', 'ORCHESTRATOR_JWKS_NOT_AVAILABLE');
  }
}

/**
 * Thrown when invalid input is provided to an auth operation.
 */
export class AuthInvalidInputError extends AuthInternalError {
  constructor(message: string) {
    super(message, 'AUTH_INVALID_INPUT');
  }
}

/**
 * Thrown when a credential storage operation fails.
 */
export class CredentialStorageError extends AuthInternalError {
  constructor(message: string) {
    super(message, 'CREDENTIAL_STORAGE_ERROR');
  }
}

/**
 * Thrown when a federated auth flow encounters an error.
 */
export class AuthFlowError extends AuthInternalError {
  constructor(message: string, code = 'AUTH_FLOW_ERROR') {
    super(message, code);
  }
}
