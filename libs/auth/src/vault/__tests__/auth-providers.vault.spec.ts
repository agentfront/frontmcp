/**
 * AuthProvidersVault & AuthProvidersAccessorImpl Tests
 *
 * Tests for the vault storage layer and runtime accessor implementation
 * that manage auth provider credentials, caching, vault storage,
 * lazy loading, and header generation.
 */

import { MAX_TTL_SECONDS, MemoryStorageAdapter } from '@frontmcp/utils';

import type { AuthLogger } from '../../common/auth-logger.interface';
import { AuthInvalidInputError, CredentialStorageError } from '../../errors/auth-internal.errors';
import type { AppCredential, AuthorizationVault, Credential } from '../../session';
import { AuthProvidersAccessorImpl } from '../auth-providers.accessor.impl';
import { AuthProvidersRegistry } from '../auth-providers.registry';
import type { CredentialFactoryContext, CredentialScope, ResolvedCredential } from '../auth-providers.types';
import { AuthProvidersVault, UNIDENTIFIED_SESSION_PREFIX } from '../auth-providers.vault';
import { CredentialCache } from '../credential-cache';
import { LazyCredentialLoader } from '../credential-loaders/lazy-loader';

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

async function memoryStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter({ enableSweeper: false });
  await storage.connect();
  return storage;
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
  let storage: MemoryStorageAdapter;
  let vault: AuthProvidersVault;
  let logger: AuthLogger;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    storage = await memoryStorage();
    logger = mockLogger();
    vault = new AuthProvidersVault(storage, { logger });
  });

  afterEach(async () => {
    await storage.disconnect();
    jest.useRealTimers();
  });

  describe('storeCredential', () => {
    it('keeps a credential for a later read', async () => {
      const cred = bearerCredential('tok-1');
      await vault.storeCredential('sess-1', 'github', cred, 'session');

      jest.advanceTimersByTime(30 * 60_000);

      expect(await vault.getCredential('sess-1', 'github', 'session')).toEqual(cred);
    });

    it('records the provider, the namespace and when it was acquired', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential('tok-1'), 'global');

      expect(await vault.getAllCredentials('sess-1', 'global')).toEqual([
        {
          appId: 'authproviders:',
          providerId: 'github',
          credential: bearerCredential('tok-1'),
          acquiredAt: 1_000_000,
          isValid: true,
        },
      ]);
    });

    it('keeps a credential without an expiry for an hour by default', async () => {
      await vault.storeCredential('sess-1', 'stripe', apiKeyCredential(), 'global');

      expect(await storage.ttl('authproviders:global:stripe')).toBe(3600);
      jest.advanceTimersByTime(3600_000);
      expect(await vault.getCredential('sess-1', 'stripe', 'global')).toBeNull();
      expect(await storage.keys('*')).toEqual([]);
    });

    it('keeps a credential without an expiry for defaultCacheTtl', async () => {
      const shortVault = new AuthProvidersVault(storage, { defaultCacheTtl: 60_000 });
      await shortVault.storeCredential('sess-1', 'stripe', apiKeyCredential(), 'global');

      jest.advanceTimersByTime(59_000);
      expect(await shortVault.getCredential('sess-1', 'stripe', 'global')).toEqual(apiKeyCredential());
      jest.advanceTimersByTime(1_000);
      expect(await shortVault.getCredential('sess-1', 'stripe', 'global')).toBeNull();
    });

    it('keeps a credential without an expiry for the cacheTtl it is given', async () => {
      await vault.storeCredential('sess-1', 'stripe', apiKeyCredential(), 'global', undefined, 30_000);

      expect(await storage.ttl('authproviders:global:stripe')).toBe(30);
    });

    it('falls back to the default when defaultCacheTtl or cacheTtl is 0', async () => {
      const zeroVault = new AuthProvidersVault(storage, { defaultCacheTtl: 0 });
      await zeroVault.storeCredential('sess-1', 'stripe', apiKeyCredential(), 'global', undefined, 0);

      expect(await storage.ttl('authproviders:global:stripe')).toBe(3600);
    });

    it('keeps a credential with an expiry until it expires, whatever cacheTtl says', async () => {
      const expiresAt = Date.now() + 2 * 3600_000;
      await vault.storeCredential(
        'sess-1',
        'google',
        oauthCredential('tok', { expiresAt }),
        'global',
        undefined,
        60_000,
      );

      expect(await storage.ttl('authproviders:global:google')).toBe(7200);
      jest.advanceTimersByTime(2 * 3600_000 - 1);
      expect(await vault.getCredential('sess-1', 'google', 'global')).not.toBeNull();
      jest.advanceTimersByTime(1);
      expect(await vault.getCredential('sess-1', 'google', 'global')).toBeNull();
    });

    it('keeps a credential that expires beyond the longest TTL for the longest TTL', async () => {
      const expiresAt = Date.now() + (MAX_TTL_SECONDS + 60) * 1000;
      await vault.storeCredential('sess-1', 'google', bearerCredential('tok', expiresAt), 'global');

      expect(await storage.ttl('authproviders:global:google')).toBe(MAX_TTL_SECONDS);
    });

    it('does not keep an expired credential, and drops the one it replaces', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential('live'), 'global');
      await vault.storeCredential('sess-1', 'github', bearerCredential('dead', Date.now() - 1), 'global');

      expect(await vault.getCredential('sess-1', 'github', 'global')).toBeNull();
      expect(await storage.keys('*')).toEqual([]);
    });

    it('does not keep a session credential of a caller without a verified session', async () => {
      const unidentified = `${UNIDENTIFIED_SESSION_PREFIX}request-1`;

      await vault.storeCredential(unidentified, 'github', bearerCredential(), 'session');

      expect(await storage.keys('*')).toEqual([]);
      expect(await vault.getCredential(unidentified, 'github', 'session')).toBeNull();
    });

    it('keeps a global credential acquired by a caller without a verified session', async () => {
      await vault.storeCredential(`${UNIDENTIFIED_SESSION_PREFIX}request-1`, 'openai', bearerCredential(), 'global');

      expect(await vault.getCredential(`${UNIDENTIFIED_SESSION_PREFIX}request-2`, 'openai', 'global')).toEqual(
        bearerCredential(),
      );
    });

    it('uses the namespace it is given', async () => {
      await new AuthProvidersVault(storage, { namespace: 'custom:' }).storeCredential(
        'sess-1',
        'github',
        bearerCredential(),
        'global',
      );

      expect(await storage.keys('*')).toEqual(['custom:global:github']);
    });

    it('logs what it stored', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential(), 'session');

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('github'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('session'));
    });

    it('logs and re-throws a storage error', async () => {
      jest.spyOn(storage, 'set').mockRejectedValue(new Error('Storage failed'));

      await expect(vault.storeCredential('sess-1', 'github', bearerCredential(), 'session')).rejects.toThrow(
        'Storage failed',
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('throws AuthInvalidInputError for a user credential without a user id', async () => {
      await expect(vault.storeCredential('sess-1', 'jira', bearerCredential(), 'user')).rejects.toThrow(
        AuthInvalidInputError,
      );
    });

    it('throws AuthInvalidInputError for an unknown scope', async () => {
      await expect(
        vault.storeCredential('sess-1', 'prov', bearerCredential(), 'unknown' as CredentialScope),
      ).rejects.toThrow(AuthInvalidInputError);
    });
  });

  describe('scopes', () => {
    it("keeps user A's credential from user B", async () => {
      await vault.storeCredential('sess-1', 'jira', bearerCredential('alice-tok'), 'user', 'alice');

      expect(await vault.getCredential('sess-1', 'jira', 'user', 'bob')).toBeNull();
      expect(await vault.getCredential('sess-2', 'jira', 'user', 'alice')).toEqual(bearerCredential('alice-tok'));
    });

    it("keeps session X's credential from session Y", async () => {
      await vault.storeCredential('session-x', 'github', bearerCredential('x-tok'), 'session', 'alice');

      expect(await vault.getCredential('session-y', 'github', 'session', 'alice')).toBeNull();
      expect(await vault.getCredential('session-x', 'github', 'session', 'bob')).toEqual(bearerCredential('x-tok'));
    });

    it('shares a global credential between sessions and users', async () => {
      await vault.storeCredential('sess-1', 'openai', bearerCredential('shared'), 'global', 'alice');

      expect(await vault.getCredential('sess-2', 'openai', 'global', 'bob')).toEqual(bearerCredential('shared'));
      expect(await vault.getCredential('sess-3', 'openai', 'global')).toEqual(bearerCredential('shared'));
    });

    it("never lets one user id reach another user's keys", async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential('a-b-tok'), 'user', 'a:b');

      expect(await vault.getCredential('sess-1', 'b:github', 'user', 'a')).toBeNull();
      expect(await vault.getAllCredentials('sess-1', 'user', 'a')).toEqual([]);
      expect(await vault.getAllCredentials('sess-1', 'user', 'a*')).toEqual([]);
    });
  });

  describe('getCredential', () => {
    it('answers null for a credential it does not have', async () => {
      expect(await vault.getCredential('sess-1', 'nonexistent', 'session')).toBeNull();
    });

    it('throws AuthInvalidInputError for a user credential without a user id', async () => {
      await expect(vault.getCredential('sess-1', 'prov', 'user')).rejects.toThrow(AuthInvalidInputError);
    });

    it('wraps a storage error in CredentialStorageError', async () => {
      jest.spyOn(storage, 'get').mockRejectedValue(new Error('generic error'));

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(CredentialStorageError);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('re-throws a CredentialStorageError as it is', async () => {
      const storageError = new CredentialStorageError('storage problem');
      jest.spyOn(storage, 'get').mockRejectedValue(storageError);

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(storageError);
    });

    it('wraps a thrown value that is not an Error', async () => {
      jest.spyOn(storage, 'get').mockRejectedValue('string-error');

      await expect(vault.getCredential('sess-1', 'prov', 'session')).rejects.toThrow(CredentialStorageError);
    });
  });

  describe('removeCredential', () => {
    it('removes a credential', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential(), 'user', 'alice');

      await vault.removeCredential('sess-1', 'github', 'user', 'alice');

      expect(await vault.getCredential('sess-1', 'github', 'user', 'alice')).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Removed'));
    });

    it('logs a storage error instead of throwing it', async () => {
      jest.spyOn(storage, 'delete').mockRejectedValue(new Error('remove failed'));

      await vault.removeCredential('sess-1', 'github', 'session');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('invalidateCredential', () => {
    it('keeps the credential, marked invalid with the reason, and stops serving it', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential(), 'session');

      await vault.invalidateCredential('sess-1', 'github', 'session', 'token revoked');

      expect(await vault.getCredential('sess-1', 'github', 'session')).toBeNull();
      expect(await vault.getAllCredentials('sess-1', 'session')).toEqual([
        expect.objectContaining({ providerId: 'github', isValid: false, invalidReason: 'token revoked' }),
      ]);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('marked as invalid'));
    });

    it('does nothing for a credential it does not have', async () => {
      await vault.invalidateCredential('sess-1', 'github', 'session', 'expired');

      expect(await storage.keys('*')).toEqual([]);
    });

    it('logs a storage error instead of throwing it', async () => {
      jest.spyOn(storage, 'get').mockRejectedValue(new Error('invalidate failed'));

      await vault.invalidateCredential('sess-1', 'github', 'session', 'reason');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('refreshOAuthCredential', () => {
    it('replaces the tokens and expiry, keeps the refresh token, and serves it again', async () => {
      const expiresAt = Date.now() + 60_000;
      await vault.storeCredential(
        'sess-1',
        'google',
        oauthCredential('old', { refreshToken: 'r1', expiresAt }),
        'session',
      );
      await vault.invalidateCredential('sess-1', 'google', 'session', 'expired');
      const newExpiry = Date.now() + 2 * 3600_000;

      await vault.refreshOAuthCredential('sess-1', 'google', 'session', { accessToken: 'new', expiresAt: newExpiry });

      expect(await vault.getCredential('sess-1', 'google', 'session')).toEqual(
        oauthCredential('new', { refreshToken: 'r1', expiresAt: newExpiry }),
      );
      jest.advanceTimersByTime(3600_000);
      expect(await vault.getCredential('sess-1', 'google', 'session')).not.toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Refreshed'));
    });

    it('takes a new refresh token', async () => {
      await vault.storeCredential('sess-1', 'google', oauthCredential('old', { refreshToken: 'r1' }), 'global');

      await vault.refreshOAuthCredential('sess-1', 'google', 'global', { accessToken: 'new', refreshToken: 'r2' });

      expect(await vault.getCredential('sess-1', 'google', 'global')).toEqual(
        oauthCredential('new', { refreshToken: 'r2' }),
      );
    });

    it('leaves a credential that is not OAuth as it is', async () => {
      await vault.storeCredential('sess-1', 'github', bearerCredential('tok'), 'global');

      await vault.refreshOAuthCredential('sess-1', 'github', 'global', { accessToken: 'new' });

      expect(await vault.getCredential('sess-1', 'github', 'global')).toEqual(bearerCredential('tok'));
    });

    it('does nothing for a credential it does not have', async () => {
      await vault.refreshOAuthCredential('sess-1', 'google', 'session', { accessToken: 'tok' });

      expect(await storage.keys('*')).toEqual([]);
    });

    it('logs and re-throws a storage error', async () => {
      jest.spyOn(storage, 'get').mockRejectedValue(new Error('refresh failed'));

      await expect(vault.refreshOAuthCredential('sess-1', 'google', 'session', { accessToken: 'tok' })).rejects.toThrow(
        'refresh failed',
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('getAllCredentials', () => {
    beforeEach(async () => {
      await vault.storeCredential('session-x', 'github', bearerCredential('x'), 'session');
      await vault.storeCredential('session-y', 'github', bearerCredential('y'), 'session');
      await vault.storeCredential('session-x', 'jira', bearerCredential('alice'), 'user', 'alice');
      await vault.storeCredential('session-x', 'jira', bearerCredential('bob'), 'user', 'bob');
      await vault.storeCredential('session-x', 'openai', bearerCredential('shared'), 'global');
    });

    const tokensOf = (credentials: AppCredential[]) =>
      credentials.map((each) => `${each.providerId}=${(each.credential as { token: string }).token}`);

    it("lists a session's, its user's and the global credentials, in that order", async () => {
      expect(tokensOf(await vault.getAllCredentials('session-x', undefined, 'alice'))).toEqual([
        'github=x',
        'jira=alice',
        'openai=shared',
      ]);
    });

    it('lists no user credentials without a user id', async () => {
      expect(tokensOf(await vault.getAllCredentials('session-y'))).toEqual(['github=y', 'openai=shared']);
    });

    it('lists one scope', async () => {
      expect(tokensOf(await vault.getAllCredentials('session-y', 'user', 'bob'))).toEqual(['jira=bob']);
    });

    it('answers an empty list when the storage fails', async () => {
      jest.spyOn(storage, 'keys').mockRejectedValue(new Error('fetch failed'));

      expect(await vault.getAllCredentials('session-x', undefined, 'alice')).toEqual([]);
    });
  });

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
  let storage: MemoryStorageAdapter;
  let baseVault: jest.Mocked<AuthorizationVault>;
  let cache: CredentialCache;
  let loader: LazyCredentialLoader;
  let context: CredentialFactoryContext;
  let logger: AuthLogger;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000000);

    storage = await memoryStorage();
    baseVault = mockBaseVault();
    registry = new AuthProvidersRegistry();
    vaultInstance = new AuthProvidersVault(storage);
    cache = new CredentialCache();
    logger = mockLogger();
    loader = new LazyCredentialLoader(logger);
    context = mockContext({ vault: baseVault });

    accessor = new AuthProvidersAccessorImpl(registry, vaultInstance, cache, loader, context, logger);
  });

  afterEach(async () => {
    await storage.disconnect();
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

      await vaultInstance.storeCredential(context.sessionId, 'github', cred, 'session');

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

      await accessor.get('github');

      expect(await vaultInstance.getCredential(context.sessionId, 'github', 'session')).toEqual(cred);
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

      expect(await vaultInstance.getCredential(context.sessionId, 'github', 'session')).toEqual(newCred);
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

      await vaultInstance.storeCredential(context.sessionId, 'github', cred, 'session');

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

      await vaultInstance.storeCredential(context.sessionId, 'github', bearerCredential(), 'session');
      await vaultInstance.invalidateCredential(context.sessionId, 'github', 'session', 'revoked');

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

      const result = await accessor.listAvailable();

      expect(result).toEqual([]);
    });
  });

  describe('across requests', () => {
    const nextRequest = () =>
      new AuthProvidersAccessorImpl(registry, vaultInstance, new CredentialCache(), loader, context, logger);

    it('serves the next request the credential a factory acquired, without running the factory again', async () => {
      const factory = jest.fn().mockResolvedValue(bearerCredential('tok'));
      registry.register({ name: 'github', scope: 'user', loading: 'lazy', factory });

      await accessor.get('github');
      const next = await nextRequest().get('github');

      expect(next?.credential).toEqual(bearerCredential('tok'));
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("runs the factory again once the provider's cacheTtl has passed", async () => {
      const factory = jest.fn().mockResolvedValue(apiKeyCredential());
      registry.register({ name: 'stripe', scope: 'global', loading: 'lazy', cacheTtl: 60_000, factory });

      await accessor.get('stripe');
      jest.advanceTimersByTime(60_000);
      await nextRequest().get('stripe');

      expect(factory).toHaveBeenCalledTimes(2);
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
