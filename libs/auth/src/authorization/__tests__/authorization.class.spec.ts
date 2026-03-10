/**
 * AuthorizationBase Tests
 *
 * Tests the abstract AuthorizationBase class through a concrete TestAuthorization subclass.
 * Covers constructor defaults, transport session CRUD, scope checks, access control,
 * progressive auth URL, expiry logic, session JWT, LLM-safe context, and token leak validation.
 */

import type { TransportSession } from '../../session/transport-session.types';
import type { AuthMode, AuthorizationCreateCtx } from '../authorization.types';
import { TokenLeakDetectedError } from '../../errors/auth-internal.errors';

// ---- Mocks ----

const MOCK_UUID = 'test-uuid-1234-5678-abcdef';
jest.mock('@frontmcp/utils', () => ({
  randomUUID: jest.fn(() => MOCK_UUID),
  randomBytes: jest.fn(() => new Uint8Array(8)),
  bytesToHex: jest.fn(() => 'deadbeef01234567'),
  base64urlDecode: jest.fn((input: string) => {
    // Real base64url decode for JWT header validation
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }),
}));

const MOCK_ENCRYPTED = 'iv123.tag456.ct789';
jest.mock('../../session/utils/session-crypto.utils', () => ({
  encryptJson: jest.fn(() => MOCK_ENCRYPTED),
}));

const MOCK_MACHINE_ID = 'machine-id-abc';
jest.mock('../../machine-id', () => ({
  getMachineId: jest.fn(() => MOCK_MACHINE_ID),
}));

import { AuthorizationBase } from '../authorization.class';
import { encryptJson } from '../../session/utils/session-crypto.utils';

// ---- Concrete subclass for testing ----

class TestAuthorization extends AuthorizationBase {
  readonly mode: AuthMode = 'public';
  private readonly testToken: string | undefined;

  constructor(ctx: AuthorizationCreateCtx, testToken?: string) {
    super(ctx);
    this.testToken = testToken;
  }

  async getToken(): Promise<string> {
    return this.testToken ?? 'mock-token';
  }
}

// ---- Helper ----

function createDefaultCtx(overrides: Partial<AuthorizationCreateCtx> = {}): AuthorizationCreateCtx {
  return {
    id: 'auth-id-1',
    isAnonymous: false,
    user: { sub: 'user-1', name: 'Test User' },
    ...overrides,
  };
}

function createAuth(overrides: Partial<AuthorizationCreateCtx> = {}) {
  return new TestAuthorization(createDefaultCtx(overrides));
}

// ---- Tests ----

describe('AuthorizationBase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Constructor defaults
  // ========================================
  describe('constructor', () => {
    it('should set id from context', () => {
      const auth = createAuth({ id: 'my-id' });
      expect(auth.id).toBe('my-id');
    });

    it('should set isAnonymous from context', () => {
      const auth = createAuth({ isAnonymous: true });
      expect(auth.isAnonymous).toBe(true);
    });

    it('should set user from context', () => {
      const auth = createAuth({ user: { sub: 'u1', name: 'Alice' } });
      expect(auth.user).toEqual({ sub: 'u1', name: 'Alice' });
    });

    it('should set claims from context', () => {
      const auth = createAuth({ claims: { role: 'admin' } });
      expect(auth.claims).toEqual({ role: 'admin' });
    });

    it('should leave claims undefined when not provided', () => {
      const auth = createAuth();
      expect(auth.claims).toBeUndefined();
    });

    it('should set expiresAt from context', () => {
      const exp = Date.now() + 60000;
      const auth = createAuth({ expiresAt: exp });
      expect(auth.expiresAt).toBe(exp);
    });

    it('should leave expiresAt undefined when not provided', () => {
      const auth = createAuth();
      expect(auth.expiresAt).toBeUndefined();
    });

    it('should default scopes to empty array', () => {
      const auth = createAuth();
      expect(auth.scopes).toEqual([]);
    });

    it('should set scopes from context', () => {
      const auth = createAuth({ scopes: ['read', 'write'] });
      expect(auth.scopes).toEqual(['read', 'write']);
    });

    it('should set createdAt to approximately now', () => {
      const before = Date.now();
      const auth = createAuth();
      const after = Date.now();
      expect(auth.createdAt).toBeGreaterThanOrEqual(before);
      expect(auth.createdAt).toBeLessThanOrEqual(after);
    });

    it('should initialize authorizedProviders from context', () => {
      const providers = {
        github: { id: 'github', embedMode: 'plain' as const },
      };
      const auth = createAuth({ authorizedProviders: providers });
      expect(auth.authorizedProviders).toEqual(providers);
    });

    it('should default authorizedProviders to empty object', () => {
      const auth = createAuth();
      expect(auth.authorizedProviders).toEqual({});
    });

    it('should derive authorizedProviderIds from provider keys when not explicitly set', () => {
      const auth = createAuth({
        authorizedProviders: {
          github: { id: 'github', embedMode: 'plain' as const },
          google: { id: 'google', embedMode: 'ref' as const },
        },
      });
      expect(auth.authorizedProviderIds).toEqual(['github', 'google']);
    });

    it('should use explicit authorizedProviderIds when provided', () => {
      const auth = createAuth({
        authorizedProviders: {
          github: { id: 'github', embedMode: 'plain' as const },
        },
        authorizedProviderIds: ['github', 'extra'],
      });
      expect(auth.authorizedProviderIds).toEqual(['github', 'extra']);
    });

    it('should default authorizedTools to empty object', () => {
      const auth = createAuth();
      expect(auth.authorizedTools).toEqual({});
    });

    it('should default authorizedToolIds from tool keys', () => {
      const auth = createAuth({
        authorizedTools: {
          search: { executionPath: ['app1', 'search'] },
        },
      });
      expect(auth.authorizedToolIds).toEqual(['search']);
    });

    it('should default authorizedPrompts to empty object', () => {
      const auth = createAuth();
      expect(auth.authorizedPrompts).toEqual({});
    });

    it('should default authorizedResources to empty array', () => {
      const auth = createAuth();
      expect(auth.authorizedResources).toEqual([]);
    });

    it('should default authorizedApps to empty object and appIds from keys', () => {
      const auth = createAuth({
        authorizedApps: { slack: { id: 'slack', toolIds: ['send'] } },
      });
      expect(auth.authorizedAppIds).toEqual(['slack']);
    });
  });

  // ========================================
  // Transport Session CRUD
  // ========================================
  describe('transport session CRUD', () => {
    it('createTransportSession should return a session with correct fields', () => {
      const auth = createAuth({ expiresAt: 999999 });
      const session = auth.createTransportSession('sse', 'fp-123');

      expect(session.id).toBe(MOCK_UUID);
      expect(session.authorizationId).toBe('auth-id-1');
      expect(session.protocol).toBe('sse');
      expect(session.expiresAt).toBe(999999);
      expect(session.nodeId).toBe(MOCK_MACHINE_ID);
      expect(session.clientFingerprint).toBe('fp-123');
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it('createTransportSession should work without fingerprint', () => {
      const auth = createAuth();
      const session = auth.createTransportSession('streamable-http');
      expect(session.clientFingerprint).toBeUndefined();
    });

    it('getTransportSession should return session by id', () => {
      const auth = createAuth();
      const session = auth.createTransportSession('sse');
      const retrieved = auth.getTransportSession(session.id);
      expect(retrieved).toEqual(session);
    });

    it('getTransportSession should return undefined for unknown id', () => {
      const auth = createAuth();
      expect(auth.getTransportSession('nonexistent')).toBeUndefined();
    });

    it('getAllSessions should return all sessions', () => {
      const auth = createAuth();
      // mock returns same uuid each time, but the Map uses it as key,
      // so effectively only one entry. Let's test with one session.
      auth.createTransportSession('sse');
      const sessions = auth.getAllSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].protocol).toBe('sse');
    });

    it('getAllSessions should return empty array when no sessions', () => {
      const auth = createAuth();
      expect(auth.getAllSessions()).toEqual([]);
    });

    it('removeTransportSession should delete and return true', () => {
      const auth = createAuth();
      const session = auth.createTransportSession('sse');
      const result = auth.removeTransportSession(session.id);
      expect(result).toBe(true);
      expect(auth.getTransportSession(session.id)).toBeUndefined();
    });

    it('removeTransportSession should return false for unknown id', () => {
      const auth = createAuth();
      expect(auth.removeTransportSession('nope')).toBe(false);
    });

    it('sessionCount should return the number of sessions', () => {
      const auth = createAuth();
      expect(auth.sessionCount).toBe(0);
      auth.createTransportSession('sse');
      expect(auth.sessionCount).toBe(1);
    });
  });

  // ========================================
  // Scope Checks
  // ========================================
  describe('scope checks', () => {
    it('hasScope should return true for existing scope', () => {
      const auth = createAuth({ scopes: ['read', 'write'] });
      expect(auth.hasScope('read')).toBe(true);
    });

    it('hasScope should return false for missing scope', () => {
      const auth = createAuth({ scopes: ['read'] });
      expect(auth.hasScope('admin')).toBe(false);
    });

    it('hasScope should return false when scopes are empty', () => {
      const auth = createAuth();
      expect(auth.hasScope('read')).toBe(false);
    });

    it('hasAllScopes should return true when all scopes present', () => {
      const auth = createAuth({ scopes: ['read', 'write', 'admin'] });
      expect(auth.hasAllScopes(['read', 'write'])).toBe(true);
    });

    it('hasAllScopes should return false when some scopes missing', () => {
      const auth = createAuth({ scopes: ['read'] });
      expect(auth.hasAllScopes(['read', 'write'])).toBe(false);
    });

    it('hasAllScopes should return true for empty check array', () => {
      const auth = createAuth();
      expect(auth.hasAllScopes([])).toBe(true);
    });

    it('hasAnyScope should return true when at least one scope present', () => {
      const auth = createAuth({ scopes: ['read'] });
      expect(auth.hasAnyScope(['read', 'admin'])).toBe(true);
    });

    it('hasAnyScope should return false when no scope matches', () => {
      const auth = createAuth({ scopes: ['read'] });
      expect(auth.hasAnyScope(['admin', 'delete'])).toBe(false);
    });

    it('hasAnyScope should return false for empty check array', () => {
      const auth = createAuth({ scopes: ['read'] });
      expect(auth.hasAnyScope([])).toBe(false);
    });
  });

  // ========================================
  // Access Control
  // ========================================
  describe('access control', () => {
    it('canAccessTool should return true if toolId in authorizedTools', () => {
      const auth = createAuth({
        authorizedTools: { search: { executionPath: ['app1', 'search'] } },
      });
      expect(auth.canAccessTool('search')).toBe(true);
    });

    it('canAccessTool should return true if toolId in authorizedToolIds', () => {
      const auth = createAuth({ authorizedToolIds: ['search'] });
      expect(auth.canAccessTool('search')).toBe(true);
    });

    it('canAccessTool should return false for unauthorized tool', () => {
      const auth = createAuth({
        authorizedTools: { search: { executionPath: ['app1', 'search'] } },
      });
      expect(auth.canAccessTool('delete')).toBe(false);
    });

    it('canAccessPrompt should return true if promptId in authorizedPrompts', () => {
      const auth = createAuth({
        authorizedPrompts: { greeting: { executionPath: ['app1', 'greeting'] } },
      });
      expect(auth.canAccessPrompt('greeting')).toBe(true);
    });

    it('canAccessPrompt should return true if promptId in authorizedPromptIds', () => {
      const auth = createAuth({ authorizedPromptIds: ['greeting'] });
      expect(auth.canAccessPrompt('greeting')).toBe(true);
    });

    it('canAccessPrompt should return false for unauthorized prompt', () => {
      const auth = createAuth();
      expect(auth.canAccessPrompt('secret')).toBe(false);
    });

    it('isAppAuthorized should return true if appId in authorizedApps', () => {
      const auth = createAuth({
        authorizedApps: { slack: { id: 'slack', toolIds: ['send'] } },
      });
      expect(auth.isAppAuthorized('slack')).toBe(true);
    });

    it('isAppAuthorized should return true if appId in authorizedAppIds', () => {
      const auth = createAuth({ authorizedAppIds: ['slack'] });
      expect(auth.isAppAuthorized('slack')).toBe(true);
    });

    it('isAppAuthorized should return false for unauthorized app', () => {
      const auth = createAuth();
      expect(auth.isAppAuthorized('slack')).toBe(false);
    });
  });

  // ========================================
  // Progressive Auth URL
  // ========================================
  describe('getProgressiveAuthUrl', () => {
    it('should construct the correct URL', () => {
      const auth = createAuth();
      const url = auth.getProgressiveAuthUrl('slack', 'https://example.com');
      expect(url).toBe('https://example.com/oauth/authorize?app=slack&mode=incremental');
    });

    it('should encode special characters in appId', () => {
      const auth = createAuth();
      const url = auth.getProgressiveAuthUrl('app with spaces', 'https://example.com');
      expect(url).toBe('https://example.com/oauth/authorize?app=app%20with%20spaces&mode=incremental');
    });

    it('should handle trailing slash in baseUrl gracefully', () => {
      const auth = createAuth();
      const url = auth.getProgressiveAuthUrl('slack', 'https://example.com/');
      expect(url).toContain('/oauth/authorize');
    });
  });

  // ========================================
  // Expiry logic
  // ========================================
  describe('isExpired / getTimeToExpiry', () => {
    it('isExpired should return false when no expiresAt set', () => {
      const auth = createAuth();
      expect(auth.isExpired()).toBe(false);
    });

    it('isExpired should return false when expiresAt is in the future', () => {
      const auth = createAuth({ expiresAt: Date.now() + 60000 });
      expect(auth.isExpired()).toBe(false);
    });

    it('isExpired should return true when expiresAt is in the past', () => {
      const auth = createAuth({ expiresAt: Date.now() - 1000 });
      expect(auth.isExpired()).toBe(true);
    });

    it('getTimeToExpiry should return undefined when no expiresAt', () => {
      const auth = createAuth();
      expect(auth.getTimeToExpiry()).toBeUndefined();
    });

    it('getTimeToExpiry should return positive value when not expired', () => {
      const auth = createAuth({ expiresAt: Date.now() + 60000 });
      const ttl = auth.getTimeToExpiry();
      expect(ttl).toBeDefined();
      expect(ttl!).toBeGreaterThan(0);
    });

    it('getTimeToExpiry should return negative value when expired', () => {
      const auth = createAuth({ expiresAt: Date.now() - 5000 });
      const ttl = auth.getTimeToExpiry();
      expect(ttl).toBeDefined();
      expect(ttl!).toBeLessThan(0);
    });
  });

  // ========================================
  // toSessionJwt
  // ========================================
  describe('toSessionJwt', () => {
    it('should call encryptJson with correct payload and return result', () => {
      const auth = createAuth({ expiresAt: 2000000 });
      const session: TransportSession = {
        id: 'sess-1',
        authorizationId: 'auth-id-1',
        protocol: 'sse',
        createdAt: Date.now(),
        nodeId: 'node-1',
      };

      const result = auth.toSessionJwt(session);

      expect(result).toBe(MOCK_ENCRYPTED);
      expect(encryptJson).toHaveBeenCalledTimes(1);
      const payload = (encryptJson as jest.Mock).mock.calls[0][0];
      expect(payload.sid).toBe('sess-1');
      expect(payload.aid).toBe('auth-id-1');
      expect(payload.proto).toBe('sse');
      expect(payload.nid).toBe('node-1');
      expect(typeof payload.iat).toBe('number');
      expect(payload.exp).toBe(Math.floor(2000000 / 1000));
    });

    it('should set exp to undefined when authorization has no expiresAt', () => {
      const auth = createAuth();
      const session: TransportSession = {
        id: 'sess-2',
        authorizationId: 'auth-id-1',
        protocol: 'streamable-http',
        createdAt: Date.now(),
        nodeId: 'node-1',
      };

      auth.toSessionJwt(session);

      const payload = (encryptJson as jest.Mock).mock.calls[0][0];
      expect(payload.exp).toBeUndefined();
    });
  });

  // ========================================
  // toLLMSafeContext
  // ========================================
  describe('toLLMSafeContext', () => {
    it('should return correct LLM-safe context', () => {
      const auth = createAuth({
        scopes: ['read'],
        authorizedToolIds: ['search'],
        authorizedPromptIds: ['greeting'],
      });
      const session: TransportSession = {
        id: 'sess-1',
        authorizationId: 'auth-id-1',
        protocol: 'sse',
        createdAt: Date.now(),
        nodeId: 'node-1',
      };

      const ctx = auth.toLLMSafeContext(session);

      expect(ctx.authorizationId).toBe('auth-id-1');
      expect(ctx.sessionId).toBe('sess-1');
      expect(ctx.mode).toBe('public');
      expect(ctx.isAnonymous).toBe(false);
      expect(ctx.user).toEqual({ sub: 'user-1', name: 'Test User' });
      expect(ctx.scopes).toEqual(['read']);
      expect(ctx.authorizedToolIds).toEqual(['search']);
      expect(ctx.authorizedPromptIds).toEqual(['greeting']);
    });

    it('should only include sub and name in user field', () => {
      const auth = new TestAuthorization({
        id: 'auth-1',
        isAnonymous: false,
        user: { sub: 'u1', name: 'Alice', email: 'alice@example.com', picture: 'http://pic.com/alice' },
      });
      const session: TransportSession = {
        id: 'sess-1',
        authorizationId: 'auth-1',
        protocol: 'sse',
        createdAt: Date.now(),
        nodeId: 'n1',
      };

      const ctx = auth.toLLMSafeContext(session);
      expect(ctx.user).toEqual({ sub: 'u1', name: 'Alice' });
      expect((ctx.user as Record<string, unknown>)['email']).toBeUndefined();
    });
  });

  // ========================================
  // validateNoTokenLeakage (static)
  // ========================================
  describe('validateNoTokenLeakage', () => {
    it('should not throw for safe data', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ message: 'Hello', count: 42 })).not.toThrow();
    });

    it('should throw TokenLeakDetectedError for JWT pattern', () => {
      const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(() => AuthorizationBase.validateNoTokenLeakage({ token: jwtLike })).toThrow(TokenLeakDetectedError);
    });

    it('should throw for JWT pattern in nested data', () => {
      const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.signature123';
      expect(() => AuthorizationBase.validateNoTokenLeakage({ nested: { deep: jwt } })).toThrow(TokenLeakDetectedError);
    });

    it('should throw for access_token field', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ access_token: 'abc123' })).toThrow(
        TokenLeakDetectedError,
      );
    });

    it('should throw for refresh_token field', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ refresh_token: 'abc' })).toThrow(TokenLeakDetectedError);
    });

    it('should throw for id_token field', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ id_token: 'abc' })).toThrow(TokenLeakDetectedError);
    });

    it('should throw for tokenEnc field', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ tokenEnc: 'enc-data' })).toThrow(TokenLeakDetectedError);
    });

    it('should throw for secretRefId field', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ secretRefId: 'ref-123' })).toThrow(
        TokenLeakDetectedError,
      );
    });

    it('should throw with descriptive message for JWT pattern', () => {
      const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.sig';
      try {
        AuthorizationBase.validateNoTokenLeakage({ data: jwt });
        fail('Expected TokenLeakDetectedError');
      } catch (e) {
        expect(e).toBeInstanceOf(TokenLeakDetectedError);
        expect((e as Error).message).toContain('JWT pattern detected');
      }
    });

    it('should throw with descriptive message for sensitive field', () => {
      try {
        AuthorizationBase.validateNoTokenLeakage({ access_token: 'xyz' });
        fail('Expected TokenLeakDetectedError');
      } catch (e) {
        expect(e).toBeInstanceOf(TokenLeakDetectedError);
        expect((e as Error).message).toContain('access_token');
      }
    });

    it('should handle null/undefined/primitives without throwing', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage(null)).not.toThrow();
      expect(() => AuthorizationBase.validateNoTokenLeakage(42)).not.toThrow();
      expect(() => AuthorizationBase.validateNoTokenLeakage('safe string')).not.toThrow();
    });

    it('should handle arrays without throwing for safe data', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage([1, 'hello', { safe: true }])).not.toThrow();
    });

    it('should not throw for domain-like strings (e.g. api.example.com)', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ url: 'api.example.com' })).not.toThrow();
      expect(() => AuthorizationBase.validateNoTokenLeakage({ domain: 'service.example.org' })).not.toThrow();
      expect(() => AuthorizationBase.validateNoTokenLeakage({ namespace: 'com.example.app' })).not.toThrow();
    });

    it('should not throw for version-like or IP-like strings', () => {
      expect(() => AuthorizationBase.validateNoTokenLeakage({ version: '1.2.3' })).not.toThrow();
      expect(() => AuthorizationBase.validateNoTokenLeakage({ ip: '192.168.1.1' })).not.toThrow();
    });
  });
});
