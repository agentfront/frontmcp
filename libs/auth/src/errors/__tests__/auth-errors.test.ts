/**
 * Auth Errors Tests
 */
import { AuthInternalError } from '../auth-internal.error';
import {
  EncryptionContextNotSetError,
  VaultLoadError,
  VaultNotFoundError,
  TokenNotAvailableError,
  TokenStoreRequiredError,
  NoProviderIdError,
  TokenLeakDetectedError,
  SessionSecretRequiredError,
  CredentialProviderAlreadyRegisteredError,
  AuthProvidersNotConfiguredError,
  OrchestratedAuthNotAvailableError,
  EncryptionKeyNotConfiguredError,
  SessionIdEmptyError,
  ElicitationSecretRequiredError,
  ScopeDeniedError,
  InMemoryStoreRequiredError,
  OrchestratorJwksNotAvailableError,
  AuthInvalidInputError,
  CredentialStorageError,
  AuthFlowError,
} from '../auth-internal.errors';

// ============================================
// Base AuthInternalError
// ============================================

describe('AuthInternalError (base)', () => {
  // We cannot instantiate abstract class directly, so we test via a subclass
  it('should have errorId starting with "err_"', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.errorId).toMatch(/^err_/);
  });

  it('should have errorId of expected length (err_ + 16 hex chars)', () => {
    const err = new EncryptionContextNotSetError();
    // err_ (4 chars) + hex of 8 bytes (16 chars) = 20 chars
    expect(err.errorId.length).toBe(20);
  });

  it('should generate unique errorIds', () => {
    const ids = new Set(Array.from({ length: 20 }, () => new EncryptionContextNotSetError().errorId));
    expect(ids.size).toBe(20);
  });

  it('should have isPublic=false', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.isPublic).toBe(false);
  });

  it('should have statusCode=500', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.statusCode).toBe(500);
  });

  it('should have a code property', () => {
    const err = new EncryptionContextNotSetError();
    expect(typeof err.code).toBe('string');
  });

  it('should set name to constructor name', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.name).toBe('EncryptionContextNotSetError');
  });

  it('should return public message with error ID', () => {
    const err = new EncryptionContextNotSetError();
    const msg = err.getPublicMessage();
    expect(msg).toContain('Internal auth error');
    expect(msg).toContain(err.errorId);
  });

  it('should return internal message (actual error message)', () => {
    const err = new TokenNotAvailableError('Token expired');
    expect(err.getInternalMessage()).toBe('Token expired');
  });

  it('should be an instance of Error', () => {
    const err = new EncryptionContextNotSetError();
    expect(err).toBeInstanceOf(Error);
  });

  it('should have a stack trace', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});

// ============================================
// Error Subclass Tests
// ============================================

describe('EncryptionContextNotSetError', () => {
  it('should have code ENCRYPTION_CONTEXT_NOT_SET', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.code).toBe('ENCRYPTION_CONTEXT_NOT_SET');
  });

  it('should have correct name', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.name).toBe('EncryptionContextNotSetError');
  });

  it('should be instanceof AuthInternalError', () => {
    const err = new EncryptionContextNotSetError();
    expect(err).toBeInstanceOf(AuthInternalError);
  });

  it('should have message about encryption context', () => {
    const err = new EncryptionContextNotSetError();
    expect(err.message).toContain('Encryption context');
  });
});

describe('VaultLoadError', () => {
  it('should have code VAULT_LOAD_ERROR', () => {
    const err = new VaultLoadError('vault-1');
    expect(err.code).toBe('VAULT_LOAD_ERROR');
  });

  it('should include vault ID in message', () => {
    const err = new VaultLoadError('vault-42');
    expect(err.message).toContain('vault-42');
  });

  it('should include original error message when provided', () => {
    const original = new Error('connection refused');
    const err = new VaultLoadError('vault-1', original);
    expect(err.message).toContain('connection refused');
    expect(err.originalError).toBe(original);
  });

  it('should set originalError to undefined when not provided', () => {
    const err = new VaultLoadError('vault-1');
    expect(err.originalError).toBeUndefined();
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new VaultLoadError('v1')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name VaultLoadError', () => {
    expect(new VaultLoadError('v1').name).toBe('VaultLoadError');
  });
});

describe('VaultNotFoundError', () => {
  it('should have code VAULT_NOT_FOUND', () => {
    const err = new VaultNotFoundError('Session', 'sess-1');
    expect(err.code).toBe('VAULT_NOT_FOUND');
  });

  it('should include entity type and id in message', () => {
    const err = new VaultNotFoundError('Token', 'tok-123');
    expect(err.message).toContain('Token');
    expect(err.message).toContain('tok-123');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new VaultNotFoundError('A', 'B')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name VaultNotFoundError', () => {
    expect(new VaultNotFoundError('A', 'B').name).toBe('VaultNotFoundError');
  });
});

describe('TokenNotAvailableError', () => {
  it('should have code TOKEN_NOT_AVAILABLE', () => {
    const err = new TokenNotAvailableError('Token expired');
    expect(err.code).toBe('TOKEN_NOT_AVAILABLE');
  });

  it('should use provided message', () => {
    const err = new TokenNotAvailableError('No valid token found');
    expect(err.message).toBe('No valid token found');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new TokenNotAvailableError('msg')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name TokenNotAvailableError', () => {
    expect(new TokenNotAvailableError('msg').name).toBe('TokenNotAvailableError');
  });
});

describe('TokenStoreRequiredError', () => {
  it('should have code TOKEN_STORE_REQUIRED', () => {
    const err = new TokenStoreRequiredError('session management');
    expect(err.code).toBe('TOKEN_STORE_REQUIRED');
  });

  it('should include context in message', () => {
    const err = new TokenStoreRequiredError('OAuth flow');
    expect(err.message).toContain('OAuth flow');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new TokenStoreRequiredError('ctx')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name TokenStoreRequiredError', () => {
    expect(new TokenStoreRequiredError('ctx').name).toBe('TokenStoreRequiredError');
  });
});

describe('NoProviderIdError', () => {
  it('should have code NO_PROVIDER_ID', () => {
    const err = new NoProviderIdError('No provider ID configured');
    expect(err.code).toBe('NO_PROVIDER_ID');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new NoProviderIdError('msg')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name NoProviderIdError', () => {
    expect(new NoProviderIdError('msg').name).toBe('NoProviderIdError');
  });
});

describe('TokenLeakDetectedError', () => {
  it('should have code TOKEN_LEAK_DETECTED', () => {
    const err = new TokenLeakDetectedError('token exposed in log');
    expect(err.code).toBe('TOKEN_LEAK_DETECTED');
  });

  it('should include detail in message', () => {
    const err = new TokenLeakDetectedError('token in URL params');
    expect(err.message).toContain('token in URL params');
    expect(err.message).toContain('Token leak detected');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new TokenLeakDetectedError('d')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name TokenLeakDetectedError', () => {
    expect(new TokenLeakDetectedError('d').name).toBe('TokenLeakDetectedError');
  });
});

describe('SessionSecretRequiredError', () => {
  it('should have code SESSION_SECRET_REQUIRED', () => {
    const err = new SessionSecretRequiredError('session encryption');
    expect(err.code).toBe('SESSION_SECRET_REQUIRED');
  });

  it('should include component in message', () => {
    const err = new SessionSecretRequiredError('session ID encryption');
    expect(err.message).toContain('session ID encryption');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new SessionSecretRequiredError('c')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name SessionSecretRequiredError', () => {
    expect(new SessionSecretRequiredError('c').name).toBe('SessionSecretRequiredError');
  });
});

describe('CredentialProviderAlreadyRegisteredError', () => {
  it('should have code CREDENTIAL_PROVIDER_ALREADY_REGISTERED', () => {
    const err = new CredentialProviderAlreadyRegisteredError('google');
    expect(err.code).toBe('CREDENTIAL_PROVIDER_ALREADY_REGISTERED');
  });

  it('should include provider name in message', () => {
    const err = new CredentialProviderAlreadyRegisteredError('github');
    expect(err.message).toContain('github');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new CredentialProviderAlreadyRegisteredError('x')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name CredentialProviderAlreadyRegisteredError', () => {
    expect(new CredentialProviderAlreadyRegisteredError('x').name).toBe('CredentialProviderAlreadyRegisteredError');
  });
});

describe('AuthProvidersNotConfiguredError', () => {
  it('should have code AUTH_PROVIDERS_NOT_CONFIGURED', () => {
    const err = new AuthProvidersNotConfiguredError();
    expect(err.code).toBe('AUTH_PROVIDERS_NOT_CONFIGURED');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new AuthProvidersNotConfiguredError()).toBeInstanceOf(AuthInternalError);
  });

  it('should have name AuthProvidersNotConfiguredError', () => {
    expect(new AuthProvidersNotConfiguredError().name).toBe('AuthProvidersNotConfiguredError');
  });
});

describe('OrchestratedAuthNotAvailableError', () => {
  it('should have code ORCHESTRATED_AUTH_NOT_AVAILABLE', () => {
    const err = new OrchestratedAuthNotAvailableError();
    expect(err.code).toBe('ORCHESTRATED_AUTH_NOT_AVAILABLE');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new OrchestratedAuthNotAvailableError()).toBeInstanceOf(AuthInternalError);
  });

  it('should have name OrchestratedAuthNotAvailableError', () => {
    expect(new OrchestratedAuthNotAvailableError().name).toBe('OrchestratedAuthNotAvailableError');
  });
});

describe('EncryptionKeyNotConfiguredError', () => {
  it('should have code ENCRYPTION_KEY_NOT_CONFIGURED', () => {
    const err = new EncryptionKeyNotConfiguredError();
    expect(err.code).toBe('ENCRYPTION_KEY_NOT_CONFIGURED');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new EncryptionKeyNotConfiguredError()).toBeInstanceOf(AuthInternalError);
  });

  it('should have name EncryptionKeyNotConfiguredError', () => {
    expect(new EncryptionKeyNotConfiguredError().name).toBe('EncryptionKeyNotConfiguredError');
  });
});

describe('SessionIdEmptyError', () => {
  it('should have code SESSION_ID_EMPTY', () => {
    const err = new SessionIdEmptyError('RedisSessionStore');
    expect(err.code).toBe('SESSION_ID_EMPTY');
  });

  it('should include store name in message', () => {
    const err = new SessionIdEmptyError('MemoryStore');
    expect(err.message).toContain('MemoryStore');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new SessionIdEmptyError('s')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name SessionIdEmptyError', () => {
    expect(new SessionIdEmptyError('s').name).toBe('SessionIdEmptyError');
  });
});

describe('ElicitationSecretRequiredError', () => {
  it('should have code ELICITATION_SECRET_REQUIRED', () => {
    const err = new ElicitationSecretRequiredError();
    expect(err.code).toBe('ELICITATION_SECRET_REQUIRED');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new ElicitationSecretRequiredError()).toBeInstanceOf(AuthInternalError);
  });

  it('should have name ElicitationSecretRequiredError', () => {
    expect(new ElicitationSecretRequiredError().name).toBe('ElicitationSecretRequiredError');
  });
});

describe('ScopeDeniedError', () => {
  it('should have code SCOPE_DENIED', () => {
    const err = new ScopeDeniedError('google-provider');
    expect(err.code).toBe('SCOPE_DENIED');
  });

  it('should include provider ID in message', () => {
    const err = new ScopeDeniedError('auth0-provider');
    expect(err.message).toContain('auth0-provider');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new ScopeDeniedError('p')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name ScopeDeniedError', () => {
    expect(new ScopeDeniedError('p').name).toBe('ScopeDeniedError');
  });
});

describe('InMemoryStoreRequiredError', () => {
  it('should have code INMEMORY_STORE_REQUIRED', () => {
    const err = new InMemoryStoreRequiredError('session store');
    expect(err.code).toBe('INMEMORY_STORE_REQUIRED');
  });

  it('should include component in message', () => {
    const err = new InMemoryStoreRequiredError('elicitation');
    expect(err.message).toContain('elicitation');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new InMemoryStoreRequiredError('c')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name InMemoryStoreRequiredError', () => {
    expect(new InMemoryStoreRequiredError('c').name).toBe('InMemoryStoreRequiredError');
  });
});

describe('OrchestratorJwksNotAvailableError', () => {
  it('should have code ORCHESTRATOR_JWKS_NOT_AVAILABLE', () => {
    const err = new OrchestratorJwksNotAvailableError();
    expect(err.code).toBe('ORCHESTRATOR_JWKS_NOT_AVAILABLE');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new OrchestratorJwksNotAvailableError()).toBeInstanceOf(AuthInternalError);
  });

  it('should have name OrchestratorJwksNotAvailableError', () => {
    expect(new OrchestratorJwksNotAvailableError().name).toBe('OrchestratorJwksNotAvailableError');
  });
});

describe('AuthInvalidInputError', () => {
  it('should have code AUTH_INVALID_INPUT', () => {
    const err = new AuthInvalidInputError('Missing required field');
    expect(err.code).toBe('AUTH_INVALID_INPUT');
  });

  it('should use provided message', () => {
    const err = new AuthInvalidInputError('Invalid redirect_uri');
    expect(err.message).toBe('Invalid redirect_uri');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new AuthInvalidInputError('msg')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name AuthInvalidInputError', () => {
    expect(new AuthInvalidInputError('msg').name).toBe('AuthInvalidInputError');
  });
});

describe('CredentialStorageError', () => {
  it('should have code CREDENTIAL_STORAGE_ERROR', () => {
    const err = new CredentialStorageError('Write failed');
    expect(err.code).toBe('CREDENTIAL_STORAGE_ERROR');
  });

  it('should use provided message', () => {
    const err = new CredentialStorageError('Encryption failed');
    expect(err.message).toBe('Encryption failed');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new CredentialStorageError('msg')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name CredentialStorageError', () => {
    expect(new CredentialStorageError('msg').name).toBe('CredentialStorageError');
  });
});

describe('AuthFlowError', () => {
  it('should have code AUTH_FLOW_ERROR by default', () => {
    const err = new AuthFlowError('Flow failed');
    expect(err.code).toBe('AUTH_FLOW_ERROR');
  });

  it('should accept custom code', () => {
    const err = new AuthFlowError('Custom flow error', 'CUSTOM_FLOW_CODE');
    expect(err.code).toBe('CUSTOM_FLOW_CODE');
  });

  it('should use provided message', () => {
    const err = new AuthFlowError('OAuth callback failed');
    expect(err.message).toBe('OAuth callback failed');
  });

  it('should be instanceof AuthInternalError', () => {
    expect(new AuthFlowError('msg')).toBeInstanceOf(AuthInternalError);
  });

  it('should have name AuthFlowError', () => {
    expect(new AuthFlowError('msg').name).toBe('AuthFlowError');
  });
});
