/**
 * Authorization Store Tests
 */
import {
  verifyPkce,
  generatePkceChallenge,
  InMemoryAuthorizationStore,
  RedisAuthorizationStore,
} from '../authorization.store';
import type {
  PkceChallenge,
  AuthorizationCodeRecord,
  PendingAuthorizationRecord,
  RefreshTokenRecord,
} from '../authorization.store';
import { assertDefined } from '../../__test-utils__/assertion.helpers';

// Mock @frontmcp/utils - spread real module and only mock randomUUID
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils');
  let callCount = 0;
  return {
    ...actual,
    randomUUID: jest.fn(() => `uuid-${++callCount}`),
  };
});

// ============================================
// Test Helpers
// ============================================

function makePkceChallenge(verifier: string): PkceChallenge {
  return generatePkceChallenge(verifier);
}

function makeCodeRecord(
  store: InMemoryAuthorizationStore,
  overrides?: Partial<Parameters<InMemoryAuthorizationStore['createCodeRecord']>[0]>,
): AuthorizationCodeRecord {
  return store.createCodeRecord({
    clientId: 'client-1',
    redirectUri: 'https://example.com/callback',
    scopes: ['openid', 'profile'],
    pkce: makePkceChallenge('test-verifier'),
    userSub: 'user-123',
    ...overrides,
  });
}

function makePendingRecord(
  store: InMemoryAuthorizationStore,
  overrides?: Partial<Parameters<InMemoryAuthorizationStore['createPendingRecord']>[0]>,
): PendingAuthorizationRecord {
  return store.createPendingRecord({
    clientId: 'client-1',
    redirectUri: 'https://example.com/callback',
    scopes: ['openid'],
    pkce: makePkceChallenge('test-verifier'),
    ...overrides,
  });
}

function makeRefreshTokenRecord(
  store: InMemoryAuthorizationStore,
  overrides?: Partial<Parameters<InMemoryAuthorizationStore['createRefreshTokenRecord']>[0]>,
): RefreshTokenRecord {
  return store.createRefreshTokenRecord({
    clientId: 'client-1',
    userSub: 'user-123',
    scopes: ['openid'],
    ...overrides,
  });
}

// ============================================
// Tests
// ============================================

describe('PKCE Utilities', () => {
  describe('verifyPkce', () => {
    it('should return true for correct verifier', () => {
      const verifier = 'my-secret-code-verifier-value';
      const challenge = generatePkceChallenge(verifier);
      expect(verifyPkce(verifier, challenge)).toBe(true);
    });

    it('should return false for wrong verifier', () => {
      const challenge = generatePkceChallenge('correct-verifier');
      expect(verifyPkce('wrong-verifier', challenge)).toBe(false);
    });

    it('should return false for non-S256 method', () => {
      const challenge: PkceChallenge = {
        challenge: 'some-challenge',
        method: 'plain' as 'S256',
      };
      expect(verifyPkce('any-verifier', challenge)).toBe(false);
    });
  });

  describe('generatePkceChallenge', () => {
    it('should return challenge with S256 method', () => {
      const result = generatePkceChallenge('my-verifier');
      expect(result.method).toBe('S256');
      expect(typeof result.challenge).toBe('string');
      expect(result.challenge.length).toBeGreaterThan(0);
    });

    it('should produce deterministic output for same input', () => {
      const a = generatePkceChallenge('same-input');
      const b = generatePkceChallenge('same-input');
      expect(a.challenge).toBe(b.challenge);
    });

    it('should produce different output for different input', () => {
      const a = generatePkceChallenge('input-a');
      const b = generatePkceChallenge('input-b');
      expect(a.challenge).not.toBe(b.challenge);
    });
  });
});

describe('InMemoryAuthorizationStore', () => {
  let store: InMemoryAuthorizationStore;

  beforeEach(() => {
    store = new InMemoryAuthorizationStore();
  });

  describe('generateCode', () => {
    it('should return a non-empty string', () => {
      const code = store.generateCode();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });

    it('should generate unique codes', () => {
      const codes = new Set(Array.from({ length: 10 }, () => store.generateCode()));
      expect(codes.size).toBe(10);
    });
  });

  describe('generateRefreshToken', () => {
    it('should return a non-empty string', () => {
      const token = store.generateRefreshToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should contain a dash (uuid-uuid format)', () => {
      const token = store.generateRefreshToken();
      expect(token).toContain('-');
    });
  });

  // ----------------------------------------
  // Authorization Code CRUD
  // ----------------------------------------
  describe('Authorization Code operations', () => {
    it('should store and get a code record', async () => {
      const record = makeCodeRecord(store);
      await store.storeAuthorizationCode(record);
      const retrieved = await store.getAuthorizationCode(record.code);
      expect(retrieved).toEqual(record);
    });

    it('should return null for unknown code', async () => {
      const result = await store.getAuthorizationCode('nonexistent');
      expect(result).toBeNull();
    });

    it('should mark code as used', async () => {
      const record = makeCodeRecord(store);
      await store.storeAuthorizationCode(record);
      await store.markCodeUsed(record.code);
      const retrieved = await store.getAuthorizationCode(record.code);
      assertDefined(retrieved);
      expect(retrieved.used).toBe(true);
    });

    it('should silently ignore markCodeUsed for unknown code', async () => {
      // Should not throw
      await store.markCodeUsed('nonexistent');
    });

    it('should delete a code record', async () => {
      const record = makeCodeRecord(store);
      await store.storeAuthorizationCode(record);
      await store.deleteAuthorizationCode(record.code);
      const result = await store.getAuthorizationCode(record.code);
      expect(result).toBeNull();
    });

    it('should return null for expired code', async () => {
      const record = makeCodeRecord(store);
      // Set expiration in the past
      record.expiresAt = Date.now() - 1000;
      await store.storeAuthorizationCode(record);
      const result = await store.getAuthorizationCode(record.code);
      expect(result).toBeNull();
    });
  });

  // ----------------------------------------
  // Pending Authorization CRUD
  // ----------------------------------------
  describe('Pending Authorization operations', () => {
    it('should store and get a pending record', async () => {
      const record = makePendingRecord(store);
      await store.storePendingAuthorization(record);
      const retrieved = await store.getPendingAuthorization(record.id);
      expect(retrieved).toEqual(record);
    });

    it('should return null for unknown pending id', async () => {
      const result = await store.getPendingAuthorization('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete a pending record', async () => {
      const record = makePendingRecord(store);
      await store.storePendingAuthorization(record);
      await store.deletePendingAuthorization(record.id);
      const result = await store.getPendingAuthorization(record.id);
      expect(result).toBeNull();
    });

    it('should return null for expired pending authorization', async () => {
      const record = makePendingRecord(store);
      record.expiresAt = Date.now() - 1000;
      await store.storePendingAuthorization(record);
      const result = await store.getPendingAuthorization(record.id);
      expect(result).toBeNull();
    });
  });

  // ----------------------------------------
  // Refresh Token CRUD
  // ----------------------------------------
  describe('Refresh Token operations', () => {
    it('should store and get a refresh token', async () => {
      const record = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(record);
      const retrieved = await store.getRefreshToken(record.token);
      expect(retrieved).toEqual(record);
    });

    it('should return null for unknown refresh token', async () => {
      const result = await store.getRefreshToken('nonexistent');
      expect(result).toBeNull();
    });

    it('should revoke a refresh token', async () => {
      const record = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(record);
      await store.revokeRefreshToken(record.token);
      const result = await store.getRefreshToken(record.token);
      expect(result).toBeNull();
    });

    it('should silently ignore revokeRefreshToken for unknown token', async () => {
      await store.revokeRefreshToken('nonexistent');
    });

    it('should return null for expired refresh token', async () => {
      const record = makeRefreshTokenRecord(store);
      record.expiresAt = Date.now() - 1000;
      await store.storeRefreshToken(record);
      const result = await store.getRefreshToken(record.token);
      expect(result).toBeNull();
    });

    it('should rotate a refresh token', async () => {
      const oldRecord = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(oldRecord);

      const newRecord = makeRefreshTokenRecord(store);
      await store.rotateRefreshToken(oldRecord.token, newRecord);

      // Old token is revoked
      const oldRetrieved = await store.getRefreshToken(oldRecord.token);
      expect(oldRetrieved).toBeNull();

      // New token is available with previousToken set
      const newRetrieved = await store.getRefreshToken(newRecord.token);
      assertDefined(newRetrieved);
      expect(newRetrieved.previousToken).toBe(oldRecord.token);
    });
  });

  // ----------------------------------------
  // Cleanup
  // ----------------------------------------
  describe('cleanup', () => {
    it('should remove expired codes', async () => {
      const expired = makeCodeRecord(store);
      expired.expiresAt = Date.now() - 1000;
      await store.storeAuthorizationCode(expired);

      const valid = makeCodeRecord(store);
      await store.storeAuthorizationCode(valid);

      await store.cleanup();

      expect(await store.getAuthorizationCode(expired.code)).toBeNull();
      expect(await store.getAuthorizationCode(valid.code)).not.toBeNull();
    });

    it('should remove expired pending authorizations', async () => {
      const expired = makePendingRecord(store);
      expired.expiresAt = Date.now() - 1000;
      await store.storePendingAuthorization(expired);

      await store.cleanup();
      // Already cleaned up by getpendingAuthorization too, but cleanup explicitly removes
      expect(await store.getPendingAuthorization(expired.id)).toBeNull();
    });

    it('should remove expired and revoked refresh tokens', async () => {
      const expired = makeRefreshTokenRecord(store);
      expired.expiresAt = Date.now() - 1000;
      await store.storeRefreshToken(expired);

      const revoked = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(revoked);
      await store.revokeRefreshToken(revoked.token);

      const valid = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(valid);

      await store.cleanup();

      expect(await store.getRefreshToken(expired.token)).toBeNull();
      expect(await store.getRefreshToken(revoked.token)).toBeNull();
      expect(await store.getRefreshToken(valid.token)).not.toBeNull();
    });
  });

  // ----------------------------------------
  // Factory methods
  // ----------------------------------------
  describe('createCodeRecord', () => {
    it('should set defaults (code, createdAt, expiresAt, used)', () => {
      const record = makeCodeRecord(store);
      expect(record.code).toBeDefined();
      expect(typeof record.code).toBe('string');
      expect(record.createdAt).toBeLessThanOrEqual(Date.now());
      expect(record.expiresAt).toBeGreaterThan(record.createdAt);
      expect(record.used).toBe(false);
    });

    it('should set provided fields', () => {
      const record = makeCodeRecord(store, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        state: 'my-state',
        resource: 'https://api.example.com',
        selectedToolIds: ['tool1'],
        consentEnabled: true,
        federatedLoginUsed: true,
        pendingAuthId: 'pending-123',
      });
      expect(record.userEmail).toBe('test@example.com');
      expect(record.userName).toBe('Test User');
      expect(record.state).toBe('my-state');
      expect(record.resource).toBe('https://api.example.com');
      expect(record.selectedToolIds).toEqual(['tool1']);
      expect(record.consentEnabled).toBe(true);
      expect(record.federatedLoginUsed).toBe(true);
      expect(record.pendingAuthId).toBe('pending-123');
    });
  });

  describe('createPendingRecord', () => {
    it('should set defaults (id, createdAt, expiresAt)', () => {
      const record = makePendingRecord(store);
      expect(record.id).toBeDefined();
      expect(typeof record.id).toBe('string');
      expect(record.createdAt).toBeLessThanOrEqual(Date.now());
      expect(record.expiresAt).toBeGreaterThan(record.createdAt);
    });

    it('should set incremental auth fields', () => {
      const record = makePendingRecord(store, {
        isIncremental: true,
        targetAppId: 'app-1',
        targetToolId: 'tool-1',
        existingSessionId: 'session-1',
        existingAuthorizationId: 'auth-1',
      });
      expect(record.isIncremental).toBe(true);
      expect(record.targetAppId).toBe('app-1');
      expect(record.targetToolId).toBe('tool-1');
      expect(record.existingSessionId).toBe('session-1');
      expect(record.existingAuthorizationId).toBe('auth-1');
    });

    it('should set consent and federated login state', () => {
      const record = makePendingRecord(store, {
        consent: {
          enabled: true,
          availableToolIds: ['tool-a', 'tool-b'],
          consentCompleted: false,
        },
        federatedLogin: {
          providerIds: ['google', 'github'],
        },
      });
      assertDefined(record.consent);
      expect(record.consent.enabled).toBe(true);
      assertDefined(record.federatedLogin);
      expect(record.federatedLogin.providerIds).toEqual(['google', 'github']);
    });
  });

  describe('createRefreshTokenRecord', () => {
    it('should set defaults (token, createdAt, expiresAt, revoked)', () => {
      const record = makeRefreshTokenRecord(store);
      expect(record.token).toBeDefined();
      expect(typeof record.token).toBe('string');
      expect(record.createdAt).toBeLessThanOrEqual(Date.now());
      expect(record.expiresAt).toBeGreaterThan(record.createdAt);
      expect(record.revoked).toBe(false);
    });

    it('should set optional resource', () => {
      const record = makeRefreshTokenRecord(store, {
        resource: 'https://api.example.com',
      });
      expect(record.resource).toBe('https://api.example.com');
    });
  });
});

describe('RedisAuthorizationStore', () => {
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let store: RedisAuthorizationStore;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    store = new RedisAuthorizationStore(mockRedis, 'test:');
  });

  describe('key format', () => {
    it('should use namespace prefix for code keys', async () => {
      mockRedis.get.mockResolvedValue(null);
      await store.getAuthorizationCode('mycode');
      expect(mockRedis.get).toHaveBeenCalledWith('test:code:mycode');
    });

    it('should use namespace prefix for pending keys', async () => {
      mockRedis.get.mockResolvedValue(null);
      await store.getPendingAuthorization('myid');
      expect(mockRedis.get).toHaveBeenCalledWith('test:pending:myid');
    });

    it('should use namespace prefix for refresh keys', async () => {
      mockRedis.get.mockResolvedValue(null);
      await store.getRefreshToken('mytoken');
      expect(mockRedis.get).toHaveBeenCalledWith('test:refresh:mytoken');
    });
  });

  describe('generateCode', () => {
    it('should return a string', () => {
      const code = store.generateCode();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });
  });

  describe('generateRefreshToken', () => {
    it('should return a string', () => {
      const token = store.generateRefreshToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe('storeAuthorizationCode', () => {
    it('should store with EX TTL', async () => {
      const record: AuthorizationCodeRecord = {
        code: 'test-code',
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: ['openid'],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        used: false,
      };
      await store.storeAuthorizationCode(record);
      expect(mockRedis.set).toHaveBeenCalledWith('test:code:test-code', expect.any(String), 'EX', expect.any(Number));
      const storedJson = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(storedJson.code).toBe('test-code');
    });
  });

  describe('getAuthorizationCode', () => {
    it('should return null when not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await store.getAuthorizationCode('nonexistent');
      expect(result).toBeNull();
    });

    it('should parse stored JSON', async () => {
      const record = {
        code: 'c1',
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: ['openid'],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        used: false,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      const result = await store.getAuthorizationCode('c1');
      expect(result).toEqual(record);
    });
  });

  describe('markCodeUsed', () => {
    it('should update the record with used=true', async () => {
      const record = {
        code: 'c1',
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
        used: false,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      await store.markCodeUsed('c1');
      expect(mockRedis.set).toHaveBeenCalled();
      const storedJson = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(storedJson.used).toBe(true);
    });

    it('should do nothing if code not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      await store.markCodeUsed('nonexistent');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('deleteAuthorizationCode', () => {
    it('should call redis del', async () => {
      await store.deleteAuthorizationCode('c1');
      expect(mockRedis.del).toHaveBeenCalledWith('test:code:c1');
    });
  });

  describe('storePendingAuthorization', () => {
    it('should store with TTL', async () => {
      const record: PendingAuthorizationRecord = {
        id: 'pending-1',
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000,
      };
      await store.storePendingAuthorization(record);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:pending:pending-1',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('getPendingAuthorization', () => {
    it('should return null when not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await store.getPendingAuthorization('x')).toBeNull();
    });

    it('should parse stored JSON', async () => {
      const record = { id: 'p1', clientId: 'c1' };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      const result = await store.getPendingAuthorization('p1');
      expect(result).toEqual(record);
    });
  });

  describe('deletePendingAuthorization', () => {
    it('should call redis del', async () => {
      await store.deletePendingAuthorization('p1');
      expect(mockRedis.del).toHaveBeenCalledWith('test:pending:p1');
    });
  });

  describe('storeRefreshToken', () => {
    it('should store with TTL', async () => {
      const record: RefreshTokenRecord = {
        token: 'rt-1',
        clientId: 'client-1',
        userSub: 'user-1',
        scopes: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        revoked: false,
      };
      await store.storeRefreshToken(record);
      expect(mockRedis.set).toHaveBeenCalledWith('test:refresh:rt-1', expect.any(String), 'EX', expect.any(Number));
    });
  });

  describe('getRefreshToken', () => {
    it('should return null when not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await store.getRefreshToken('x')).toBeNull();
    });

    it('should return null for revoked token', async () => {
      const record = { token: 'rt-1', revoked: true };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      expect(await store.getRefreshToken('rt-1')).toBeNull();
    });

    it('should return valid token', async () => {
      const record = { token: 'rt-1', revoked: false, clientId: 'c1' };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      const result = await store.getRefreshToken('rt-1');
      expect(result).toEqual(record);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should update record with revoked=true', async () => {
      const record = {
        token: 'rt-1',
        revoked: false,
        expiresAt: Date.now() + 86400000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(record));
      await store.revokeRefreshToken('rt-1');
      expect(mockRedis.set).toHaveBeenCalled();
      const storedJson = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(storedJson.revoked).toBe(true);
    });

    it('should do nothing for non-existent token', async () => {
      // getRefreshToken returns null when not found
      mockRedis.get.mockResolvedValue(null);
      await store.revokeRefreshToken('nonexistent');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken', () => {
    it('should revoke old token and store new one with previousToken', async () => {
      const oldRecord = {
        token: 'old-rt',
        revoked: false,
        expiresAt: Date.now() + 86400000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(oldRecord));

      const newRecord: RefreshTokenRecord = {
        token: 'new-rt',
        clientId: 'client-1',
        userSub: 'user-1',
        scopes: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        revoked: false,
      };

      await store.rotateRefreshToken('old-rt', newRecord);

      // Should have called set twice: once for revoke, once for new
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      expect(newRecord.previousToken).toBe('old-rt');
    });
  });

  describe('cleanup', () => {
    it('should be a no-op (Redis handles TTL)', async () => {
      // Should not throw
      await store.cleanup();
    });
  });

  describe('default namespace', () => {
    it('should use "oauth:" as default namespace', async () => {
      const defaultStore = new RedisAuthorizationStore(mockRedis);
      mockRedis.get.mockResolvedValue(null);
      await defaultStore.getAuthorizationCode('test');
      expect(mockRedis.get).toHaveBeenCalledWith('oauth:code:test');
    });
  });
});
