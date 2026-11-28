/**
 * Authorization Store Tests
 */
import { assertDefined } from '../../__test-utils__/assertion.helpers';
import { AuthFlowError } from '../../errors/auth-internal.errors';
import { AuthorizationRowNames } from '../authorization-row-names';
import {
  generatePkceChallenge,
  InMemoryAuthorizationStore,
  isGrantRedeemedError,
  RedisAuthorizationStore,
  verifyPkce,
  type AuthorizationCodeRecord,
  type PendingAuthorizationRecord,
  type PkceChallenge,
  type RefreshTokenRecord,
} from '../authorization.store';

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

    it('should refuse to mark an unknown code used', async () => {
      await expect(store.markCodeUsed('nonexistent')).rejects.toThrow('already redeemed');
    });

    it('should let only one of two concurrent token requests mark a code used', async () => {
      const record = makeCodeRecord(store);
      await store.storeAuthorizationCode(record);

      const results = await Promise.allSettled([store.markCodeUsed(record.code), store.markCodeUsed(record.code)]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const refusal = results.find((result) => result.status === 'rejected');
      expect(isGrantRedeemedError(refusal?.reason)).toBe(true);
      expect(isGrantRedeemedError(new Error('already redeemed'))).toBe(false);
    });

    it('should record the refresh token issued from a code marked used', async () => {
      const record = makeCodeRecord(store);
      await store.storeAuthorizationCode(record);
      await store.markCodeUsed(record.code);
      await store.markCodeUsed(record.code, 'issued-refresh-token');

      expect((await store.getAuthorizationCode(record.code))?.issuedRefreshToken).toBe('issued-refresh-token');
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

    it('should let only one of two concurrent rotations of a refresh token succeed', async () => {
      const oldRecord = makeRefreshTokenRecord(store);
      await store.storeRefreshToken(oldRecord);
      const firstSuccessor = makeRefreshTokenRecord(store);
      const secondSuccessor = makeRefreshTokenRecord(store);

      const results = await Promise.allSettled([
        store.rotateRefreshToken(oldRecord.token, firstSuccessor),
        store.rotateRefreshToken(oldRecord.token, secondSuccessor),
      ]);
      const liveSuccessors = [
        await store.getRefreshToken(firstSuccessor.token),
        await store.getRefreshToken(secondSuccessor.token),
      ].filter((record) => record !== null);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(liveSuccessors).toHaveLength(1);
      const refusal = results.find((result) => result.status === 'rejected');
      expect(isGrantRedeemedError(refusal?.reason)).toBe(true);
    });

    it('should refuse to rotate an unknown refresh token', async () => {
      const newRecord = makeRefreshTokenRecord(store);

      await expect(store.rotateRefreshToken('nonexistent', newRecord)).rejects.toThrow('already rotated');
      expect(await store.getRefreshToken(newRecord.token)).toBeNull();
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

    it('should carry customClaims from a local authenticate() verifier (Checkpoint 3a)', () => {
      const record = makeCodeRecord(store, {
        customClaims: { tenantId: 'acme', plan: 'pro' },
      });
      expect(record.customClaims).toEqual({ tenantId: 'acme', plan: 'pro' });
    });

    it('should leave customClaims undefined when not provided', () => {
      const record = makeCodeRecord(store);
      expect(record.customClaims).toBeUndefined();
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

    it('should keep the client auth method', () => {
      expect(makePendingRecord(store, { clientAuthMethod: 'client_secret_basic' }).clientAuthMethod).toBe(
        'client_secret_basic',
      );
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

    it('should keep the client auth method on a code', () => {
      const record = store.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://app.example.com/cb',
        scopes: [],
        pkce: { challenge: 'c'.repeat(43), method: 'S256' },
        userSub: 'user-1',
        clientAuthMethod: 'client_secret_post',
      });
      expect(record.clientAuthMethod).toBe('client_secret_post');
    });

    it('should keep the client auth method', () => {
      const record = makeRefreshTokenRecord(store, { clientAuthMethod: 'client_secret_basic' });
      expect(record.clientAuthMethod).toBe('client_secret_basic');
    });
  });
});

describe('RedisAuthorizationStore', () => {
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    eval: jest.Mock;
  };
  let store: RedisAuthorizationStore;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    store = new RedisAuthorizationStore(mockRedis, 'test:');
  });

  /** A Redis stand-in whose `eval` runs the compare-and-delete script against a map. */
  function fakeRedis() {
    const values = new Map<string, string>();
    return {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        values.set(key, value);
        return 'OK';
      },
      del: async (key: string) => Number(values.delete(key)),
      eval: async (_script: string, _keyCount: number, key: string, expected: string) =>
        values.get(key) === expected ? Number(values.delete(key)) : 0,
    };
  }

  /** Expect `pending` to reject with the AuthFlowError a store throws for a code or refresh token it refuses. */
  async function expectRefused(
    pending: Promise<unknown>,
    code: 'AUTHORIZATION_CODE_REDEEMED' | 'REFRESH_TOKEN_REDEEMED',
  ) {
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AuthFlowError);
    expect(error).toMatchObject({ code });
  }

  /** The row name of `value` without a key hash secret. */
  function hashed(value: string): string {
    return new AuthorizationRowNames().name(value);
  }

  describe('a row name presented as a value', () => {
    it('should find, rotate, revoke and delete no refresh token by the name of its row', async () => {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      const record = redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] });
      await redisStore.storeRefreshToken(record);
      const rowName = hashed(record.token);

      expect(await redisStore.getRefreshToken(rowName)).toBeNull();
      await expectRefused(
        redisStore.rotateRefreshToken(
          rowName,
          redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] }),
        ),
        'REFRESH_TOKEN_REDEEMED',
      );
      await redisStore.revokeRefreshToken(rowName);

      expect(await redisStore.getRefreshToken(record.token)).toEqual(record);
    });

    it('should find, redeem and delete no code by the name of its row', async () => {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      const record = redisStore.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
      });
      await redisStore.storeAuthorizationCode(record);
      const rowName = hashed(record.code);

      expect(await redisStore.getAuthorizationCode(rowName)).toBeNull();
      await expectRefused(redisStore.markCodeUsed(rowName), 'AUTHORIZATION_CODE_REDEEMED');
      await redisStore.deleteAuthorizationCode(rowName);

      expect(await redisStore.getAuthorizationCode(record.code)).toEqual(record);
    });

    it('should read no row that is not valid JSON or holds null', async () => {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      await redis.set('oauth:refresh:not-json', 'plain text');
      await redis.set('oauth:refresh:null-row', 'null');

      expect(await redisStore.getRefreshToken('not-json')).toBeNull();
      expect(await redisStore.getRefreshToken('null-row')).toBeNull();
    });
  });

  describe('a row moved between the two reads', () => {
    /** A Redis stand-in holding a code under its old name, which moves under its hashed name when that name is first read. */
    function movingCode() {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      const record = redisStore.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
      });
      const legacyKey = `oauth:code:${record.code}`;
      const get = redis.get;
      let moved = false;
      redis.get = async (key: string) => {
        if (key === legacyKey && !moved) {
          moved = true;
          await redis.set(`oauth:code:${hashed(record.code)}`, JSON.stringify(record));
          await redis.del(legacyKey);
        }
        return get(key);
      };
      return { redis, redisStore, record, legacyKey };
    }

    it('should read a code that moved under its hashed name after that name was read', async () => {
      const { redis, redisStore, record, legacyKey } = movingCode();
      await redis.set(legacyKey, JSON.stringify(record));

      expect(await redisStore.getAuthorizationCode(record.code)).toEqual(record);
    });

    it('should redeem a code that moved under its hashed name after that name was read, once', async () => {
      const { redis, redisStore, record, legacyKey } = movingCode();
      await redis.set(legacyKey, JSON.stringify(record));

      await redisStore.markCodeUsed(record.code);

      await expectRefused(redisStore.markCodeUsed(record.code), 'AUTHORIZATION_CODE_REDEEMED');
      expect((await redisStore.getAuthorizationCode(record.code))?.used).toBe(true);
    });
  });

  describe('rows named up to 1.13', () => {
    function legacyRefreshRow() {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      const record = redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] });
      return { redis, redisStore, record, legacyKey: `oauth:refresh:${record.token}` };
    }

    it('should rotate a refresh token stored under its old name once, and move it under its hashed name', async () => {
      const { redis, redisStore, record, legacyKey } = legacyRefreshRow();
      await redis.set(legacyKey, JSON.stringify(record));
      const successors = Array.from({ length: 4 }, () =>
        redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] }),
      );

      const results = await Promise.allSettled(
        successors.map((successor) => redisStore.rotateRefreshToken(record.token, successor)),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await redis.get(legacyKey)).toBeNull();
      expect(JSON.parse((await redis.get(`oauth:refresh:${hashed(record.token)}`)) ?? '{}')).toMatchObject({
        revoked: true,
      });
      expect(await redisStore.getRefreshToken(record.token)).toBeNull();
    });

    it('should redeem a code stored under its old name once', async () => {
      const redis = fakeRedis();
      const redisStore = new RedisAuthorizationStore(redis);
      const record = redisStore.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
      });
      await redis.set(`oauth:code:${record.code}`, JSON.stringify(record));

      const results = await Promise.allSettled([
        redisStore.markCodeUsed(record.code),
        redisStore.markCodeUsed(record.code),
        redisStore.markCodeUsed(record.code),
      ]);
      await redisStore.markCodeUsed(record.code, 'issued-refresh-token');

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await redis.get(`oauth:code:${record.code}`)).toBeNull();
      expect(await redisStore.getAuthorizationCode(record.code)).toMatchObject({
        used: true,
        issuedRefreshToken: 'issued-refresh-token',
      });
    });

    it('should revoke a refresh token stored under its old name under its hashed name', async () => {
      const { redis, redisStore, record, legacyKey } = legacyRefreshRow();
      await redis.set(legacyKey, JSON.stringify(record));

      await redisStore.revokeRefreshToken(record.token);

      expect(await redis.get(legacyKey)).toBeNull();
      expect(await redisStore.getRefreshToken(record.token)).toBeNull();
    });

    it('should read only the row under the hashed name when both names hold one', async () => {
      const { redis, redisStore, record, legacyKey } = legacyRefreshRow();
      await redis.set(`oauth:refresh:${hashed(record.token)}`, JSON.stringify({ ...record, revoked: true }));
      await redis.set(legacyKey, JSON.stringify(record));

      expect(await redisStore.getRefreshToken(record.token)).toBeNull();
      await expectRefused(
        redisStore.rotateRefreshToken(
          record.token,
          redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] }),
        ),
        'REFRESH_TOKEN_REDEEMED',
      );
    });
  });

  describe('concurrent redemptions', () => {
    it('should let only one of two concurrent token requests mark a code used', async () => {
      const redisStore = new RedisAuthorizationStore(fakeRedis());
      const record = redisStore.createCodeRecord({
        clientId: 'client-1',
        redirectUri: 'https://example.com/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'user-1',
      });
      await redisStore.storeAuthorizationCode(record);

      const results = await Promise.allSettled([
        redisStore.markCodeUsed(record.code),
        redisStore.markCodeUsed(record.code),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((await redisStore.getAuthorizationCode(record.code))?.used).toBe(true);
    });

    it('should let only one of two concurrent rotations of a refresh token succeed', async () => {
      const redisStore = new RedisAuthorizationStore(fakeRedis());
      const oldRecord = redisStore.createRefreshTokenRecord({ clientId: 'client-1', userSub: 'user-1', scopes: [] });
      await redisStore.storeRefreshToken(oldRecord);
      const firstSuccessor = redisStore.createRefreshTokenRecord({
        clientId: 'client-1',
        userSub: 'user-1',
        scopes: [],
      });
      const secondSuccessor = redisStore.createRefreshTokenRecord({
        clientId: 'client-1',
        userSub: 'user-1',
        scopes: [],
      });

      const results = await Promise.allSettled([
        redisStore.rotateRefreshToken(oldRecord.token, firstSuccessor),
        redisStore.rotateRefreshToken(oldRecord.token, secondSuccessor),
      ]);
      const liveSuccessors = [
        await redisStore.getRefreshToken(firstSuccessor.token),
        await redisStore.getRefreshToken(secondSuccessor.token),
      ].filter((record) => record !== null);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(liveSuccessors).toHaveLength(1);
    });
  });

  describe('key format', () => {
    it.each([
      ['code', (id: string) => store.getAuthorizationCode(id)],
      ['pending', (id: string) => store.getPendingAuthorization(id)],
      ['refresh', (id: string) => store.getRefreshToken(id)],
    ])(
      'should read a %s row under its hashed name, then under the name up to 1.13, then under the hashed name again',
      async (type, read) => {
        mockRedis.get.mockResolvedValue(null);
        await read('my-value');
        const hashedKey = `test:${type}:${hashed('my-value')}`;
        expect(mockRedis.get.mock.calls).toEqual([[hashedKey], [`test:${type}:my-value`], [hashedKey]]);
      },
    );

    it('should name rows by a hash keyed with keyHashSecret', async () => {
      const keyed = new RedisAuthorizationStore(mockRedis, 'test:', {
        keyHashSecret: 'a-stable-secret-of-at-least-32-bytes',
      });
      mockRedis.get.mockResolvedValue(null);
      await keyed.getRefreshToken('refresh-token-value');
      expect(mockRedis.get).toHaveBeenNthCalledWith(1, 'test:refresh:Jcf7JBzyq8-e0Vf_YB3lOGwyNs20xdrA6Gd4hELgsB8');
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
      expect(mockRedis.set).toHaveBeenCalledWith(
        `test:code:${hashed('test-code')}`,
        expect.any(String),
        'EX',
        expect.any(Number),
      );
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

    it('should refuse a code that is not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(store.markCodeUsed('nonexistent')).rejects.toThrow('already redeemed');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('deleteAuthorizationCode', () => {
    it('should delete the hashed row and the old row of the code', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ code: 'c1' }));
      await store.deleteAuthorizationCode('c1');
      expect(mockRedis.del.mock.calls).toEqual([[`test:code:${hashed('c1')}`], ['test:code:c1']]);
    });

    it('should keep an old row that holds another code', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ code: 'another-code' }));
      await store.deleteAuthorizationCode('c1');
      expect(mockRedis.del.mock.calls).toEqual([[`test:code:${hashed('c1')}`]]);
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
        `test:pending:${hashed('pending-1')}`,
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
    it('should delete the hashed row and the old row of the pending authorization', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ id: 'p1' }));
      await store.deletePendingAuthorization('p1');
      expect(mockRedis.del.mock.calls).toEqual([[`test:pending:${hashed('p1')}`], ['test:pending:p1']]);
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
      expect(mockRedis.set).toHaveBeenCalledWith(
        `test:refresh:${hashed('rt-1')}`,
        expect.any(String),
        'EX',
        expect.any(Number),
      );
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
      expect(mockRedis.get).toHaveBeenNthCalledWith(1, `oauth:code:${hashed('test')}`);
    });
  });
});
