import {
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
  type FederatedAuthSession,
  type ProviderPkce,
  type ProviderTokens,
  type ProviderUserInfo,
} from '../session/federated-auth.session';

describe('FederatedAuthSession helpers', () => {
  const createSession = (overrides: Partial<FederatedAuthSession> = {}): FederatedAuthSession => ({
    id: 'session-123',
    pendingAuthId: 'pending-456',
    clientId: 'test-client',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['openid', 'profile'],
    state: 'test-state',
    resource: undefined,
    userInfo: {
      email: 'test@example.com',
      name: 'Test User',
    },
    frontmcpPkce: {
      challenge: 'challenge123',
      method: 'S256',
    },
    providerQueue: ['github', 'slack'],
    skippedProviders: [],
    completedProviders: new Map(),
    createdAt: Date.now(),
    expiresAt: Date.now() + 15 * 60 * 1000,
    ...overrides,
  });

  describe('isSessionComplete', () => {
    it('should return true when queue is empty and no current provider', () => {
      const session = createSession({
        providerQueue: [],
        currentProviderId: undefined,
      });
      expect(isSessionComplete(session)).toBe(true);
    });

    it('should return false when queue has providers', () => {
      const session = createSession({
        providerQueue: ['github'],
        currentProviderId: undefined,
      });
      expect(isSessionComplete(session)).toBe(false);
    });

    it('should return false when current provider is set', () => {
      const session = createSession({
        providerQueue: [],
        currentProviderId: 'github',
      });
      expect(isSessionComplete(session)).toBe(false);
    });
  });

  describe('getNextProvider', () => {
    it('should return current provider if set', () => {
      const session = createSession({
        currentProviderId: 'current',
        providerQueue: ['next'],
      });
      expect(getNextProvider(session)).toBe('current');
    });

    it('should return first in queue if no current provider', () => {
      const session = createSession({
        currentProviderId: undefined,
        providerQueue: ['first', 'second'],
      });
      expect(getNextProvider(session)).toBe('first');
    });

    it('should return undefined if queue is empty and no current', () => {
      const session = createSession({
        currentProviderId: undefined,
        providerQueue: [],
      });
      expect(getNextProvider(session)).toBeUndefined();
    });
  });

  describe('startNextProvider', () => {
    it('should move provider from queue to current', () => {
      const session = createSession({
        providerQueue: ['github', 'slack'],
        currentProviderId: undefined,
      });

      const pkce: ProviderPkce = {
        verifier: 'verifier123',
        challenge: 'challenge123',
        method: 'S256',
      };
      const state = 'provider-state';

      const providerId = startNextProvider(session, pkce, state);

      expect(providerId).toBe('github');
      expect(session.currentProviderId).toBe('github');
      expect(session.currentProviderPkce).toEqual(pkce);
      expect(session.currentProviderState).toBe(state);
      expect(session.providerQueue).toEqual(['slack']);
    });

    it('should throw if current provider is already set', () => {
      const session = createSession({
        currentProviderId: 'existing',
        providerQueue: ['next'],
      });

      expect(() => startNextProvider(session, { verifier: 'v', challenge: 'c', method: 'S256' }, 'state')).toThrow(
        'Cannot start next provider while current is in progress',
      );
    });

    it('should throw if queue is empty', () => {
      const session = createSession({
        providerQueue: [],
        currentProviderId: undefined,
      });

      expect(() => startNextProvider(session, { verifier: 'v', challenge: 'c', method: 'S256' }, 'state')).toThrow(
        'No more providers in queue',
      );
    });
  });

  describe('completeCurrentProvider', () => {
    it('should move current provider to completed', () => {
      const session = createSession({
        currentProviderId: 'github',
        currentProviderPkce: { verifier: 'v', challenge: 'c', method: 'S256' },
        currentProviderState: 'state',
      });

      const tokens: ProviderTokens = {
        accessToken: 'gho_xxxx',
        refreshToken: 'ghr_yyyy',
        expiresAt: Date.now() + 3600000,
      };

      const userInfo: ProviderUserInfo = {
        sub: 'user123',
        email: 'user@example.com',
        name: 'User',
      };

      completeCurrentProvider(session, tokens, userInfo);

      expect(session.currentProviderId).toBeUndefined();
      expect(session.currentProviderPkce).toBeUndefined();
      expect(session.currentProviderState).toBeUndefined();

      const completed = session.completedProviders.get('github');
      expect(completed).toBeDefined();
      expect(completed?.tokens).toEqual(tokens);
      expect(completed?.userInfo).toEqual(userInfo);
      expect(completed?.completedAt).toBeDefined();
    });

    it('should throw if no current provider', () => {
      const session = createSession({
        currentProviderId: undefined,
      });

      expect(() => completeCurrentProvider(session, { accessToken: 'token' })).toThrow(
        'No current provider to complete',
      );
    });
  });

  describe('toSessionRecord and fromSessionRecord', () => {
    it('should serialize and deserialize session', () => {
      const session = createSession();
      session.completedProviders.set('github', {
        providerId: 'github',
        tokens: { accessToken: 'token' },
        completedAt: Date.now(),
      });

      const record = toSessionRecord(session);
      expect(Array.isArray(record.completedProviders)).toBe(true);

      const restored = fromSessionRecord(record);
      expect(restored.completedProviders instanceof Map).toBe(true);
      expect(restored.completedProviders.get('github')).toBeDefined();
    });
  });
});

describe('InMemoryFederatedAuthSessionStore', () => {
  let store: InMemoryFederatedAuthSessionStore;

  beforeEach(() => {
    store = new InMemoryFederatedAuthSessionStore();
  });

  afterEach(() => {
    store.dispose();
  });

  describe('store and get', () => {
    it('should store and retrieve session', async () => {
      const session = store.createSession({
        pendingAuthId: 'pending-123',
        clientId: 'client',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['openid'],
        userInfo: { email: 'test@example.com' },
        frontmcpPkce: { challenge: 'challenge', method: 'S256' },
        providerIds: ['github', 'slack'],
      });

      await store.store(session);

      const retrieved = await store.get(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.providerQueue).toEqual(['github', 'slack']);
    });

    it('should return null for non-existent session', async () => {
      const session = await store.get('nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('update', () => {
    it('should update existing session', async () => {
      const session = store.createSession({
        pendingAuthId: 'pending-123',
        clientId: 'client',
        redirectUri: 'http://localhost:3000/callback',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: ['github'],
      });

      await store.store(session);

      session.currentProviderId = 'github';
      await store.update(session);

      const retrieved = await store.get(session.id);
      expect(retrieved?.currentProviderId).toBe('github');
    });
  });

  describe('delete', () => {
    it('should delete session', async () => {
      const session = store.createSession({
        pendingAuthId: 'pending-123',
        clientId: 'client',
        redirectUri: 'http://localhost:3000/callback',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: ['github'],
      });

      await store.store(session);
      await store.delete(session.id);

      const retrieved = await store.get(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('expiration', () => {
    it('should return null for expired session', async () => {
      const session = store.createSession({
        pendingAuthId: 'pending-123',
        clientId: 'client',
        redirectUri: 'http://localhost:3000/callback',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: ['github'],
      });

      // Manually set expiration in the past
      session.expiresAt = Date.now() - 1000;
      await store.store(session);

      const retrieved = await store.get(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('createSession', () => {
    it('should create session with all fields', () => {
      const session = store.createSession({
        pendingAuthId: 'pending-123',
        clientId: 'my-client',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['openid', 'profile'],
        state: 'my-state',
        resource: 'http://api.example.com',
        userInfo: {
          email: 'test@example.com',
          name: 'Test User',
          sub: 'user-123',
        },
        frontmcpPkce: {
          challenge: 'pkce-challenge',
          method: 'S256',
        },
        providerIds: ['github', 'slack', 'jira'],
      });

      expect(session.id).toBeDefined();
      expect(session.pendingAuthId).toBe('pending-123');
      expect(session.clientId).toBe('my-client');
      expect(session.redirectUri).toBe('http://localhost:3000/callback');
      expect(session.scopes).toEqual(['openid', 'profile']);
      expect(session.state).toBe('my-state');
      expect(session.resource).toBe('http://api.example.com');
      expect(session.userInfo.email).toBe('test@example.com');
      expect(session.frontmcpPkce.challenge).toBe('pkce-challenge');
      expect(session.providerQueue).toEqual(['github', 'slack', 'jira']);
      expect(session.completedProviders.size).toBe(0);
      expect(session.createdAt).toBeDefined();
      expect(session.expiresAt).toBeGreaterThan(session.createdAt);
    });
  });

  describe('size and clear', () => {
    it('should track store size', async () => {
      expect(store.size).toBe(0);

      const session1 = store.createSession({
        pendingAuthId: '1',
        clientId: 'c',
        redirectUri: 'http://localhost/cb',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: [],
      });

      const session2 = store.createSession({
        pendingAuthId: '2',
        clientId: 'c',
        redirectUri: 'http://localhost/cb',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: [],
      });

      await store.store(session1);
      expect(store.size).toBe(1);

      await store.store(session2);
      expect(store.size).toBe(2);
    });

    it('should clear all sessions', async () => {
      const session = store.createSession({
        pendingAuthId: '1',
        clientId: 'c',
        redirectUri: 'http://localhost/cb',
        scopes: [],
        userInfo: {},
        frontmcpPkce: { challenge: 'c', method: 'S256' },
        providerIds: [],
      });

      await store.store(session);
      store.clear();

      expect(store.size).toBe(0);
    });
  });
});
