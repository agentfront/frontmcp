/**
 * OrchestratedAuthorization Tests
 *
 * Tests the OrchestratedAuthorization class which represents the local auth server mode
 * with secure token storage. Covers create(), mode, getToken() flow (no provider, no store,
 * no tokens, success, refresh), provider management, progressive auth, and error cases.
 */

import { NoProviderIdError, TokenStoreRequiredError, TokenNotAvailableError } from '../../errors/auth-internal.errors';

// ---- Mocks ----

const MOCK_AUTH_ID = 'derived-auth-id-1';
jest.mock('../../utils/authorization-id.utils', () => ({
  deriveAuthorizationId: jest.fn(() => MOCK_AUTH_ID),
}));

jest.mock('@frontmcp/utils', () => ({
  randomBytes: jest.fn(() => new Uint8Array(8)),
  bytesToHex: jest.fn(() => 'deadbeef01234567'),
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

jest.mock('../../session/utils/session-crypto.utils', () => ({
  encryptJson: jest.fn(() => 'encrypted-session'),
}));

jest.mock('../../machine-id', () => ({
  getMachineId: jest.fn(() => 'machine-id-xyz'),
}));

import { OrchestratedAuthorization } from '../orchestrated.authorization';
import type {
  OrchestratedAuthorizationCreateCtx,
  TokenStore,
  TokenRefreshCallback,
} from '../orchestrated.authorization';
import { deriveAuthorizationId } from '../../utils/authorization-id.utils';

// ---- Mock Token Store ----

function createMockTokenStore(overrides: Partial<TokenStore> = {}): TokenStore {
  return {
    getAccessToken: jest.fn().mockResolvedValue(null),
    getRefreshToken: jest.fn().mockResolvedValue(null),
    storeTokens: jest.fn().mockResolvedValue(undefined),
    deleteTokens: jest.fn().mockResolvedValue(undefined),
    hasTokens: jest.fn().mockResolvedValue(false),
    getProviderIds: jest.fn().mockResolvedValue([]),
    migrateTokens: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---- Helpers ----

function createDefaultCtx(
  overrides: Partial<OrchestratedAuthorizationCreateCtx> = {},
): OrchestratedAuthorizationCreateCtx {
  return {
    token: 'local-jwt-token-123',
    user: { sub: 'user-1', name: 'Alice' },
    ...overrides,
  };
}

// ---- Tests ----

describe('OrchestratedAuthorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // create() basic
  // ========================================
  describe('create()', () => {
    it('should create with mode "orchestrated"', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.mode).toBe('orchestrated');
    });

    it('should not be anonymous', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.isAnonymous).toBe(false);
    });

    it('should derive id from token using deriveAuthorizationId', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(deriveAuthorizationId).toHaveBeenCalledWith('local-jwt-token-123');
      expect(auth.id).toBe(MOCK_AUTH_ID);
    });

    it('should set user from context', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.user).toEqual({ sub: 'user-1', name: 'Alice' });
    });

    it('should default scopes to empty array', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.scopes).toEqual([]);
    });

    it('should set custom scopes', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ scopes: ['read', 'write'] }));
      expect(auth.scopes).toEqual(['read', 'write']);
    });

    it('should set claims', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ claims: { iss: 'local', role: 'admin' } }));
      expect(auth.claims).toEqual({ iss: 'local', role: 'admin' });
    });

    it('should set expiresAt', () => {
      const exp = Date.now() + 60000;
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ expiresAt: exp }));
      expect(auth.expiresAt).toBe(exp);
    });

    it('should set primaryProviderId', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ primaryProviderId: 'github' }));
      expect(auth.primaryProviderId).toBe('github');
    });

    it('should build provider states and authorized providers from providers config', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: {
            github: { id: 'github', expiresAt: 999999, secretRefId: 'vault:gh' },
          },
        }),
      );
      expect(auth.authorizedProviders['github']).toBeDefined();
      expect(auth.authorizedProviders['github'].id).toBe('github');
      expect(auth.authorizedProviders['github'].embedMode).toBe('ref');
      expect(auth.authorizedProviders['github'].secretRefId).toBe('vault:gh');
    });

    it('should set embedMode to store-only when no secretRefId', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: {
            github: { id: 'github' },
          },
        }),
      );
      expect(auth.authorizedProviders['github'].embedMode).toBe('store-only');
    });

    it('should derive authorizedProviderIds from providers when not explicit', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: {
            github: { id: 'github' },
            google: { id: 'google' },
          },
        }),
      );
      expect(auth.authorizedProviderIds).toEqual(['github', 'google']);
    });

    it('should use explicit authorizedProviderIds when provided', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: { github: { id: 'github' } },
          authorizedProviderIds: ['github', 'extra-provider'],
        }),
      );
      expect(auth.authorizedProviderIds).toEqual(['github', 'extra-provider']);
    });

    it('should pass through projection fields', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          authorizedTools: { search: { executionPath: ['app1', 'search'] } },
          authorizedToolIds: ['search'],
          authorizedPrompts: { help: { executionPath: ['app1', 'help'] } },
          authorizedPromptIds: ['help'],
          authorizedApps: { slack: { id: 'slack', toolIds: ['send'] } },
          authorizedAppIds: ['slack'],
          authorizedResources: ['file://docs'],
        }),
      );
      expect(auth.authorizedToolIds).toEqual(['search']);
      expect(auth.authorizedPromptIds).toEqual(['help']);
      expect(auth.authorizedAppIds).toEqual(['slack']);
      expect(auth.authorizedResources).toEqual(['file://docs']);
    });
  });

  // ========================================
  // getToken() flow
  // ========================================
  describe('getToken()', () => {
    it('should throw NoProviderIdError when no providerId and no primaryProviderId', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      await expect(auth.getToken()).rejects.toThrow(NoProviderIdError);
    });

    it('should throw TokenStoreRequiredError when no token store configured', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ primaryProviderId: 'github' }));
      await expect(auth.getToken()).rejects.toThrow(TokenStoreRequiredError);
    });

    it('should throw TokenNotAvailableError when no tokens exist for provider', async () => {
      const store = createMockTokenStore({ hasTokens: jest.fn().mockResolvedValue(false) });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({ primaryProviderId: 'github', tokenStore: store }),
      );
      await expect(auth.getToken()).rejects.toThrow(TokenNotAvailableError);
    });

    it('should return access token from store on success', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue('gh-access-token-123'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({ primaryProviderId: 'github', tokenStore: store }),
      );
      const token = await auth.getToken();
      expect(token).toBe('gh-access-token-123');
    });

    it('should use explicit providerId over primaryProviderId', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue('google-token'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({ primaryProviderId: 'github', tokenStore: store }),
      );
      await auth.getToken('google');
      expect(store.hasTokens).toHaveBeenCalledWith(MOCK_AUTH_ID, 'google');
    });

    it('should use primaryProviderId when no providerId given', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue('token'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({ primaryProviderId: 'github', tokenStore: store }),
      );
      await auth.getToken();
      expect(store.hasTokens).toHaveBeenCalledWith(MOCK_AUTH_ID, 'github');
    });
  });

  // ========================================
  // Token refresh flow
  // ========================================
  describe('token refresh flow', () => {
    it('should attempt refresh when access token is null', async () => {
      const onRefresh: TokenRefreshCallback = jest.fn().mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
      });
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue(null),
        getRefreshToken: jest.fn().mockResolvedValue('refresh-token-xyz'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          primaryProviderId: 'github',
          tokenStore: store,
          onTokenRefresh: onRefresh,
        }),
      );

      const token = await auth.getToken();
      expect(token).toBe('new-access-token');
      expect(onRefresh).toHaveBeenCalledWith('github', 'refresh-token-xyz');
    });

    it('should store new tokens after refresh', async () => {
      const onRefresh: TokenRefreshCallback = jest.fn().mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        expiresIn: 7200,
      });
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue(null),
        getRefreshToken: jest.fn().mockResolvedValue('old-rt'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          primaryProviderId: 'github',
          tokenStore: store,
          onTokenRefresh: onRefresh,
        }),
      );

      await auth.getToken();
      expect(store.storeTokens).toHaveBeenCalledWith(
        MOCK_AUTH_ID,
        'github',
        expect.objectContaining({
          accessToken: 'new-at',
          refreshToken: 'new-rt',
        }),
      );
    });

    it('should attempt refresh when provider state shows expired token', async () => {
      const onRefresh: TokenRefreshCallback = jest.fn().mockResolvedValue({
        accessToken: 'refreshed-token',
      });
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue('old-expired-token'),
        getRefreshToken: jest.fn().mockResolvedValue('rt'),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          primaryProviderId: 'github',
          tokenStore: store,
          onTokenRefresh: onRefresh,
          providers: {
            github: { id: 'github', expiresAt: Date.now() - 10000 }, // expired
          },
        }),
      );

      const token = await auth.getToken();
      expect(token).toBe('refreshed-token');
    });

    it('should throw TokenNotAvailableError when refresh not available and no access token', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue(null),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          primaryProviderId: 'github',
          tokenStore: store,
          // no onTokenRefresh
        }),
      );
      await expect(auth.getToken()).rejects.toThrow(TokenNotAvailableError);
    });

    it('should throw TokenNotAvailableError when no refresh token available', async () => {
      const onRefresh: TokenRefreshCallback = jest.fn();
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue(null),
        getRefreshToken: jest.fn().mockResolvedValue(null),
      });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          primaryProviderId: 'github',
          tokenStore: store,
          onTokenRefresh: onRefresh,
        }),
      );
      await expect(auth.getToken()).rejects.toThrow(TokenNotAvailableError);
    });
  });

  // ========================================
  // Provider management
  // ========================================
  describe('provider management', () => {
    it('hasProvider should return true for registered providers', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: { github: { id: 'github' } },
        }),
      );
      expect(auth.hasProvider('github')).toBe(true);
    });

    it('hasProvider should return false for unregistered providers', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.hasProvider('github')).toBe(false);
    });

    it('getProviderIds should return all provider ids', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: {
            github: { id: 'github' },
            google: { id: 'google' },
          },
        }),
      );
      expect(auth.getProviderIds()).toEqual(['github', 'google']);
    });

    it('getProviderIds should return empty array when no providers', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.getProviderIds()).toEqual([]);
    });

    it('addProvider should store tokens and update internal state', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addProvider('newprovider', {
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        expiresIn: 3600,
      });

      expect(store.storeTokens).toHaveBeenCalledWith(
        MOCK_AUTH_ID,
        'newprovider',
        expect.objectContaining({ accessToken: 'at-new', refreshToken: 'rt-new' }),
      );
      expect(auth.hasProvider('newprovider')).toBe(true);
      expect(auth.getProviderIds()).toContain('newprovider');
    });

    it('addProvider should throw TokenStoreRequiredError when no store', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      await expect(auth.addProvider('github', { accessToken: 'at' })).rejects.toThrow(TokenStoreRequiredError);
    });

    it('removeProvider should delete tokens and remove from internal state', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          tokenStore: store,
          providers: { github: { id: 'github' } },
        }),
      );

      expect(auth.hasProvider('github')).toBe(true);
      await auth.removeProvider('github');
      expect(store.deleteTokens).toHaveBeenCalledWith(MOCK_AUTH_ID, 'github');
      expect(auth.hasProvider('github')).toBe(false);
    });

    it('removeProvider should work without token store', async () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          providers: { github: { id: 'github' } },
        }),
      );
      await auth.removeProvider('github');
      expect(auth.hasProvider('github')).toBe(false);
    });
  });

  // ========================================
  // Progressive auth
  // ========================================
  describe('progressive auth', () => {
    it('addAppAuthorization should store tokens with app: prefix', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addAppAuthorization('slack', ['send', 'read'], {
        accessToken: 'slack-at',
        refreshToken: 'slack-rt',
        expiresIn: 3600,
      });

      expect(store.storeTokens).toHaveBeenCalledWith(
        MOCK_AUTH_ID,
        'app:slack',
        expect.objectContaining({ accessToken: 'slack-at' }),
      );
    });

    it('addAppAuthorization should make app authorized', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      expect(auth.isAppAuthorized('slack')).toBe(false);
      await auth.addAppAuthorization('slack', ['send'], { accessToken: 'at' });
      expect(auth.isAppAuthorized('slack')).toBe(true);
    });

    it('getAppToken should return null for non-authorized app', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      const token = await auth.getAppToken('slack');
      expect(token).toBeNull();
    });

    it('getAppToken should return token for authorized app', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(true),
        getAccessToken: jest.fn().mockResolvedValue('slack-access-token'),
      });
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addAppAuthorization('slack', ['send'], { accessToken: 'at' });
      const token = await auth.getAppToken('slack');
      expect(token).toBe('slack-access-token');
    });

    it('getAppToken should return null when getToken throws', async () => {
      const store = createMockTokenStore({
        hasTokens: jest.fn().mockResolvedValue(false),
      });
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addAppAuthorization('slack', ['send'], { accessToken: 'at' });
      const token = await auth.getAppToken('slack');
      expect(token).toBeNull();
    });

    it('isAppAuthorized should include base class authorized apps', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          authorizedApps: { jira: { id: 'jira', toolIds: ['create-issue'] } },
          authorizedAppIds: ['jira'],
        }),
      );
      expect(auth.isAppAuthorized('jira')).toBe(true);
    });

    it('isAppAuthorized should include progressively authorized apps', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addAppAuthorization('slack', ['send'], { accessToken: 'at' });
      expect(auth.isAppAuthorized('slack')).toBe(true);
    });

    it('isAppAuthorized should return false for unknown app', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.isAppAuthorized('unknown')).toBe(false);
    });

    it('getAllAuthorizedAppIds should merge base and mutable apps', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          tokenStore: store,
          authorizedApps: { jira: { id: 'jira', toolIds: ['create'] } },
          authorizedAppIds: ['jira'],
        }),
      );

      await auth.addAppAuthorization('slack', ['send'], { accessToken: 'at' });
      const ids = auth.getAllAuthorizedAppIds();
      expect(ids).toContain('jira');
      expect(ids).toContain('slack');
    });

    it('getAllAuthorizedAppIds should deduplicate', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          tokenStore: store,
          authorizedApps: { slack: { id: 'slack', toolIds: ['send'] } },
          authorizedAppIds: ['slack'],
        }),
      );

      // Add the same app again progressively
      await auth.addAppAuthorization('slack', ['send', 'read'], { accessToken: 'at' });
      const ids = auth.getAllAuthorizedAppIds();
      const slackCount = ids.filter((id) => id === 'slack').length;
      expect(slackCount).toBe(1);
    });

    it('getAppToolIds should return tool ids from mutable state', async () => {
      const store = createMockTokenStore();
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ tokenStore: store }));

      await auth.addAppAuthorization('slack', ['send', 'read'], { accessToken: 'at' });
      expect(auth.getAppToolIds('slack')).toEqual(['send', 'read']);
    });

    it('getAppToolIds should return tool ids from base authorized apps', () => {
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({
          authorizedApps: { jira: { id: 'jira', toolIds: ['create-issue', 'list-issues'] } },
        }),
      );
      expect(auth.getAppToolIds('jira')).toEqual(['create-issue', 'list-issues']);
    });

    it('getAppToolIds should return undefined for unknown app', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.getAppToolIds('unknown')).toBeUndefined();
    });
  });

  // ========================================
  // issuer getter
  // ========================================
  describe('issuer', () => {
    it('should return issuer from claims', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ claims: { iss: 'https://local.example.com' } }));
      expect(auth.issuer).toBe('https://local.example.com');
    });

    it('should return undefined when no iss claim', () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      expect(auth.issuer).toBeUndefined();
    });
  });

  // ========================================
  // Error class types
  // ========================================
  describe('error types', () => {
    it('should throw NoProviderIdError instance', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx());
      try {
        await auth.getToken();
        fail('Expected NoProviderIdError');
      } catch (e) {
        expect(e).toBeInstanceOf(NoProviderIdError);
      }
    });

    it('should throw TokenStoreRequiredError instance', async () => {
      const auth = OrchestratedAuthorization.create(createDefaultCtx({ primaryProviderId: 'github' }));
      try {
        await auth.getToken();
        fail('Expected TokenStoreRequiredError');
      } catch (e) {
        expect(e).toBeInstanceOf(TokenStoreRequiredError);
      }
    });

    it('should throw TokenNotAvailableError instance when no tokens', async () => {
      const store = createMockTokenStore({ hasTokens: jest.fn().mockResolvedValue(false) });
      const auth = OrchestratedAuthorization.create(
        createDefaultCtx({ primaryProviderId: 'github', tokenStore: store }),
      );
      try {
        await auth.getToken();
        fail('Expected TokenNotAvailableError');
      } catch (e) {
        expect(e).toBeInstanceOf(TokenNotAvailableError);
      }
    });
  });
});
