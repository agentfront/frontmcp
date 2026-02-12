import { InternalMcpError } from './mcp.error';

/**
 * Thrown when encryption context is not set.
 */
export class EncryptionContextNotSetError extends InternalMcpError {
  constructor() {
    super('Encryption context is not set', 'ENCRYPTION_CONTEXT_NOT_SET');
  }
}

/**
 * Thrown when loading a vault fails.
 */
export class VaultLoadError extends InternalMcpError {
  readonly originalError?: Error;

  constructor(vaultId: string, originalError?: Error) {
    super(`Failed to load vault "${vaultId}"${originalError ? `: ${originalError.message}` : ''}`, 'VAULT_LOAD_ERROR');
    this.originalError = originalError;
  }
}

/**
 * Thrown when a vault entity is not found.
 */
export class VaultNotFoundError extends InternalMcpError {
  constructor(entityType: string, id: string) {
    super(`${entityType} "${id}" not found in vault`, 'VAULT_NOT_FOUND');
  }
}

/**
 * Thrown when a token is not available (e.g., expired, not yet obtained).
 */
export class TokenNotAvailableError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'TOKEN_NOT_AVAILABLE');
  }
}

/**
 * Thrown when a token store is required but not configured.
 */
export class TokenStoreRequiredError extends InternalMcpError {
  constructor(context: string) {
    super(`Token store is required for ${context}`, 'TOKEN_STORE_REQUIRED');
  }
}

/**
 * Thrown when no provider ID is available.
 */
export class NoProviderIdError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'NO_PROVIDER_ID');
  }
}

/**
 * Thrown when a potential token leak is detected.
 */
export class TokenLeakDetectedError extends InternalMcpError {
  constructor(detail: string) {
    super(`Token leak detected: ${detail}`, 'TOKEN_LEAK_DETECTED');
  }
}

/**
 * Thrown when a session secret is required but not configured.
 */
export class SessionSecretRequiredError extends InternalMcpError {
  constructor(component: string) {
    super(`Session secret is required for ${component}`, 'SESSION_SECRET_REQUIRED');
  }
}

/**
 * Thrown when a credential provider is already registered.
 */
export class CredentialProviderAlreadyRegisteredError extends InternalMcpError {
  constructor(name: string) {
    super(`Credential provider "${name}" is already registered`, 'CREDENTIAL_PROVIDER_ALREADY_REGISTERED');
  }
}

/**
 * Thrown when auth providers are not configured.
 */
export class AuthProvidersNotConfiguredError extends InternalMcpError {
  constructor() {
    super('Auth providers are not configured', 'AUTH_PROVIDERS_NOT_CONFIGURED');
  }
}

/**
 * Thrown when orchestrated auth is not available.
 */
export class OrchestratedAuthNotAvailableError extends InternalMcpError {
  constructor() {
    super('Orchestrated auth is not available', 'ORCHESTRATED_AUTH_NOT_AVAILABLE');
  }
}

/**
 * Thrown when encryption key is not configured.
 */
export class EncryptionKeyNotConfiguredError extends InternalMcpError {
  constructor() {
    super('Encryption key is not configured', 'ENCRYPTION_KEY_NOT_CONFIGURED');
  }
}

/**
 * Thrown when session ID is empty.
 */
export class SessionIdEmptyError extends InternalMcpError {
  constructor(storeName: string) {
    super(`Session ID must not be empty (${storeName})`, 'SESSION_ID_EMPTY');
  }
}

/**
 * Thrown when elicitation secret is required but not configured.
 */
export class ElicitationSecretRequiredError extends InternalMcpError {
  constructor() {
    super('Elicitation secret is required', 'ELICITATION_SECRET_REQUIRED');
  }
}

/**
 * Thrown when scope access is denied for a provider.
 */
export class ScopedDeniedError extends InternalMcpError {
  constructor(providerId: string) {
    super(`Scope access denied for provider "${providerId}"`, 'SCOPED_DENIED');
  }
}

/**
 * Thrown when an in-memory store is required but not available.
 */
export class InMemoryStoreRequiredError extends InternalMcpError {
  constructor(component: string) {
    super(`In-memory store is required for ${component}`, 'INMEMORY_STORE_REQUIRED');
  }
}

/**
 * Thrown when orchestrator JWKS is not available.
 */
export class OrchestratorJwksNotAvailableError extends InternalMcpError {
  constructor() {
    super('Orchestrator JWKS is not available', 'ORCHESTRATOR_JWKS_NOT_AVAILABLE');
  }
}
