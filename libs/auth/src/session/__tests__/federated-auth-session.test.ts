/**
 * Federated Auth Session Tests
 *
 * Tests for:
 * - InMemoryFederatedAuthSessionStore (store, get, delete, update, cleanup, createSession)
 * - toSessionRecord / fromSessionRecord serialization
 * - createFederatedAuthSession factory function
 * - isSessionComplete, getNextProvider, completeCurrentProvider, startNextProvider helpers
 */

const mockRandomUUID = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  randomUUID: () => mockRandomUUID(),
}));

import {
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  createFederatedAuthSession,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
} from '../federated-auth.session';
import type {
  FederatedAuthSession,
  FederatedAuthSessionCreateParams,
  ProviderTokens,
  ProviderUserInfo,
  ProviderPkce,
  CompletedProvider,
} from '../federated-auth.session';
import { AuthFlowError } from '../../errors/auth-internal.errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uuidCounter = 0;

function resetUuidMock(): void {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

function makeCreateParams(overrides?: Partial<FederatedAuthSessionCreateParams>): FederatedAuthSessionCreateParams {
  return {
    pendingAuthId: 'pending-auth-1',
    clientId: 'client-1',
    redirectUri: 'https://example.com/callback',
    scopes: ['openid', 'profile'],
    userInfo: { email: 'user@example.com', name: 'Test User', sub: 'user-1' },
    frontmcpPkce: { challenge: 'test-challenge', method: 'S256' },
    providerIds: ['google', 'github'],
    ...overrides,
  };
}

function makePkce(): ProviderPkce {
  return {
    verifier: 'test-verifier',
    challenge: 'test-challenge',
    method: 'S256',
  };
}

function makeTokens(): ProviderTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    tokenType: 'Bearer',
    scopes: ['read', 'write'],
  };
}

function makeUserInfo(): ProviderUserInfo {
  return {
    sub: 'provider-user-1',
    email: 'provider-user@example.com',
    name: 'Provider User',
  };
}

function makeSession(overrides?: Partial<FederatedAuthSession>): FederatedAuthSession {
  const now = Date.now();
  return {
    id: 'session-1',
    pendingAuthId: 'pending-auth-1',
    clientId: 'client-1',
    redirectUri: 'https://example.com/callback',
    scopes: ['openid'],
    userInfo: { email: 'user@example.com' },
    frontmcpPkce: { challenge: 'test-challenge', method: 'S256' },
    providerQueue: ['google', 'github'],
    completedProviders: new Map(),
    skippedProviders: [],
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('federated-auth.session', () => {
  beforeEach(() => {
    resetUuidMock();
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // toSessionRecord / fromSessionRecord
  // -----------------------------------------------------------------------
  describe('toSessionRecord / fromSessionRecord', () => {
    it('should serialize and deserialize a session with empty completedProviders', () => {
      const session = makeSession();
      const record = toSessionRecord(session);

      expect(record.completedProviders).toEqual([]);
      expect(Array.isArray(record.completedProviders)).toBe(true);

      const restored = fromSessionRecord(record);
      expect(restored.completedProviders).toBeInstanceOf(Map);
      expect(restored.completedProviders.size).toBe(0);
    });

    it('should serialize and deserialize a session with completed providers', () => {
      const session = makeSession();
      session.completedProviders.set('google', {
        providerId: 'google',
        tokens: makeTokens(),
        userInfo: makeUserInfo(),
        completedAt: Date.now(),
      });

      const record = toSessionRecord(session);
      expect(record.completedProviders).toHaveLength(1);
      expect(record.completedProviders[0][0]).toBe('google');

      const restored = fromSessionRecord(record);
      expect(restored.completedProviders.get('google')?.providerId).toBe('google');
    });

    it('should preserve all session fields through round-trip', () => {
      const session = makeSession({
        state: 'my-state',
        resource: 'https://api.example.com',
        currentProviderId: 'google',
        currentProviderPkce: makePkce(),
        currentProviderState: 'provider-state',
      });
      session.completedProviders.set('github', {
        providerId: 'github',
        tokens: makeTokens(),
        completedAt: Date.now(),
      });

      const record = toSessionRecord(session);
      const restored = fromSessionRecord(record);

      expect(restored.id).toBe(session.id);
      expect(restored.pendingAuthId).toBe(session.pendingAuthId);
      expect(restored.clientId).toBe(session.clientId);
      expect(restored.redirectUri).toBe(session.redirectUri);
      expect(restored.scopes).toEqual(session.scopes);
      expect(restored.state).toBe(session.state);
      expect(restored.resource).toBe(session.resource);
      expect(restored.userInfo).toEqual(session.userInfo);
      expect(restored.frontmcpPkce).toEqual(session.frontmcpPkce);
      expect(restored.providerQueue).toEqual(session.providerQueue);
      expect(restored.skippedProviders).toEqual(session.skippedProviders);
      expect(restored.currentProviderId).toBe(session.currentProviderId);
      expect(restored.currentProviderPkce).toEqual(session.currentProviderPkce);
      expect(restored.currentProviderState).toBe(session.currentProviderState);
      expect(restored.createdAt).toBe(session.createdAt);
      expect(restored.expiresAt).toBe(session.expiresAt);
      expect(restored.completedProviders.get('github')?.providerId).toBe('github');
    });
  });

  // -----------------------------------------------------------------------
  // createFederatedAuthSession (standalone factory)
  // -----------------------------------------------------------------------
  describe('createFederatedAuthSession', () => {
    it('should create a session with default TTL', () => {
      const params = makeCreateParams();
      const session = createFederatedAuthSession(params);

      expect(session.id).toBe('uuid-1');
      expect(session.pendingAuthId).toBe('pending-auth-1');
      expect(session.clientId).toBe('client-1');
      expect(session.redirectUri).toBe('https://example.com/callback');
      expect(session.scopes).toEqual(['openid', 'profile']);
      expect(session.userInfo).toEqual(params.userInfo);
      expect(session.frontmcpPkce).toEqual(params.frontmcpPkce);
      expect(session.providerQueue).toEqual(['google', 'github']);
      expect(session.completedProviders).toBeInstanceOf(Map);
      expect(session.completedProviders.size).toBe(0);
      expect(session.skippedProviders).toEqual([]);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.expiresAt - session.createdAt).toBe(15 * 60 * 1000);
    });

    it('should create a session with custom TTL', () => {
      const params = makeCreateParams();
      const ttlMs = 5 * 60 * 1000;
      const session = createFederatedAuthSession(params, ttlMs);

      expect(session.expiresAt - session.createdAt).toBe(ttlMs);
    });

    it('should clone providerIds (not share reference)', () => {
      const providerIds = ['google', 'github'];
      const params = makeCreateParams({ providerIds });
      const session = createFederatedAuthSession(params);

      // Mutating the original should not affect the session
      providerIds.push('slack');
      expect(session.providerQueue).toEqual(['google', 'github']);
    });

    it('should set optional fields when provided', () => {
      const params = makeCreateParams({
        state: 'oauth-state',
        resource: 'https://api.example.com',
      });
      const session = createFederatedAuthSession(params);

      expect(session.state).toBe('oauth-state');
      expect(session.resource).toBe('https://api.example.com');
    });
  });

  // -----------------------------------------------------------------------
  // isSessionComplete
  // -----------------------------------------------------------------------
  describe('isSessionComplete', () => {
    it('should return true when queue is empty and no current provider', () => {
      const session = makeSession({
        providerQueue: [],
        currentProviderId: undefined,
      });

      expect(isSessionComplete(session)).toBe(true);
    });

    it('should return false when queue has providers', () => {
      const session = makeSession({
        providerQueue: ['google'],
        currentProviderId: undefined,
      });

      expect(isSessionComplete(session)).toBe(false);
    });

    it('should return false when current provider is set', () => {
      const session = makeSession({
        providerQueue: [],
        currentProviderId: 'google',
      });

      expect(isSessionComplete(session)).toBe(false);
    });

    it('should return false when both queue and current are set', () => {
      const session = makeSession({
        providerQueue: ['github'],
        currentProviderId: 'google',
      });

      expect(isSessionComplete(session)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getNextProvider
  // -----------------------------------------------------------------------
  describe('getNextProvider', () => {
    it('should return current provider if one is set', () => {
      const session = makeSession({
        currentProviderId: 'google',
        providerQueue: ['github'],
      });

      expect(getNextProvider(session)).toBe('google');
    });

    it('should return first in queue when no current provider', () => {
      const session = makeSession({
        currentProviderId: undefined,
        providerQueue: ['google', 'github'],
      });

      expect(getNextProvider(session)).toBe('google');
    });

    it('should return undefined when queue is empty and no current', () => {
      const session = makeSession({
        currentProviderId: undefined,
        providerQueue: [],
      });

      expect(getNextProvider(session)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // completeCurrentProvider
  // -----------------------------------------------------------------------
  describe('completeCurrentProvider', () => {
    it('should complete the current provider with tokens and user info', () => {
      const session = makeSession({ currentProviderId: 'google' });
      const tokens = makeTokens();
      const userInfo = makeUserInfo();

      completeCurrentProvider(session, tokens, userInfo);

      const completed = session.completedProviders.get('google');
      expect(completed).toBeDefined();
      expect(completed?.providerId).toBe('google');
      expect(completed?.tokens).toBe(tokens);
      expect(completed?.userInfo).toBe(userInfo);
      expect(completed?.completedAt).toBeLessThanOrEqual(Date.now());

      // Current provider should be cleared
      expect(session.currentProviderId).toBeUndefined();
      expect(session.currentProviderPkce).toBeUndefined();
      expect(session.currentProviderState).toBeUndefined();
    });

    it('should complete without user info', () => {
      const session = makeSession({ currentProviderId: 'github' });
      const tokens = makeTokens();

      completeCurrentProvider(session, tokens);

      const completed = session.completedProviders.get('github');
      expect(completed?.userInfo).toBeUndefined();
    });

    it('should throw AuthFlowError when no current provider', () => {
      const session = makeSession({ currentProviderId: undefined });

      expect(() => completeCurrentProvider(session, makeTokens())).toThrow(AuthFlowError);
      expect(() => completeCurrentProvider(session, makeTokens())).toThrow('No current provider to complete');
    });

    it('should clear PKCE and state after completion', () => {
      const session = makeSession({
        currentProviderId: 'google',
        currentProviderPkce: makePkce(),
        currentProviderState: 'state-123',
      });

      completeCurrentProvider(session, makeTokens());

      expect(session.currentProviderPkce).toBeUndefined();
      expect(session.currentProviderState).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // startNextProvider
  // -----------------------------------------------------------------------
  describe('startNextProvider', () => {
    it('should pop first provider from queue and set as current', () => {
      const session = makeSession({
        currentProviderId: undefined,
        providerQueue: ['google', 'github'],
      });
      const pkce = makePkce();
      const state = 'provider-state-1';

      const providerId = startNextProvider(session, pkce, state);

      expect(providerId).toBe('google');
      expect(session.currentProviderId).toBe('google');
      expect(session.currentProviderPkce).toBe(pkce);
      expect(session.currentProviderState).toBe(state);
      expect(session.providerQueue).toEqual(['github']);
    });

    it('should throw AuthFlowError when current provider is in progress', () => {
      const session = makeSession({
        currentProviderId: 'google',
        providerQueue: ['github'],
      });

      expect(() => startNextProvider(session, makePkce(), 'state')).toThrow(AuthFlowError);
      expect(() => startNextProvider(session, makePkce(), 'state')).toThrow(
        'Cannot start next provider while current is in progress',
      );
    });

    it('should throw AuthFlowError when queue is empty', () => {
      const session = makeSession({
        currentProviderId: undefined,
        providerQueue: [],
      });

      expect(() => startNextProvider(session, makePkce(), 'state')).toThrow(AuthFlowError);
      expect(() => startNextProvider(session, makePkce(), 'state')).toThrow('No more providers in queue');
    });

    it('should handle last provider in queue', () => {
      const session = makeSession({
        currentProviderId: undefined,
        providerQueue: ['last-provider'],
      });

      const providerId = startNextProvider(session, makePkce(), 'state');

      expect(providerId).toBe('last-provider');
      expect(session.providerQueue).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // InMemoryFederatedAuthSessionStore
  // -----------------------------------------------------------------------
  describe('InMemoryFederatedAuthSessionStore', () => {
    let store: InMemoryFederatedAuthSessionStore;

    beforeEach(() => {
      store = new InMemoryFederatedAuthSessionStore();
    });

    afterEach(() => {
      store.dispose();
    });

    // -----------------------------------------------------------------------
    // createSession
    // -----------------------------------------------------------------------
    describe('createSession', () => {
      it('should create a session with proper defaults', () => {
        const session = store.createSession(makeCreateParams());

        expect(session.id).toBe('uuid-1');
        expect(session.pendingAuthId).toBe('pending-auth-1');
        expect(session.clientId).toBe('client-1');
        expect(session.redirectUri).toBe('https://example.com/callback');
        expect(session.scopes).toEqual(['openid', 'profile']);
        expect(session.providerQueue).toEqual(['google', 'github']);
        expect(session.completedProviders).toBeInstanceOf(Map);
        expect(session.completedProviders.size).toBe(0);
        expect(session.skippedProviders).toEqual([]);
        expect(session.createdAt).toBeLessThanOrEqual(Date.now());
        // TTL is 15 minutes
        expect(session.expiresAt - session.createdAt).toBe(15 * 60 * 1000);
      });

      it('should clone providerIds', () => {
        const providerIds = ['google', 'github'];
        const session = store.createSession(makeCreateParams({ providerIds }));

        providerIds.push('slack');
        expect(session.providerQueue).toEqual(['google', 'github']);
      });
    });

    // -----------------------------------------------------------------------
    // store / get
    // -----------------------------------------------------------------------
    describe('store / get', () => {
      it('should store and retrieve a session', async () => {
        const session = store.createSession(makeCreateParams());
        await store.store(session);

        const retrieved = await store.get(session.id);
        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(session.id);
        expect(retrieved?.clientId).toBe(session.clientId);
        expect(retrieved?.completedProviders).toBeInstanceOf(Map);
      });

      it('should return null for non-existent session', async () => {
        const result = await store.get('nonexistent');
        expect(result).toBeNull();
      });

      it('should return null for expired session', async () => {
        const session = store.createSession(makeCreateParams());
        // Manually set expiration in the past
        session.expiresAt = Date.now() - 1000;
        await store.store(session);

        const result = await store.get(session.id);
        expect(result).toBeNull();
      });

      it('should delete expired session on get', async () => {
        const session = store.createSession(makeCreateParams());
        session.expiresAt = Date.now() - 1000;
        await store.store(session);

        await store.get(session.id);
        expect(store.size).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
    describe('delete', () => {
      it('should delete an existing session', async () => {
        const session = store.createSession(makeCreateParams());
        await store.store(session);

        await store.delete(session.id);

        const result = await store.get(session.id);
        expect(result).toBeNull();
        expect(store.size).toBe(0);
      });

      it('should not throw for non-existent session', async () => {
        await expect(store.delete('nonexistent')).resolves.not.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------
    describe('update', () => {
      it('should update an existing session', async () => {
        const session = store.createSession(makeCreateParams());
        await store.store(session);

        session.currentProviderId = 'google';
        session.currentProviderPkce = makePkce();
        await store.update(session);

        const retrieved = await store.get(session.id);
        expect(retrieved?.currentProviderId).toBe('google');
        expect(retrieved?.currentProviderPkce).toEqual(makePkce());
      });

      it('should preserve completedProviders Map through update', async () => {
        const session = store.createSession(makeCreateParams());
        session.completedProviders.set('google', {
          providerId: 'google',
          tokens: makeTokens(),
          completedAt: Date.now(),
        });
        await store.store(session);

        session.currentProviderId = 'github';
        await store.update(session);

        const retrieved = await store.get(session.id);
        expect(retrieved?.completedProviders.get('google')).toBeDefined();
        expect(retrieved?.completedProviders.get('google')?.providerId).toBe('google');
      });
    });

    // -----------------------------------------------------------------------
    // cleanup
    // -----------------------------------------------------------------------
    describe('cleanup', () => {
      it('should remove expired sessions', async () => {
        const session1 = store.createSession(makeCreateParams());
        session1.expiresAt = Date.now() - 1000; // expired
        await store.store(session1);

        const session2 = store.createSession(makeCreateParams());
        await store.store(session2);

        expect(store.size).toBe(2);

        await store.cleanup();

        expect(store.size).toBe(1);
      });

      it('should keep non-expired sessions', async () => {
        const session = store.createSession(makeCreateParams());
        await store.store(session);

        await store.cleanup();

        expect(store.size).toBe(1);
        expect(await store.get(session.id)).not.toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // dispose
    // -----------------------------------------------------------------------
    describe('dispose', () => {
      it('should clear the cleanup timer', () => {
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

        store.dispose();

        expect(clearIntervalSpy).toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
      });

      it('should handle double dispose gracefully', () => {
        store.dispose();
        expect(() => store.dispose()).not.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // size
    // -----------------------------------------------------------------------
    describe('size', () => {
      it('should return 0 for empty store', () => {
        expect(store.size).toBe(0);
      });

      it('should return correct count', async () => {
        const s1 = store.createSession(makeCreateParams());
        await store.store(s1);
        expect(store.size).toBe(1);

        const s2 = store.createSession(makeCreateParams());
        await store.store(s2);
        expect(store.size).toBe(2);
      });
    });

    // -----------------------------------------------------------------------
    // clear
    // -----------------------------------------------------------------------
    describe('clear', () => {
      it('should remove all sessions', async () => {
        const s1 = store.createSession(makeCreateParams());
        const s2 = store.createSession(makeCreateParams());
        await store.store(s1);
        await store.store(s2);

        expect(store.size).toBe(2);

        store.clear();

        expect(store.size).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // Full flow integration
    // -----------------------------------------------------------------------
    describe('full flow', () => {
      it('should support complete multi-provider auth flow', async () => {
        // 1. Create session
        const session = store.createSession(makeCreateParams({ providerIds: ['google', 'github'] }));
        await store.store(session);

        // 2. Start first provider
        const pkce1 = makePkce();
        const providerId1 = startNextProvider(session, pkce1, 'state-1');
        expect(providerId1).toBe('google');
        await store.update(session);

        // 3. Complete first provider
        completeCurrentProvider(session, makeTokens(), makeUserInfo());
        await store.update(session);

        expect(isSessionComplete(session)).toBe(false);

        // 4. Start second provider
        const pkce2 = makePkce();
        const providerId2 = startNextProvider(session, pkce2, 'state-2');
        expect(providerId2).toBe('github');
        await store.update(session);

        // 5. Complete second provider
        completeCurrentProvider(session, makeTokens());
        await store.update(session);

        expect(isSessionComplete(session)).toBe(true);
        expect(session.completedProviders.size).toBe(2);
        expect(session.completedProviders.has('google')).toBe(true);
        expect(session.completedProviders.has('github')).toBe(true);

        // 6. Verify persistence
        const retrieved = await store.get(session.id);
        expect(retrieved?.completedProviders.size).toBe(2);
      });
    });
  });
});
