/**
 * AuthProvidersVault & AuthProvidersAccessorImpl Tests
 *
 * Tests for the vault storage layer and runtime accessor implementation
 * that manage auth provider credentials, caching, vault storage,
 * lazy loading, and header generation.
 */

import { AuthProvidersVault } from '../auth-providers.vault';
import { AuthProvidersAccessorImpl } from '../auth-providers.accessor.impl';
import { AuthProvidersRegistry } from '../auth-providers.registry';
import { CredentialCache } from '../credential-cache';
import { LazyCredentialLoader } from '../credential-loaders/lazy-loader';
import { AuthInvalidInputError, CredentialStorageError } from '../../errors/auth-internal.errors';
import type { AuthorizationVault, Credential, AppCredential } from '../../session';
import type { CredentialFactoryContext, ResolvedCredential, CredentialScope } from '../auth-providers.types';
import type { AuthLogger } from '../../common/auth-logger.interface';

// ============================================
// Helpers
// ============================================

/**
 * Create a mock AuthLogger.
 */
function mockLogger(): AuthLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

/**
 * Create a mock AuthorizationVault.
 */
function mockBaseVault(): jest.Mocked<AuthorizationVault> {
  return {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateConsent: jest.fn(),
    authorizeApp: jest.fn(),
    createPendingAuth: jest.fn(),
    getPendingAuth: jest.fn(),
    completePendingAuth: jest.fn(),
    cancelPendingAuth: jest.fn(),
    isAppAuthorized: jest.fn(),
    getPendingAuths: jest.fn(),
    addAppCredential: jest.fn(),
    removeAppCredential: jest.fn(),
    getAppCredentials: jest.fn(),
    getCredential: jest.fn(),
    getAllCredentials: jest.fn(),
    updateCredential: jest.fn(),
    shouldStoreCredential: jest.fn(),
    invalidateCredential: jest.fn(),
    refreshOAuthCredential: jest.fn(),
    cleanup: jest.fn(),
  } as jest.Mocked<AuthorizationVault>;
}

/**
 * Create a bearer credential.
 */
function bearerCredential(token = 'test-token', expiresAt?: number): Credential {
  return { type: 'bearer', token, expiresAt } as Credential;
}

/**
 * Create an OAuth credential.
 */
function oauthCredential(
  accessToken = 'access-tok',
  opts: { refreshToken?: string; expiresAt?: number; tokenType?: string } = {},
): Credential {
  return {
    type: 'oauth',
    accessToken,
    refreshToken: opts.refreshToken,
    tokenType: opts.tokenType ?? 'Bearer',
    expiresAt: opts.expiresAt,
    scopes: [],
  } as Credential;
}

/**
 * Create an API key credential.
 */
function apiKeyCredential(key = 'api-key-123', headerName = 'X-API-Key', headerPrefix?: string): Credential {
  return { type: 'api_key', key, headerName, headerPrefix } as Credential;
}

/**
 * Create a basic auth credential.
 */
function basicCredential(username = 'user', password = 'pass', encodedValue?: string): Credential {
  return { type: 'basic', username, password, encodedValue } as Credential;
}

/**
 * Create a custom credential.
 */
function customCredential(headers?: Record<string, string>): Credential {
  return { type: 'custom', customType: 'test', data: {}, headers } as Credential;
}

/**
 * Create a mock ResolvedCredential.
 */
function mockResolved(
  providerId: string,
  credential: Credential,
  scope: CredentialScope = 'session',
  opts: { expiresAt?: number; isValid?: boolean } = {},
): ResolvedCredential {
  return {
    credential,
    providerId,
    acquiredAt: Date.now(),
    expiresAt: opts.expiresAt,
    isValid: opts.isValid ?? true,
    scope,
  };
}

/**
 * Create a mock CredentialFactoryContext.
 */
function mockContext(overrides: Partial<CredentialFactoryContext> = {}): CredentialFactoryContext {
  return {
    sessionId: 'session-123',
    userSub: 'user-456',
    vault: mockBaseVault(),
    ...overrides,
  };
}

// ============================================
// AuthProvidersVault Tests
// ============================================

describe('AuthProvidersVault', () => {
  let vault: AuthProvidersVault;
  let baseVault: jest.Mocked<AuthorizationVault>;
  let logger: AuthLogger;

  beforeEach(() => {
    baseVault = mockBaseVault();
    logger = mockLogger();
    vault = new AuthProvidersVault(baseVault, 'authproviders:', logger);
  });

  // --------------------------------------------------
  // Constructor
  // --------------------------------------------------

  describe('constructor', () => {
    it('should create a vault with default namespace', () => {
      const v = new AuthProvidersVault(baseVault);
      // Verify it works by calling buildVaultKey indirectly
      expect(v).toBeDefined();
    });

    it('should create a vault with custom namespace', () => {
      const v = new AuthProvidersVault(baseVault, 'custom:');
      expect(v).toBeDefined();
    });

    it('should create a vault without logger', () => {
      const v = new AuthProvidersVault(baseVault, 'ns:');
      expect(v).toBeDefined();
    });
  });

  // --------------------------------------------------
  // storeCredential
  // --------------------------------------------------

  describe('storeCredential', () => {
    it('should store a credential with session scope', async () => {
      const cred = bearerCredential('tok-1');

      await vault.storeCredential('sess-1', 'github', cred, 'session');

      expect(baseVault.addAppCredential).toHaveBeenCalledTimes(1);
      const [vaultKey, appCred] = baseVault.addAppCredential.mock.calls[0];
      expect(vaultKey).toBe('authproviders:session:sess-1');
      expect(appCred.appId).toBe('authproviders:');
      expect(appCred.providerId).toBe('github');
      expect(appCred.credential).toBe(cred);
      expect(appCred.isValid).toBe(true);
      expect(appCred.acquiredAt).toBeDefined();
    });

    it('should store a credential with global scope', async () => {
      const cred = bearerCredential('tok-global');

      await vault.storeCredential('sess-1', 'openai', cred, 'global');

      const [vaultKey] = baseVault.addAppCredential.mock.calls[0];
      expect(vaultKey).toBe('authproviders:global');
    });

    it('should store a credential with user scope', async () => {
      const cred = bearerCredential('tok-user');

      await vault.storeCredential('sess-1', 'jira', cred, 'user', 'user-42');

      const [vaultKey] = baseVault.addAppCredential.mock.calls[0];
      expect(vaultKey).toBe('authproviders:user:user-42');
    });

    it('should throw AuthInvalidInputError when user scope lacks userId', async () => {
      const cred = bearerCredential();

      await expect(vault.storeCredential('sess-1', 'provider', cred, 'user')).rejects.toThrow(AuthInvalidInputError);
    });

    it('should extract expiry from OAuth credential', async () => {
      const cred = oauthCredential('tok', { expiresAt: 9999999 });

      await vault.storeCredential('sess-1', 'google', cred, 'session');

      const [, appCred] = baseVault.addAppCredential.mock.calls[0];
      expect(appCred.expiresAt).toBe(9999999);
    });

    it('should set undefined expiresAt for credentials without expiry', async () => {
      const cred = apiKeyCredential();

      await vault.storeCredential('sess-1', 'stripe', cred, 'session');

      const [, appCred] = baseVault.addAppCredential.mock.calls[0];
      expect(appCred.expiresAt).toBeUndefined();
    });

    it('should log debug message on success', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential(), 'session');

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('github'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('session'));
    });

    it('should log warning and re-throw on storage error', async () => {
      const error = new Error('Storage failed');
      baseVault.addAppCredential.mockRejectedValue(error);

      await expect(vault.storeCredential('sess-1', 'github', bearerCredential(), 'session')).rejects.toThrow(
        'Storage failed',
      );

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // getCredential
  // --------------------------------------------------

  describe('getCredential', () => {
    it('should return credential when found and valid', async () => {
      const cred = bearerCredential('found-tok');
      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: cred,
        acquiredAt: Date.now(),
        isValid: true,
      } as AppCredential);

      const result = await vault.getCredential('sess-1', 'github', 'session');

      expect(result).toBe(cred);
      expect(baseVault.getCredential).toHaveBeenCalledWith('authproviders:session:sess-1', 'authproviders:', 'github');
    });

    it('should return null when credential is not found', async () => {
      baseVault.getCredential.mockResolvedValue(null);

      const result = await vault.getCredential('sess-1', 'nonexistent', 'session');

      expect(result).toBeNull();
    });

    it('should return null when credential is marked invalid', async () => {
      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: bearerCredential(),
        acquiredAt: Date.now(),
        isValid: false,
      } as AppCredential);

      const result = await vault.getCredential('sess-1', 'github', 'session');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('invalid'));
    });

    it('should return null when credential has expired', async () => {
      const pastTime = Date.now() - 1000;
      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: bearerCredential('tok', pastTime),
        acquiredAt: Date.now() - 5000,
        isValid: true,
        expiresAt: pastTime,
      } as AppCredential);

      const result = await vault.getCredential('sess-1', 'github', 'session');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('expired'));
    });

    it('should return credential when expiresAt is in the future', async () => {
      const futureTime = Date.now() + 60000;
      const cred = bearerCredential('tok', futureTime);
      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: cred,
        acquiredAt: Date.now(),
        isValid: true,
        expiresAt: futureTime,
      } as AppCredential);

      const result = await vault.getCredential('sess-1', 'github', 'session');

      expect(result).toBe(cred);
    });

    it('should use global scope key', async () => {
      baseVault.getCredential.mockResolvedValue(null);

      await vault.getCredential('sess-1', 'prov', 'global');

      expect(baseVault.getCredential).toHaveBeenCalledWith('authproviders:global', 'authproviders:', 'prov');
    });

    it('should use user scope key with userId', async () => {
      baseVault.getCredential.mockResolvedValue(null);

      await vault.getCredential('sess-1', 'prov', 'user', 'uid-1');

      expect(baseVault.getCredential).toHaveBeenCalledWith('authproviders:user:uid-1', 'authproviders:', 'prov');
    });

    it('should throw AuthInvalidInputError for user scope without userId', async () => {
      await expect(vault.getCredential('sess-1', 'prov', 'user')).rejects.toThrow(AuthInvalidInputError);
    });

    it('should wrap non-CredentialStorageError in CredentialStorageError', async () => {
      baseVault.getCredential.mockRejectedValue(new Error('generic error'));

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(CredentialStorageError);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should re-throw CredentialStorageError as-is', async () => {
      const storageError = new CredentialStorageError('storage problem');
      baseVault.getCredential.mockRejectedValue(storageError);

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(storageError);
    });

    it('should handle non-Error thrown values', async () => {
      baseVault.getCredential.mockRejectedValue('string-error');

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(CredentialStorageError);
    });
  });

  // --------------------------------------------------
  // removeCredential
  // --------------------------------------------------

  describe('removeCredential', () => {
    it('should remove credential via baseVault', async () => {
      await vault.removeCredential('sess-1', 'github', 'session');

      expect(baseVault.removeAppCredential).toHaveBeenCalledWith(
        'authproviders:session:sess-1',
        'authproviders:',
        'github',
      );
    });

    it('should log debug on success', async () => {
      await vault.removeCredential('sess-1', 'github', 'session');

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Removed'));
    });

    it('should swallow errors and log warning', async () => {
      baseVault.removeAppCredential.mockRejectedValue(new Error('remove failed'));

      // Should not throw
      await vault.removeCredential('sess-1', 'github', 'session');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should use global scope key', async () => {
      await vault.removeCredential('sess-1', 'prov', 'global');

      expect(baseVault.removeAppCredential).toHaveBeenCalledWith('authproviders:global', 'authproviders:', 'prov');
    });

    it('should use user scope key', async () => {
      await vault.removeCredential('sess-1', 'prov', 'user', 'uid-1');

      expect(baseVault.removeAppCredential).toHaveBeenCalledWith('authproviders:user:uid-1', 'authproviders:', 'prov');
    });
  });

  // --------------------------------------------------
  // invalidateCredential
  // --------------------------------------------------

  describe('invalidateCredential', () => {
    it('should invalidate credential via baseVault', async () => {
      await vault.invalidateCredential('sess-1', 'github', 'session', 'token revoked');

      expect(baseVault.invalidateCredential).toHaveBeenCalledWith(
        'authproviders:session:sess-1',
        'authproviders:',
        'github',
        'token revoked',
      );
    });

    it('should log debug on success', async () => {
      await vault.invalidateCredential('sess-1', 'github', 'session', 'expired');

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Invalidated'));
    });

    it('should swallow errors and log warning', async () => {
      baseVault.invalidateCredential.mockRejectedValue(new Error('invalidate failed'));

      await vault.invalidateCredential('sess-1', 'github', 'session', 'reason');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // refreshOAuthCredential
  // --------------------------------------------------

  describe('refreshOAuthCredential', () => {
    it('should refresh via baseVault', async () => {
      const tokens = { accessToken: 'new-tok', refreshToken: 'new-ref', expiresAt: 99999 };

      await vault.refreshOAuthCredential('sess-1', 'google', 'session', tokens);

      expect(baseVault.refreshOAuthCredential).toHaveBeenCalledWith(
        'authproviders:session:sess-1',
        'authproviders:',
        'google',
        tokens,
      );
    });

    it('should log debug on success', async () => {
      await vault.refreshOAuthCredential('sess-1', 'google', 'session', { accessToken: 'tok' });

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Refreshed'));
    });

    it('should log warning and re-throw on error', async () => {
      baseVault.refreshOAuthCredential.mockRejectedValue(new Error('refresh failed'));

      await expect(vault.refreshOAuthCredential('sess-1', 'google', 'session', { accessToken: 'tok' })).rejects.toThrow(
        'refresh failed',
      );

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // getAllCredentials
  // --------------------------------------------------

  describe('getAllCredentials', () => {
    const mockAppCred = (id: string): AppCredential =>
      ({
        appId: 'authproviders:',
        providerId: id,
        credential: bearerCredential(),
        acquiredAt: Date.now(),
        isValid: true,
      }) as AppCredential;

    it('should return credentials for a specific scope', async () => {
      const creds = [mockAppCred('github')];
      baseVault.getAppCredentials.mockResolvedValue(creds);

      const result = await vault.getAllCredentials('sess-1', 'session');

      expect(result).toEqual(creds);
      expect(baseVault.getAppCredentials).toHaveBeenCalledWith('authproviders:session:sess-1', 'authproviders:');
    });

    it('should return empty array when scope query fails', async () => {
      baseVault.getAppCredentials.mockRejectedValue(new Error('fetch failed'));

      const result = await vault.getAllCredentials('sess-1', 'global');

      expect(result).toEqual([]);
    });

    it('should aggregate credentials from all scopes when no scope specified', async () => {
      const sessionCreds = [mockAppCred('sess-prov')];
      const globalCreds = [mockAppCred('glob-prov')];

      baseVault.getAppCredentials
        .mockResolvedValueOnce(sessionCreds) // session scope
        .mockResolvedValueOnce(globalCreds); // global scope

      const result = await vault.getAllCredentials('sess-1', undefined, undefined);

      // Should include session + global (no user since no userId)
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([...sessionCreds, ...globalCreds]));
    });

    it('should include user-scoped credentials when userId is provided', async () => {
      const sessionCreds = [mockAppCred('sess-prov')];
      const userCreds = [mockAppCred('user-prov')];
      const globalCreds = [mockAppCred('glob-prov')];

      baseVault.getAppCredentials
        .mockResolvedValueOnce(sessionCreds) // session scope
        .mockResolvedValueOnce(userCreds) // user scope
        .mockResolvedValueOnce(globalCreds); // global scope

      const result = await vault.getAllCredentials('sess-1', undefined, 'user-42');

      expect(result).toHaveLength(3);
    });

    it('should gracefully handle errors in individual scope queries', async () => {
      const globalCreds = [mockAppCred('glob-prov')];

      baseVault.getAppCredentials
        .mockRejectedValueOnce(new Error('session failed')) // session scope fails
        .mockResolvedValueOnce(globalCreds); // global scope succeeds

      const result = await vault.getAllCredentials('sess-1', undefined, undefined);

      // Should still have global creds despite session failure
      expect(result).toEqual(globalCreds);
    });

    it('should return empty array when all scope queries fail', async () => {
      baseVault.getAppCredentials.mockRejectedValue(new Error('all failed'));

      const result = await vault.getAllCredentials('sess-1', undefined, undefined);

      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------
  // buildVaultKey (tested indirectly through public methods)
  // --------------------------------------------------

  describe('buildVaultKey (via storeCredential)', () => {
    it('should build session key pattern', async () => {
      await vault.storeCredential('my-session', 'prov', bearerCredential(), 'session');

      const [key] = baseVault.addAppCredential.mock.calls[0];
      expect(key).toBe('authproviders:session:my-session');
    });

    it('should build global key pattern', async () => {
      await vault.storeCredential('any-session', 'prov', bearerCredential(), 'global');

      const [key] = baseVault.addAppCredential.mock.calls[0];
      expect(key).toBe('authproviders:global');
    });

    it('should build user key pattern', async () => {
      await vault.storeCredential('any-session', 'prov', bearerCredential(), 'user', 'uid-99');

      const [key] = baseVault.addAppCredential.mock.calls[0];
      expect(key).toBe('authproviders:user:uid-99');
    });

    it('should use custom namespace in keys', async () => {
      const customVault = new AuthProvidersVault(baseVault, 'custom:');

      await customVault.storeCredential('sess-1', 'prov', bearerCredential(), 'session');

      const [key] = baseVault.addAppCredential.mock.calls[0];
      expect(key).toBe('custom:session:sess-1');
    });

    it('should throw AuthInvalidInputError for user scope without userId', async () => {
      await expect(vault.storeCredential('sess-1', 'prov', bearerCredential(), 'user')).rejects.toThrow(
        AuthInvalidInputError,
      );
    });

    it('should throw AuthInvalidInputError for unknown scope', async () => {
      await expect(
        vault.storeCredential('sess-1', 'prov', bearerCredential(), 'unknown' as CredentialScope),
      ).rejects.toThrow(AuthInvalidInputError);
    });
  });

  // --------------------------------------------------
  // DI Token
  // --------------------------------------------------

  describe('AUTH_PROVIDERS_VAULT token', () => {
    it('should be exported as a symbol', async () => {
      const { AUTH_PROVIDERS_VAULT } = await import('../auth-providers.vault');
      expect(typeof AUTH_PROVIDERS_VAULT).toBe('symbol');
      expect(AUTH_PROVIDERS_VAULT.toString()).toContain('frontmcp:AUTH_PROVIDERS_VAULT');
    });
  });
});

// ============================================
// AuthProvidersAccessorImpl Tests
// ============================================

describe('AuthProvidersAccessorImpl', () => {
  let accessor: AuthProvidersAccessorImpl;
  let registry: AuthProvidersRegistry;
  let vaultInstance: AuthProvidersVault;
  let baseVault: jest.Mocked<AuthorizationVault>;
  let cache: CredentialCache;
  let loader: LazyCredentialLoader;
  let context: CredentialFactoryContext;
  let logger: AuthLogger;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000000);

    baseVault = mockBaseVault();
    registry = new AuthProvidersRegistry();
    vaultInstance = new AuthProvidersVault(baseVault, 'authproviders:');
    cache = new CredentialCache();
    logger = mockLogger();
    loader = new LazyCredentialLoader(logger);
    context = mockContext({ vault: baseVault });

    accessor = new AuthProvidersAccessorImpl(registry, vaultInstance, cache, loader, context, logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------
  // get
  // --------------------------------------------------

  describe('get', () => {
    it('should return null for unregistered provider', async () => {
      const result = await accessor.get('nonexistent');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    });

    it('should return cached credential when available and valid', async () => {
      const cred = bearerCredential('cached-tok');
      const resolved = mockResolved('github', cred, 'session');

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });
      cache.set('github', resolved);

      const result = await accessor.get('github');

      expect(result).toEqual(resolved);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    });

    it('should skip cache when forceRefresh is true', async () => {
      const cred = bearerCredential('cached');
      const resolved = mockResolved('github', cred, 'session');
      cache.set('github', resolved);

      const newCred = bearerCredential('new-tok');
      const factory = jest.fn().mockResolvedValue(newCred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      // Vault also returns null so it falls through to loader
      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.get('github', { forceRefresh: true });

      expect(result).toBeDefined();
      expect(factory).toHaveBeenCalled();
    });

    it('should load from vault when cache misses', async () => {
      const cred = bearerCredential('vault-tok');
      const factory = jest.fn();

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: cred,
        acquiredAt: Date.now(),
        isValid: true,
      } as AppCredential);

      const result = await accessor.get('github');

      expect(result).toBeDefined();
      expect(result?.credential).toEqual(cred);
      expect(factory).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Vault hit'));
    });

    it('should load via factory when cache and vault both miss', async () => {
      const cred = bearerCredential('factory-tok');
      const factory = jest.fn().mockResolvedValue(cred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.get('github');

      expect(result).toBeDefined();
      expect(result?.credential).toBe(cred);
      expect(factory).toHaveBeenCalled();
    });

    it('should return null when factory returns null', async () => {
      const factory = jest.fn().mockResolvedValue(null);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.get('github');

      expect(result).toBeNull();
    });

    it('should store loaded credential in vault and cache', async () => {
      const cred = bearerCredential('new-tok');
      const factory = jest.fn().mockResolvedValue(cred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue(null);

      await accessor.get('github');

      // Should have stored in vault
      expect(baseVault.addAppCredential).toHaveBeenCalled();
      // Should be in cache now
      expect(cache.has('github')).toBe(true);
    });

    it('should skip expired cached credential', async () => {
      const expiredCred = bearerCredential('old-tok');
      const expired = mockResolved('github', expiredCred, 'session', {
        expiresAt: Date.now() - 1000,
        isValid: true,
      });
      cache.set('github', expired);

      const newCred = bearerCredential('new-tok');
      const factory = jest.fn().mockResolvedValue(newCred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.get('github');

      expect(result).toBeDefined();
      expect(factory).toHaveBeenCalled();
    });

    it('should skip invalid cached credential', async () => {
      const invalidCred = bearerCredential('bad-tok');
      const invalid = mockResolved('github', invalidCred, 'session', { isValid: false });
      cache.set('github', invalid);

      const newCred = bearerCredential('good-tok');
      const factory = jest.fn().mockResolvedValue(newCred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.get('github');

      expect(result).toBeDefined();
      expect(factory).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // getMany
  // --------------------------------------------------

  describe('getMany', () => {
    it('should load multiple credentials in parallel', async () => {
      const cred1 = bearerCredential('tok-1');
      const cred2 = bearerCredential('tok-2');

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred1),
      });
      registry.register({
        name: 'openai',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred2),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const results = await accessor.getMany(['github', 'openai']);

      expect(results.size).toBe(2);
      expect(results.get('github')).toBeDefined();
      expect(results.get('openai')).toBeDefined();
    });

    it('should handle mixed results (some null)', async () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(bearerCredential()),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const results = await accessor.getMany(['github', 'nonexistent']);

      expect(results.get('github')).toBeDefined();
      expect(results.get('nonexistent')).toBeNull();
    });

    it('should handle failures gracefully', async () => {
      registry.register({
        name: 'failing',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockRejectedValue(new Error('fail')),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const results = await accessor.getMany(['failing']);

      // Failed providers should not appear in results (allSettled catches them)
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return empty map for empty input', async () => {
      const results = await accessor.getMany([]);

      expect(results.size).toBe(0);
    });
  });

  // --------------------------------------------------
  // headers
  // --------------------------------------------------

  describe('headers', () => {
    it('should return empty headers when provider not found', async () => {
      const result = await accessor.headers('nonexistent');

      expect(result).toEqual({});
    });

    it('should use custom toHeaders when defined', async () => {
      const cred = bearerCredential('custom-tok');
      const customHeaders = { 'X-Custom': 'custom-value' };

      registry.register({
        name: 'custom-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
        toHeaders: jest.fn().mockReturnValue(customHeaders),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('custom-prov');

      expect(result).toEqual(customHeaders);
    });

    it('should generate Bearer header for oauth credential', async () => {
      const cred = oauthCredential('access-123', { tokenType: 'Bearer' });

      registry.register({
        name: 'google',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('google');

      expect(result).toEqual({ Authorization: 'Bearer access-123' });
    });

    it('should generate Bearer header for bearer credential', async () => {
      const cred = bearerCredential('my-bearer-tok');

      registry.register({
        name: 'prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('prov');

      expect(result).toEqual({ Authorization: 'Bearer my-bearer-tok' });
    });

    it('should generate API key header without prefix', async () => {
      const cred = apiKeyCredential('key-abc', 'X-API-Key');

      registry.register({
        name: 'stripe',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('stripe');

      expect(result).toEqual({ 'X-API-Key': 'key-abc' });
    });

    it('should generate API key header with prefix', async () => {
      const cred = apiKeyCredential('key-abc', 'Authorization', 'Bearer ');

      registry.register({
        name: 'api-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('api-prov');

      expect(result).toEqual({ Authorization: 'Bearer key-abc' });
    });

    it('should generate Basic auth header', async () => {
      const cred = basicCredential('admin', 'secret');

      registry.register({
        name: 'basic-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('basic-prov');

      expect(result['Authorization']).toMatch(/^Basic /);
    });

    it('should use pre-encoded value for Basic auth when available', async () => {
      const cred = basicCredential('admin', 'secret', 'pre-encoded-value');

      registry.register({
        name: 'basic-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('basic-prov');

      expect(result).toEqual({ Authorization: 'Basic pre-encoded-value' });
    });

    it('should return custom credential headers', async () => {
      const cred = customCredential({ 'X-Custom-Auth': 'my-token' });

      registry.register({
        name: 'custom',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('custom');

      expect(result).toEqual({ 'X-Custom-Auth': 'my-token' });
    });

    it('should return empty headers for custom credential without headers', async () => {
      const cred = customCredential(undefined);

      registry.register({
        name: 'custom-no-headers',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('custom-no-headers');

      expect(result).toEqual({});
    });

    it('should return empty headers for ssh_key credential', async () => {
      const cred = { type: 'ssh_key', privateKey: 'key-data', keyType: 'ed25519' } as Credential;

      registry.register({
        name: 'ssh',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('ssh');

      expect(result).toEqual({});
    });

    it('should return empty headers for mtls credential', async () => {
      const cred = { type: 'mtls', certificate: 'cert', privateKey: 'key' } as Credential;

      registry.register({
        name: 'mtls-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('mtls-prov');

      expect(result).toEqual({});
    });

    it('should return empty headers for private_key credential', async () => {
      const cred = { type: 'private_key', format: 'pem', keyData: 'key-data' } as Credential;

      registry.register({
        name: 'pk-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('pk-prov');

      expect(result).toEqual({});
    });

    it('should return empty headers for service_account credential', async () => {
      const cred = { type: 'service_account', provider: 'gcp', credentials: {} } as Credential;

      registry.register({
        name: 'sa-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('sa-prov');

      expect(result).toEqual({});
    });

    it('should generate header for oauth_pkce credential', async () => {
      const cred = {
        type: 'oauth_pkce',
        accessToken: 'pkce-tok',
        tokenType: 'Bearer',
        scopes: [],
      } as Credential;

      registry.register({
        name: 'pkce-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headers('pkce-prov');

      expect(result).toEqual({ Authorization: 'Bearer pkce-tok' });
    });
  });

  // --------------------------------------------------
  // headersMany
  // --------------------------------------------------

  describe('headersMany', () => {
    it('should merge headers from multiple providers', async () => {
      const bearerCred = bearerCredential('tok-1');
      const apiCred = apiKeyCredential('key-1', 'X-API-Key');

      registry.register({
        name: 'bearer-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(bearerCred),
      });
      registry.register({
        name: 'api-prov',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(apiCred),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headersMany(['bearer-prov', 'api-prov']);

      expect(result).toEqual({
        Authorization: 'Bearer tok-1',
        'X-API-Key': 'key-1',
      });
    });

    it('should handle empty provider list', async () => {
      const result = await accessor.headersMany([]);

      expect(result).toEqual({});
    });

    it('should override conflicting headers with later provider', async () => {
      const cred1 = bearerCredential('tok-1');
      const cred2 = bearerCredential('tok-2');

      registry.register({
        name: 'prov1',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred1),
      });
      registry.register({
        name: 'prov2',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(cred2),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.headersMany(['prov1', 'prov2']);

      expect(result['Authorization']).toBe('Bearer tok-2');
    });
  });

  // --------------------------------------------------
  // refresh
  // --------------------------------------------------

  describe('refresh', () => {
    it('should return null for unregistered provider', async () => {
      const result = await accessor.refresh('nonexistent');

      expect(result).toBeNull();
    });

    it('should refresh credential via loader', async () => {
      const oldCred = bearerCredential('old-tok');
      const newCred = bearerCredential('new-tok');
      const factory = jest.fn().mockResolvedValue(newCred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      // Put old credential in cache
      cache.set('github', mockResolved('github', oldCred, 'session'));

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.refresh('github');

      expect(result).toBeDefined();
      expect(result?.credential).toBe(newCred);
    });

    it('should store refreshed credential in vault and cache', async () => {
      const newCred = bearerCredential('refreshed-tok');
      const factory = jest.fn().mockResolvedValue(newCred);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
      });

      await accessor.refresh('github');

      expect(baseVault.addAppCredential).toHaveBeenCalled();
      expect(cache.has('github')).toBe(true);
    });

    it('should return null when refresh returns null', async () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockResolvedValue(null),
      });

      const result = await accessor.refresh('github');

      expect(result).toBeNull();
    });

    it('should return null and log warning when refresh throws', async () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn().mockRejectedValue(new Error('refresh failed')),
      });

      const result = await accessor.refresh('github');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should use existing cached credential as context for refresh', async () => {
      const oldCred = bearerCredential('old');
      const newCred = bearerCredential('new');

      const refreshFn = jest.fn().mockResolvedValue(newCred);
      const factory = jest.fn();

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory,
        refresh: refreshFn,
      });

      cache.set('github', mockResolved('github', oldCred, 'session'));

      await accessor.refresh('github');

      // The refresh function should have been called (via loader)
      expect(refreshFn).toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // has
  // --------------------------------------------------

  describe('has', () => {
    it('should return true when valid credential is in cache', async () => {
      const cred = bearerCredential('tok');
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      cache.set('github', mockResolved('github', cred, 'session'));

      const result = await accessor.has('github');

      expect(result).toBe(true);
    });

    it('should return false for unregistered provider', async () => {
      const result = await accessor.has('nonexistent');

      expect(result).toBe(false);
    });

    it('should invalidate expired cached credential and check vault', async () => {
      const expiredCred = bearerCredential('old');
      const expired = mockResolved('github', expiredCred, 'session', {
        expiresAt: Date.now() - 1000,
      });
      cache.set('github', expired);

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.has('github');

      expect(result).toBe(false);
    });

    it('should check vault when cache is empty', async () => {
      const cred = bearerCredential('vault-tok');

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: cred,
        acquiredAt: Date.now(),
        isValid: true,
      } as AppCredential);

      const result = await accessor.has('github');

      expect(result).toBe(true);
    });

    it('should return false when vault credential is invalid', async () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      baseVault.getCredential.mockResolvedValue({
        appId: 'authproviders:',
        providerId: 'github',
        credential: bearerCredential(),
        acquiredAt: Date.now(),
        isValid: false,
      } as AppCredential);

      const result = await accessor.has('github');

      // isValid false means vault returns null, so loadFromVault returns null
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------
  // isRegistered
  // --------------------------------------------------

  describe('isRegistered', () => {
    it('should return true for registered provider', () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      expect(accessor.isRegistered('github')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(accessor.isRegistered('nonexistent')).toBe(false);
    });
  });

  // --------------------------------------------------
  // invalidate
  // --------------------------------------------------

  describe('invalidate', () => {
    it('should invalidate a cached credential', () => {
      cache.set('github', mockResolved('github', bearerCredential(), 'session'));

      accessor.invalidate('github');

      expect(cache.has('github')).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Invalidated'));
    });

    it('should be safe to invalidate non-existent provider', () => {
      // Should not throw
      accessor.invalidate('nonexistent');
    });
  });

  // --------------------------------------------------
  // invalidateAll
  // --------------------------------------------------

  describe('invalidateAll', () => {
    it('should invalidate all cached credentials', () => {
      cache.set('github', mockResolved('github', bearerCredential(), 'session'));
      cache.set('openai', mockResolved('openai', bearerCredential(), 'session'));

      accessor.invalidateAll();

      expect(cache.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('all'));
    });
  });

  // --------------------------------------------------
  // listProviders
  // --------------------------------------------------

  describe('listProviders', () => {
    it('should return all registered provider names', () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });
      registry.register({
        name: 'openai',
        scope: 'global',
        loading: 'eager',
        factory: jest.fn(),
      });

      const result = accessor.listProviders();

      expect(result).toHaveLength(2);
      expect(result).toContain('github');
      expect(result).toContain('openai');
    });

    it('should return empty array when no providers registered', () => {
      expect(accessor.listProviders()).toEqual([]);
    });
  });

  // --------------------------------------------------
  // listAvailable
  // --------------------------------------------------

  describe('listAvailable', () => {
    it('should return only providers with available credentials', async () => {
      const cred = bearerCredential('tok');

      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });
      registry.register({
        name: 'openai',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      // Only github has a cached credential
      cache.set('github', mockResolved('github', cred, 'session'));

      // openai not in vault either
      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.listAvailable();

      expect(result).toEqual(['github']);
    });

    it('should return empty array when no credentials available', async () => {
      registry.register({
        name: 'github',
        scope: 'session',
        loading: 'lazy',
        factory: jest.fn(),
      });

      baseVault.getCredential.mockResolvedValue(null);

      const result = await accessor.listAvailable();

      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------
  // AUTH_PROVIDERS_ACCESSOR token
  // --------------------------------------------------

  describe('AUTH_PROVIDERS_ACCESSOR token', () => {
    it('should be exported as a symbol', async () => {
      const { AUTH_PROVIDERS_ACCESSOR } = await import('../auth-providers.accessor');
      expect(typeof AUTH_PROVIDERS_ACCESSOR).toBe('symbol');
      expect(AUTH_PROVIDERS_ACCESSOR.toString()).toContain('frontmcp:AUTH_PROVIDERS_ACCESSOR');
    });
  });
});
