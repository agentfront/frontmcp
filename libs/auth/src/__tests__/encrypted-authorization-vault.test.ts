/**
 * Encrypted Authorization Vault Tests
 *
 * Tests for the zero-knowledge encrypted vault implementation.
 */
import {
  EncryptedRedisVault,
  createEncryptedVault,
  VaultEncryption,
  type VaultKeyDerivationClaims,
  type AppCredential,
  type VaultConsentRecord,
} from '../session';
import { EncryptionContextNotSetError } from '../errors';

/**
 * Mock Redis client for testing
 */
class MockRedis {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Test helper to inspect stored data
  getStoredData(key: string): unknown {
    const data = this.store.get(key);
    return data ? JSON.parse(data) : null;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('EncryptedRedisVault', () => {
  let redis: MockRedis;
  let encryption: VaultEncryption;
  let vault: EncryptedRedisVault;
  let encryptionKey: Uint8Array;

  const claims: VaultKeyDerivationClaims = {
    jti: 'vault-123',
    sub: 'user-456',
    iat: Date.now(),
    vaultKey: 'secret-key',
  };

  beforeEach(async () => {
    redis = new MockRedis();
    encryption = new VaultEncryption({ pepper: 'test-pepper' });
    vault = new EncryptedRedisVault(redis, encryption, 'test:');
    encryptionKey = await encryption.deriveKey(claims);
  });

  afterEach(() => {
    redis.clear();
  });

  // Helper to run tests with encryption context
  const withContext = <T>(fn: () => T | Promise<T>): T | Promise<T> => {
    return vault.runWithContext({ key: encryptionKey, vaultId: claims.jti }, fn);
  };

  describe('Encryption Context', () => {
    it('should throw when encryption context not set', async () => {
      // Running without context should throw
      await expect(
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      ).rejects.toThrow(EncryptionContextNotSetError);
    });

    it('should work with runWithContext', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      expect(entry.id).toBeDefined();
    });
  });

  describe('Data Encryption', () => {
    it('should store encrypted data in Redis', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      // Check what's stored in Redis
      const storedData = redis.getStoredData(`test:${entry.id}`) as Record<string, unknown>;

      // Metadata should be readable
      expect(storedData['id']).toBe(entry.id);
      expect(storedData['userSub']).toBe('user-123');
      expect(storedData['clientId']).toBe('client-456');

      // Sensitive data should be encrypted
      expect(storedData['encrypted']).toBeDefined();
      const encrypted = storedData['encrypted'] as Record<string, unknown>;
      expect(encrypted['v']).toBe(1);
      expect(encrypted['alg']).toBe('aes-256-gcm');
      expect(encrypted['iv']).toBeDefined();
      expect(encrypted['ct']).toBeDefined();
      expect(encrypted['tag']).toBeDefined();
    });

    it('should not store plaintext credentials', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      const credential: AppCredential = {
        appId: 'slack',
        providerId: 'slack-oauth',
        credential: {
          type: 'oauth',
          accessToken: 'super-secret-token-xyz',
          tokenType: 'Bearer',
          scopes: ['chat:write'],
        },
        acquiredAt: Date.now(),
        isValid: true,
      };

      await withContext(() => vault.addAppCredential(entry.id, credential));

      // Check Redis doesn't contain plaintext token
      const rawData = await redis.get(`test:${entry.id}`);
      expect(rawData).not.toContain('super-secret-token-xyz');
    });

    it('should decrypt data correctly when reading', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      const credential: AppCredential = {
        appId: 'slack',
        providerId: 'slack-oauth',
        credential: {
          type: 'oauth',
          accessToken: 'my-access-token',
          refreshToken: 'my-refresh-token',
          tokenType: 'Bearer',
          scopes: ['chat:write'],
        },
        acquiredAt: Date.now(),
        isValid: true,
      };

      await withContext(() => vault.addAppCredential(entry.id, credential));

      // Read back and verify decryption
      const retrieved = await withContext(() => vault.getCredential(entry.id, 'slack', 'slack-oauth'));
      expect(retrieved).not.toBeNull();
      expect(retrieved?.credential.type).toBe('oauth');
      if (retrieved?.credential.type === 'oauth') {
        expect(retrieved.credential.accessToken).toBe('my-access-token');
        expect(retrieved.credential.refreshToken).toBe('my-refresh-token');
      }
    });

    it('should fail decryption with wrong key', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'token',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      // Use wrong key - should fail to decrypt
      const wrongKey = await encryption.deriveKey({
        ...claims,
        jti: 'different-vault',
      });
      await expect(
        vault.runWithContext({ key: wrongKey, vaultId: 'different-vault' }, () => vault.get(entry.id)),
      ).rejects.toThrow('Failed to load vault');
    });
  });

  describe('CRUD Operations', () => {
    it('should create and retrieve vault entry', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          userEmail: 'user@example.com',
          clientId: 'client-456',
        }),
      );

      const retrieved = await withContext(() => vault.get(entry.id));

      expect(retrieved).not.toBeNull();
      expect(retrieved?.userSub).toBe('user-123');
      expect(retrieved?.userEmail).toBe('user@example.com');
    });

    it('should update vault entry', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() => vault.update(entry.id, { userName: 'Updated Name' }));

      const retrieved = await withContext(() => vault.get(entry.id));
      expect(retrieved?.userName).toBe('Updated Name');
    });

    it('should delete vault entry', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() => vault.delete(entry.id));

      const retrieved = await withContext(() => vault.get(entry.id));
      expect(retrieved).toBeNull();
    });
  });

  describe('App Credentials', () => {
    it('should add and retrieve credentials', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'openai',
          providerId: 'openai-api',
          credential: {
            type: 'api_key',
            key: 'sk-secret-api-key',
            headerName: 'Authorization',
            headerPrefix: 'Bearer ',
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      const credential = await withContext(() => vault.getCredential(entry.id, 'openai', 'openai-api'));
      expect(credential).not.toBeNull();
      expect(credential?.credential.type).toBe('api_key');
      if (credential?.credential.type === 'api_key') {
        expect(credential.credential.key).toBe('sk-secret-api-key');
      }
    });

    it('should not store API key in plaintext', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      const secretKey = 'sk-super-secret-api-key-12345';
      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'openai',
          providerId: 'openai-api',
          credential: {
            type: 'api_key',
            key: secretKey,
            headerName: 'Authorization',
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      const rawData = await redis.get(`test:${entry.id}`);
      expect(rawData).not.toContain(secretKey);
    });

    it('should remove credentials', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'token',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      await withContext(() => vault.removeAppCredential(entry.id, 'slack', 'slack-oauth'));

      const credential = await withContext(() => vault.getCredential(entry.id, 'slack', 'slack-oauth'));
      expect(credential).toBeNull();
    });

    it('should get all credentials for an app', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'oauth-token',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-api',
          credential: {
            type: 'api_key',
            key: 'api-key',
            headerName: 'X-API-Key',
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      const credentials = await withContext(() => vault.getAppCredentials(entry.id, 'slack'));
      expect(credentials).toHaveLength(2);
    });
  });

  describe('Consent-based Filtering', () => {
    it('should not store credential when consent blocks app', async () => {
      const consent: VaultConsentRecord = {
        enabled: true,
        selectedToolIds: ['github:create_issue'],
        availableToolIds: ['slack:send_message', 'github:create_issue'],
        consentedAt: Date.now(),
        version: '1.0',
      };

      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          consent,
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'token',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      const credential = await withContext(() => vault.getCredential(entry.id, 'slack', 'slack-oauth'));
      expect(credential).toBeNull();
    });

    it('should store credential when consent allows app', async () => {
      const consent: VaultConsentRecord = {
        enabled: true,
        selectedToolIds: ['slack:send_message'],
        availableToolIds: ['slack:send_message'],
        consentedAt: Date.now(),
        version: '1.0',
      };

      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          consent,
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'token',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      const credential = await withContext(() => vault.getCredential(entry.id, 'slack', 'slack-oauth'));
      expect(credential).not.toBeNull();
    });
  });

  describe('OAuth Refresh', () => {
    it('should refresh OAuth tokens', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'slack',
          providerId: 'slack-oauth',
          credential: {
            type: 'oauth',
            accessToken: 'old-token',
            refreshToken: 'old-refresh',
            tokenType: 'Bearer',
            scopes: [],
          },
          acquiredAt: Date.now(),
          isValid: false,
          invalidReason: 'Expired',
        }),
      );

      await withContext(() =>
        vault.refreshOAuthCredential(entry.id, 'slack', 'slack-oauth', {
          accessToken: 'new-token',
          refreshToken: 'new-refresh',
          expiresAt: Date.now() + 3600000,
        }),
      );

      const credential = await withContext(() => vault.getCredential(entry.id, 'slack', 'slack-oauth'));
      expect(credential?.isValid).toBe(true);
      if (credential?.credential.type === 'oauth') {
        expect(credential.credential.accessToken).toBe('new-token');
        expect(credential.credential.refreshToken).toBe('new-refresh');
      }
    });
  });

  describe('App Authorization', () => {
    it('should check app authorization without decryption', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          authorizedAppIds: ['slack'],
        }),
      );

      // This should work even without encryption context
      // because authorizedAppIds is stored unencrypted
      const isAuthorized = await withContext(() => vault.isAppAuthorized(entry.id, 'slack'));
      expect(isAuthorized).toBe(true);

      const notAuthorized = await withContext(() => vault.isAppAuthorized(entry.id, 'github'));
      expect(notAuthorized).toBe(false);
    });

    it('should authorize app', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          skippedAppIds: ['slack'],
        }),
      );

      await withContext(() => vault.authorizeApp(entry.id, 'slack'));

      expect(await withContext(() => vault.isAppAuthorized(entry.id, 'slack'))).toBe(true);
    });
  });

  describe('Pending Auth', () => {
    it('should create and complete pending auth', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
          skippedAppIds: ['slack'],
        }),
      );

      const pending = await withContext(() =>
        vault.createPendingAuth(entry.id, {
          appId: 'slack',
          toolId: 'slack:send_message',
          authUrl: 'https://example.com/oauth',
        }),
      );

      expect(pending.status).toBe('pending');

      await withContext(() => vault.completePendingAuth(entry.id, pending.id));

      const retrieved = await withContext(() => vault.getPendingAuth(entry.id, pending.id));
      expect(retrieved?.status).toBe('completed');
      expect(await withContext(() => vault.isAppAuthorized(entry.id, 'slack'))).toBe(true);
    });

    it('should store auth URLs encrypted', async () => {
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      const secretAuthUrl = 'https://example.com/oauth?secret=12345';
      await withContext(() =>
        vault.createPendingAuth(entry.id, {
          appId: 'slack',
          authUrl: secretAuthUrl,
        }),
      );

      const rawData = await redis.get(`test:${entry.id}`);
      expect(rawData).not.toContain(secretAuthUrl);
    });
  });

  describe('Factory Function', () => {
    it('should create vault and encryption from factory', () => {
      const { vault: factoryVault, encryption: factoryEncryption } = createEncryptedVault(new MockRedis(), {
        pepper: 'my-pepper',
        namespace: 'custom:',
      });

      expect(factoryVault).toBeInstanceOf(EncryptedRedisVault);
      expect(factoryEncryption).toBeInstanceOf(VaultEncryption);
    });
  });

  describe('Zero Knowledge Properties', () => {
    it('should not allow server to read credentials without client key', async () => {
      // Create vault with user's key
      const entry = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      await withContext(() =>
        vault.addAppCredential(entry.id, {
          appId: 'openai',
          providerId: 'openai-api',
          credential: {
            type: 'api_key',
            key: 'sk-extremely-secret',
            headerName: 'Authorization',
          },
          acquiredAt: Date.now(),
          isValid: true,
        }),
      );

      // Simulate server trying to read without proper key
      const rawData = await redis.get(`test:${entry.id}`);
      const parsed = JSON.parse(rawData!);

      // Server can see metadata
      expect(parsed.userSub).toBe('user-123');

      // But sensitive data is encrypted blob
      expect(parsed.encrypted.v).toBe(1);
      expect(parsed.encrypted.alg).toBe('aes-256-gcm');

      // Cannot extract the actual API key without the encryption key
      expect(rawData).not.toContain('sk-extremely-secret');

      // Trying to decrypt with wrong key fails
      const serverEncryption = new VaultEncryption({ pepper: 'test-pepper' });
      const wrongKey = await serverEncryption.deriveKey({
        jti: 'attacker-attempt',
        sub: 'attacker',
        iat: Date.now(),
      });

      await expect(serverEncryption.decryptObject(parsed.encrypted, wrongKey)).rejects.toThrow();
    });

    it('should produce different encrypted data for same credentials', async () => {
      const entry1 = await withContext(() =>
        vault.create({
          userSub: 'user-123',
          clientId: 'client-456',
        }),
      );

      const entry2 = await withContext(() =>
        vault.create({
          userSub: 'user-789',
          clientId: 'client-456',
        }),
      );

      const credential: AppCredential = {
        appId: 'openai',
        providerId: 'openai-api',
        credential: {
          type: 'api_key',
          key: 'same-key',
          headerName: 'Authorization',
        },
        acquiredAt: Date.now(),
        isValid: true,
      };

      await withContext(() => vault.addAppCredential(entry1.id, credential));
      await withContext(() => vault.addAppCredential(entry2.id, credential));

      const raw1 = await redis.get(`test:${entry1.id}`);
      const raw2 = await redis.get(`test:${entry2.id}`);

      const parsed1 = JSON.parse(raw1!);
      const parsed2 = JSON.parse(raw2!);

      // Even with same credential, encrypted data differs (random IV)
      expect(parsed1.encrypted.ct).not.toBe(parsed2.encrypted.ct);
      expect(parsed1.encrypted.iv).not.toBe(parsed2.encrypted.iv);
    });
  });
});
