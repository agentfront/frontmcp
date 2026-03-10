/**
 * StorageAuthorizationVault Tests
 *
 * Tests for the StorageAuthorizationVault implementation that uses StorageAdapter
 * for authorization vault storage.
 */

import { MemoryStorageAdapter, createNamespacedStorage } from '@frontmcp/utils';
import { StorageAuthorizationVault } from '../storage-authorization-vault';
import type { AppCredential, VaultConsentRecord, VaultFederatedRecord } from '../../authorization-vault';

describe('StorageAuthorizationVault', () => {
  let adapter: MemoryStorageAdapter;
  let vault: StorageAuthorizationVault;

  const createTestCredential = (appId: string, providerId: string): AppCredential => ({
    appId,
    providerId,
    credential: {
      type: 'oauth',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600000,
      scopes: ['read', 'write'],
    },
    acquiredAt: Date.now(),
    isValid: true,
  });

  const createTestConsent = (): VaultConsentRecord => ({
    enabled: true,
    selectedToolIds: ['app1:tool1', 'app1:tool2'],
    availableToolIds: ['app1:tool1', 'app1:tool2', 'app2:tool1'],
    consentedAt: Date.now(),
    version: '1.0',
  });

  const createTestFederated = (): VaultFederatedRecord => ({
    selectedProviderIds: ['google', 'github'],
    skippedProviderIds: ['microsoft'],
    primaryProviderId: 'google',
    completedAt: Date.now(),
  });

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    vault = new StorageAuthorizationVault(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('constructor', () => {
    it('should create a StorageAuthorizationVault with default options', () => {
      const v = new StorageAuthorizationVault(adapter);
      expect(v).toBeInstanceOf(StorageAuthorizationVault);
    });

    it('should create a StorageAuthorizationVault with custom namespace', () => {
      const v = new StorageAuthorizationVault(adapter, { namespace: 'custom-vault' });
      expect(v).toBeInstanceOf(StorageAuthorizationVault);
    });

    it('should create a StorageAuthorizationVault with custom pending auth TTL', () => {
      const v = new StorageAuthorizationVault(adapter, { pendingAuthTtlMs: 5 * 60 * 1000 });
      expect(v).toBeInstanceOf(StorageAuthorizationVault);
    });

    it('should work with NamespacedStorage', async () => {
      const namespaced = createNamespacedStorage(adapter, 'session:abc123');
      const v = new StorageAuthorizationVault(namespaced);
      expect(v).toBeInstanceOf(StorageAuthorizationVault);
    });
  });

  describe('create', () => {
    it('should create a new vault entry', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.userSub).toBe('user123');
      expect(entry.clientId).toBe('client456');
      expect(entry.createdAt).toBeDefined();
      expect(entry.lastAccessAt).toBeDefined();
      expect(entry.appCredentials).toEqual({});
      expect(entry.pendingAuths).toEqual([]);
      expect(entry.authorizedAppIds).toEqual([]);
      expect(entry.skippedAppIds).toEqual([]);
    });

    it('should create entry with optional fields', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        userEmail: 'user@test.com',
        userName: 'Test User',
        clientId: 'client456',
        consent: createTestConsent(),
        federated: createTestFederated(),
        authorizedAppIds: ['app1'],
        skippedAppIds: ['app2'],
      });

      expect(entry.userEmail).toBe('user@test.com');
      expect(entry.userName).toBe('Test User');
      expect(entry.consent).toBeDefined();
      expect(entry.federated).toBeDefined();
      expect(entry.authorizedAppIds).toEqual(['app1']);
      expect(entry.skippedAppIds).toEqual(['app2']);
    });
  });

  describe('get', () => {
    it('should return null for non-existent entry', async () => {
      const entry = await vault.get('non-existent-id');
      expect(entry).toBeNull();
    });

    it('should return the stored entry', async () => {
      const created = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      const retrieved = await vault.get(created.id);
      expect(retrieved).toEqual(created);
    });
  });

  describe('update', () => {
    it('should update an existing entry', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      await vault.update(entry.id, {
        userEmail: 'updated@test.com',
      });

      const updated = await vault.get(entry.id);
      expect(updated?.userEmail).toBe('updated@test.com');
      expect(updated?.lastAccessAt).toBeGreaterThanOrEqual(entry.lastAccessAt);
    });

    it('should not throw for non-existent entry', async () => {
      await expect(vault.update('non-existent', { userEmail: 'test@test.com' })).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete an existing entry', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      await vault.delete(entry.id);

      const deleted = await vault.get(entry.id);
      expect(deleted).toBeNull();
    });

    it('should not throw for non-existent entry', async () => {
      await expect(vault.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('updateConsent', () => {
    it('should update consent on an entry', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      const consent = createTestConsent();
      await vault.updateConsent(entry.id, consent);

      const updated = await vault.get(entry.id);
      expect(updated?.consent).toEqual(consent);
    });

    it('should not throw for non-existent entry', async () => {
      await expect(vault.updateConsent('non-existent', createTestConsent())).resolves.not.toThrow();
    });
  });

  describe('authorizeApp', () => {
    it('should add app to authorized list', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      await vault.authorizeApp(entry.id, 'app1');

      const updated = await vault.get(entry.id);
      expect(updated?.authorizedAppIds).toContain('app1');
    });

    it('should remove app from skipped list', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
        skippedAppIds: ['app1', 'app2'],
      });

      await vault.authorizeApp(entry.id, 'app1');

      const updated = await vault.get(entry.id);
      expect(updated?.authorizedAppIds).toContain('app1');
      expect(updated?.skippedAppIds).not.toContain('app1');
      expect(updated?.skippedAppIds).toContain('app2');
    });

    it('should not duplicate app in authorized list', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
        authorizedAppIds: ['app1'],
      });

      await vault.authorizeApp(entry.id, 'app1');

      const updated = await vault.get(entry.id);
      expect(updated?.authorizedAppIds.filter((id) => id === 'app1').length).toBe(1);
    });
  });

  describe('isAppAuthorized', () => {
    it('should return true for authorized app', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
        authorizedAppIds: ['app1'],
      });

      const isAuthorized = await vault.isAppAuthorized(entry.id, 'app1');
      expect(isAuthorized).toBe(true);
    });

    it('should return false for non-authorized app', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      const isAuthorized = await vault.isAppAuthorized(entry.id, 'app1');
      expect(isAuthorized).toBe(false);
    });

    it('should return false for non-existent entry', async () => {
      const isAuthorized = await vault.isAppAuthorized('non-existent', 'app1');
      expect(isAuthorized).toBe(false);
    });
  });

  describe('pending auth operations', () => {
    describe('createPendingAuth', () => {
      it('should create a pending auth request', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const pendingAuth = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          toolId: 'tool1',
          authUrl: 'https://auth.example.com/authorize',
          requiredScopes: ['read', 'write'],
        });

        expect(pendingAuth).toBeDefined();
        expect(pendingAuth.id).toBeDefined();
        expect(pendingAuth.appId).toBe('app1');
        expect(pendingAuth.toolId).toBe('tool1');
        expect(pendingAuth.authUrl).toBe('https://auth.example.com/authorize');
        expect(pendingAuth.requiredScopes).toEqual(['read', 'write']);
        expect(pendingAuth.status).toBe('pending');
        expect(pendingAuth.createdAt).toBeDefined();
        expect(pendingAuth.expiresAt).toBeGreaterThan(pendingAuth.createdAt);
      });

      it('should throw for non-existent entry', async () => {
        await expect(
          vault.createPendingAuth('non-existent', {
            appId: 'app1',
            authUrl: 'https://auth.example.com/authorize',
          }),
        ).rejects.toThrow('Vault not found');
      });

      it('should use custom TTL', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const ttlMs = 5 * 60 * 1000; // 5 minutes
        const pendingAuth = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
          ttlMs,
        });

        expect(pendingAuth.expiresAt).toBeCloseTo(pendingAuth.createdAt + ttlMs, -2);
      });
    });

    describe('getPendingAuth', () => {
      it('should get a pending auth request', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const created = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
        });

        const retrieved = await vault.getPendingAuth(entry.id, created.id);
        expect(retrieved).toEqual(created);
      });

      it('should return null for non-existent pending auth', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const retrieved = await vault.getPendingAuth(entry.id, 'non-existent');
        expect(retrieved).toBeNull();
      });

      it('should return null for non-existent entry', async () => {
        const retrieved = await vault.getPendingAuth('non-existent', 'pending-id');
        expect(retrieved).toBeNull();
      });
    });

    describe('completePendingAuth', () => {
      it('should complete a pending auth and authorize the app', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const pendingAuth = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
        });

        await vault.completePendingAuth(entry.id, pendingAuth.id);

        const updatedPending = await vault.getPendingAuth(entry.id, pendingAuth.id);
        expect(updatedPending?.status).toBe('completed');

        const isAuthorized = await vault.isAppAuthorized(entry.id, 'app1');
        expect(isAuthorized).toBe(true);
      });
    });

    describe('cancelPendingAuth', () => {
      it('should cancel a pending auth', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const pendingAuth = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
        });

        await vault.cancelPendingAuth(entry.id, pendingAuth.id);

        const updated = await vault.getPendingAuth(entry.id, pendingAuth.id);
        expect(updated?.status).toBe('cancelled');
      });
    });

    describe('getPendingAuths', () => {
      it('should get all pending auths', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
        });
        await vault.createPendingAuth(entry.id, {
          appId: 'app2',
          authUrl: 'https://auth.example.com/authorize2',
        });

        const pendingAuths = await vault.getPendingAuths(entry.id);
        expect(pendingAuths.length).toBe(2);
      });

      it('should filter out non-pending auths', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const auth1 = await vault.createPendingAuth(entry.id, {
          appId: 'app1',
          authUrl: 'https://auth.example.com/authorize',
        });
        await vault.createPendingAuth(entry.id, {
          appId: 'app2',
          authUrl: 'https://auth.example.com/authorize2',
        });

        await vault.completePendingAuth(entry.id, auth1.id);

        const pendingAuths = await vault.getPendingAuths(entry.id);
        expect(pendingAuths.length).toBe(1);
        expect(pendingAuths[0].appId).toBe('app2');
      });

      it('should return empty array for non-existent entry', async () => {
        const pendingAuths = await vault.getPendingAuths('non-existent');
        expect(pendingAuths).toEqual([]);
      });
    });
  });

  describe('app credential operations', () => {
    describe('addAppCredential', () => {
      it('should add an app credential', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const credential = createTestCredential('app1', 'google');
        await vault.addAppCredential(entry.id, credential);

        const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
        expect(retrieved).toEqual(credential);
      });

      it('should not store credential when consent is enabled and app not consented', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['other-app:tool1'],
            availableToolIds: ['app1:tool1', 'other-app:tool1'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        const credential = createTestCredential('app1', 'google');
        await vault.addAppCredential(entry.id, credential);

        const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
        expect(retrieved).toBeNull();
      });

      it('should store credential when consent is enabled and app is consented', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['app1:tool1'],
            availableToolIds: ['app1:tool1'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        const credential = createTestCredential('app1', 'google');
        await vault.addAppCredential(entry.id, credential);

        const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
        expect(retrieved).toEqual(credential);
      });
    });

    describe('removeAppCredential', () => {
      it('should remove an app credential', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const credential = createTestCredential('app1', 'google');
        await vault.addAppCredential(entry.id, credential);
        await vault.removeAppCredential(entry.id, 'app1', 'google');

        const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
        expect(retrieved).toBeNull();
      });
    });

    describe('getAppCredentials', () => {
      it('should get all credentials for an app', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));
        await vault.addAppCredential(entry.id, createTestCredential('app1', 'github'));
        await vault.addAppCredential(entry.id, createTestCredential('app2', 'google'));

        const credentials = await vault.getAppCredentials(entry.id, 'app1');
        expect(credentials.length).toBe(2);
        expect(credentials.every((c) => c.appId === 'app1')).toBe(true);
      });
    });

    describe('getAllCredentials', () => {
      it('should get all credentials', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));
        await vault.addAppCredential(entry.id, createTestCredential('app2', 'github'));

        const credentials = await vault.getAllCredentials(entry.id);
        expect(credentials.length).toBe(2);
      });

      it('should filter by consent when requested', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['app1:tool1'],
            availableToolIds: ['app1:tool1', 'app2:tool1'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        // Add credentials directly to bypass consent check for testing
        const updated = await vault.get(entry.id);
        if (updated) {
          updated.appCredentials['app1:google'] = createTestCredential('app1', 'google');
          updated.appCredentials['app2:github'] = createTestCredential('app2', 'github');
          await vault.update(entry.id, updated);
        }

        const filtered = await vault.getAllCredentials(entry.id, true);
        expect(filtered.length).toBe(1);
        expect(filtered[0].appId).toBe('app1');

        const unfiltered = await vault.getAllCredentials(entry.id, false);
        expect(unfiltered.length).toBe(2);
      });
    });

    describe('updateCredential', () => {
      it('should update credential metadata', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));

        const now = Date.now();
        await vault.updateCredential(entry.id, 'app1', 'google', {
          lastUsedAt: now,
          isValid: true,
        });

        const updated = await vault.getCredential(entry.id, 'app1', 'google');
        expect(updated?.lastUsedAt).toBe(now);
      });
    });

    describe('invalidateCredential', () => {
      it('should invalidate a credential', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));
        await vault.invalidateCredential(entry.id, 'app1', 'google', 'Token expired');

        const updated = await vault.getCredential(entry.id, 'app1', 'google');
        expect(updated?.isValid).toBe(false);
        expect(updated?.invalidReason).toBe('Token expired');
      });
    });

    describe('refreshOAuthCredential', () => {
      it('should refresh OAuth tokens', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));

        const newExpiresAt = Date.now() + 7200000;
        await vault.refreshOAuthCredential(entry.id, 'app1', 'google', {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt: newExpiresAt,
        });

        const updated = await vault.getCredential(entry.id, 'app1', 'google');
        expect(updated?.credential.type).toBe('oauth');
        if (updated?.credential.type === 'oauth') {
          expect(updated.credential.accessToken).toBe('new-access-token');
          expect(updated.credential.refreshToken).toBe('new-refresh-token');
          expect(updated.credential.expiresAt).toBe(newExpiresAt);
        }
        expect(updated?.isValid).toBe(true);
        expect(updated?.invalidReason).toBeUndefined();
      });
    });

    describe('shouldStoreCredential', () => {
      it('should return true when consent is disabled', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
        });

        const should = await vault.shouldStoreCredential(entry.id, 'app1');
        expect(should).toBe(true);
      });

      it('should return true when app tools are in consent', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['app1:tool1'],
            availableToolIds: ['app1:tool1'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        const should = await vault.shouldStoreCredential(entry.id, 'app1');
        expect(should).toBe(true);
      });

      it('should return false when app tools are not in consent', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['other-app:tool1'],
            availableToolIds: ['app1:tool1', 'other-app:tool1'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        const should = await vault.shouldStoreCredential(entry.id, 'app1');
        expect(should).toBe(false);
      });

      it('should check specific tool IDs when provided', async () => {
        const entry = await vault.create({
          userSub: 'user123',
          clientId: 'client456',
          consent: {
            enabled: true,
            selectedToolIds: ['app1:tool1'],
            availableToolIds: ['app1:tool1', 'app1:tool2'],
            consentedAt: Date.now(),
            version: '1.0',
          },
        });

        const shouldTool1 = await vault.shouldStoreCredential(entry.id, 'app1', ['app1:tool1']);
        expect(shouldTool1).toBe(true);

        const shouldTool2 = await vault.shouldStoreCredential(entry.id, 'app1', ['app1:tool2']);
        expect(shouldTool2).toBe(false);
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up expired pending auths', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      // Create a pending auth with very short TTL
      await vault.createPendingAuth(entry.id, {
        appId: 'app1',
        authUrl: 'https://auth.example.com/authorize',
        ttlMs: 1, // 1ms TTL
      });

      // Wait for it to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      await vault.cleanup();

      const pendingAuths = await vault.getPendingAuths(entry.id);
      expect(pendingAuths.length).toBe(0);
    });
  });

  describe('namespace handling', () => {
    it('should use default namespace prefix', async () => {
      const entry = await vault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('vault:'))).toBe(true);
    });

    it('should use custom namespace prefix', async () => {
      const customVault = new StorageAuthorizationVault(adapter, { namespace: 'custom' });
      await customVault.create({
        userSub: 'user123',
        clientId: 'client456',
      });

      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('custom:'))).toBe(true);
    });

    it('should isolate vaults by namespace', async () => {
      const vault1 = new StorageAuthorizationVault(adapter, { namespace: 'ns1' });
      const vault2 = new StorageAuthorizationVault(adapter, { namespace: 'ns2' });

      const entry1 = await vault1.create({
        userSub: 'user1',
        clientId: 'client1',
      });
      const entry2 = await vault2.create({
        userSub: 'user2',
        clientId: 'client2',
      });

      // Can't find entry1 in vault2
      const retrieved = await vault2.get(entry1.id);
      expect(retrieved).toBeNull();

      // Can find entry2 in vault2
      const retrieved2 = await vault2.get(entry2.id);
      expect(retrieved2?.userSub).toBe('user2');
    });
  });

  describe('InMemoryAuthorizationVault behavior parity', () => {
    it('should behave like InMemoryAuthorizationVault for basic operations', async () => {
      // Create
      const entry = await vault.create({
        userSub: 'user123',
        userEmail: 'user@test.com',
        clientId: 'client456',
      });
      expect(entry.id).toBeDefined();

      // Get
      const retrieved = await vault.get(entry.id);
      expect(retrieved).toEqual(entry);

      // Update
      await vault.update(entry.id, { userName: 'Updated Name' });
      const updated = await vault.get(entry.id);
      expect(updated?.userName).toBe('Updated Name');

      // Delete
      await vault.delete(entry.id);
      const deleted = await vault.get(entry.id);
      expect(deleted).toBeNull();
    });
  });
});
