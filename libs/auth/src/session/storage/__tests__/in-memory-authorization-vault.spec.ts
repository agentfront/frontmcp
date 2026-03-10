/**
 * InMemoryAuthorizationVault Tests
 *
 * Tests for the InMemoryAuthorizationVault which wraps StorageAuthorizationVault
 * with a MemoryStorageAdapter. Validates construction options, delegation to
 * the underlying StorageAuthorizationVault, and the clear() method.
 */

import { InMemoryAuthorizationVault } from '../in-memory-authorization-vault';
import type { AppCredential, VaultConsentRecord, VaultFederatedRecord } from '../../authorization-vault';

describe('InMemoryAuthorizationVault', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function createTestCredential(appId: string, providerId: string): AppCredential {
    return {
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
    };
  }

  function createTestConsent(): VaultConsentRecord {
    return {
      enabled: true,
      selectedToolIds: ['app1:tool1', 'app1:tool2'],
      availableToolIds: ['app1:tool1', 'app1:tool2', 'app2:tool1'],
      consentedAt: Date.now(),
      version: '1.0',
    };
  }

  function createTestFederated(): VaultFederatedRecord {
    return {
      selectedProviderIds: ['google', 'github'],
      skippedProviderIds: ['microsoft'],
      primaryProviderId: 'google',
      completedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('should create with default options', () => {
      const vault = new InMemoryAuthorizationVault();
      expect(vault).toBeInstanceOf(InMemoryAuthorizationVault);
    });

    it('should create with custom namespace', () => {
      const vault = new InMemoryAuthorizationVault({ namespace: 'custom-ns' });
      expect(vault).toBeInstanceOf(InMemoryAuthorizationVault);
    });

    it('should create with custom pending auth TTL', () => {
      const vault = new InMemoryAuthorizationVault({ pendingAuthTtlMs: 5 * 60 * 1000 });
      expect(vault).toBeInstanceOf(InMemoryAuthorizationVault);
    });

    it('should create with all options', () => {
      const vault = new InMemoryAuthorizationVault({
        namespace: 'my-vault',
        pendingAuthTtlMs: 300000,
      });
      expect(vault).toBeInstanceOf(InMemoryAuthorizationVault);
    });
  });

  // ---------------------------------------------------------------------------
  // Core CRUD (delegated to StorageAuthorizationVault)
  // ---------------------------------------------------------------------------
  describe('create and get', () => {
    it('should create and retrieve a vault entry', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.userSub).toBe('user-123');
      expect(entry.clientId).toBe('client-abc');

      const retrieved = await vault.get(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it('should create entry with all optional fields', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        userEmail: 'user@example.com',
        userName: 'Test User',
        clientId: 'client-abc',
        consent: createTestConsent(),
        federated: createTestFederated(),
        authorizedAppIds: ['app1'],
        skippedAppIds: ['app2'],
      });

      expect(entry.userEmail).toBe('user@example.com');
      expect(entry.userName).toBe('Test User');
      expect(entry.consent).toBeDefined();
      expect(entry.federated).toBeDefined();
      expect(entry.authorizedAppIds).toEqual(['app1']);
      expect(entry.skippedAppIds).toEqual(['app2']);
    });

    it('should return null for non-existent entry', async () => {
      const vault = new InMemoryAuthorizationVault();
      const result = await vault.get('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update an existing entry', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      await vault.update(entry.id, { userEmail: 'updated@example.com' });

      const updated = await vault.get(entry.id);
      expect(updated?.userEmail).toBe('updated@example.com');
    });
  });

  describe('delete', () => {
    it('should delete an existing entry', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      await vault.delete(entry.id);

      const deleted = await vault.get(entry.id);
      expect(deleted).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------
  describe('clear()', () => {
    it('should remove all stored data', async () => {
      const vault = new InMemoryAuthorizationVault();

      // Create multiple entries
      const entry1 = await vault.create({
        userSub: 'user-1',
        clientId: 'client-1',
      });
      const entry2 = await vault.create({
        userSub: 'user-2',
        clientId: 'client-2',
      });

      // Verify they exist
      expect(await vault.get(entry1.id)).not.toBeNull();
      expect(await vault.get(entry2.id)).not.toBeNull();

      // Clear
      await vault.clear();

      // Both should be gone
      expect(await vault.get(entry1.id)).toBeNull();
      expect(await vault.get(entry2.id)).toBeNull();
    });

    it('should not throw when clearing an empty vault', async () => {
      const vault = new InMemoryAuthorizationVault();
      await expect(vault.clear()).resolves.not.toThrow();
    });

    it('should allow creating new entries after clear', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry1 = await vault.create({
        userSub: 'user-1',
        clientId: 'client-1',
      });

      await vault.clear();
      expect(await vault.get(entry1.id)).toBeNull();

      // Create a new entry after clear
      const entry2 = await vault.create({
        userSub: 'user-2',
        clientId: 'client-2',
      });

      expect(await vault.get(entry2.id)).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Namespace isolation
  // ---------------------------------------------------------------------------
  describe('namespace isolation', () => {
    it('should use custom namespace for key prefix', async () => {
      const vault1 = new InMemoryAuthorizationVault({ namespace: 'ns-a' });
      const vault2 = new InMemoryAuthorizationVault({ namespace: 'ns-b' });

      const entry1 = await vault1.create({
        userSub: 'user-1',
        clientId: 'client-1',
      });

      // vault2 with different namespace should not find entry1
      const retrieved = await vault2.get(entry1.id);
      expect(retrieved).toBeNull();

      // vault1 should find it
      const fromVault1 = await vault1.get(entry1.id);
      expect(fromVault1?.userSub).toBe('user-1');
    });
  });

  // ---------------------------------------------------------------------------
  // App credential operations (delegated)
  // ---------------------------------------------------------------------------
  describe('app credential operations', () => {
    it('should add and retrieve app credentials', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const credential = createTestCredential('app1', 'google');
      await vault.addAppCredential(entry.id, credential);

      const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
      expect(retrieved).toEqual(credential);
    });

    it('should remove app credentials', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const credential = createTestCredential('app1', 'google');
      await vault.addAppCredential(entry.id, credential);
      await vault.removeAppCredential(entry.id, 'app1', 'google');

      const retrieved = await vault.getCredential(entry.id, 'app1', 'google');
      expect(retrieved).toBeNull();
    });

    it('should get all credentials for an app', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));
      await vault.addAppCredential(entry.id, createTestCredential('app1', 'github'));
      await vault.addAppCredential(entry.id, createTestCredential('app2', 'google'));

      const app1Creds = await vault.getAppCredentials(entry.id, 'app1');
      expect(app1Creds.length).toBe(2);
      expect(app1Creds.every((c) => c.appId === 'app1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Pending auth operations (delegated)
  // ---------------------------------------------------------------------------
  describe('pending auth operations', () => {
    it('should create and retrieve pending auth', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const pending = await vault.createPendingAuth(entry.id, {
        appId: 'app1',
        authUrl: 'https://auth.example.com/authorize',
        requiredScopes: ['read'],
      });

      expect(pending.id).toBeDefined();
      expect(pending.appId).toBe('app1');
      expect(pending.status).toBe('pending');

      const retrieved = await vault.getPendingAuth(entry.id, pending.id);
      expect(retrieved).toEqual(pending);
    });

    it('should complete pending auth and authorize app', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const pending = await vault.createPendingAuth(entry.id, {
        appId: 'app1',
        authUrl: 'https://auth.example.com/authorize',
      });

      await vault.completePendingAuth(entry.id, pending.id);

      const updatedPending = await vault.getPendingAuth(entry.id, pending.id);
      expect(updatedPending?.status).toBe('completed');

      const isAuthorized = await vault.isAppAuthorized(entry.id, 'app1');
      expect(isAuthorized).toBe(true);
    });

    it('should cancel pending auth', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const pending = await vault.createPendingAuth(entry.id, {
        appId: 'app1',
        authUrl: 'https://auth.example.com/authorize',
      });

      await vault.cancelPendingAuth(entry.id, pending.id);

      const updated = await vault.getPendingAuth(entry.id, pending.id);
      expect(updated?.status).toBe('cancelled');
    });
  });

  // ---------------------------------------------------------------------------
  // authorizeApp and isAppAuthorized
  // ---------------------------------------------------------------------------
  describe('authorizeApp / isAppAuthorized', () => {
    it('should authorize an app and check authorization', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      expect(await vault.isAppAuthorized(entry.id, 'app1')).toBe(false);

      await vault.authorizeApp(entry.id, 'app1');

      expect(await vault.isAppAuthorized(entry.id, 'app1')).toBe(true);
    });

    it('should move app from skipped to authorized', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
        skippedAppIds: ['app1', 'app2'],
      });

      await vault.authorizeApp(entry.id, 'app1');

      const updated = await vault.get(entry.id);
      expect(updated?.authorizedAppIds).toContain('app1');
      expect(updated?.skippedAppIds).not.toContain('app1');
      expect(updated?.skippedAppIds).toContain('app2');
    });
  });

  // ---------------------------------------------------------------------------
  // Consent operations
  // ---------------------------------------------------------------------------
  describe('updateConsent', () => {
    it('should update consent on an entry', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      const consent = createTestConsent();
      await vault.updateConsent(entry.id, consent);

      const updated = await vault.get(entry.id);
      expect(updated?.consent).toEqual(consent);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------
  describe('cleanup', () => {
    it('should clean up expired pending auths', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      // Create a pending auth with 1ms TTL
      await vault.createPendingAuth(entry.id, {
        appId: 'app1',
        authUrl: 'https://auth.example.com/authorize',
        ttlMs: 1,
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      await vault.cleanup();

      const pendingAuths = await vault.getPendingAuths(entry.id);
      expect(pendingAuths.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // refreshOAuthCredential
  // ---------------------------------------------------------------------------
  describe('refreshOAuthCredential', () => {
    it('should refresh OAuth tokens', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
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
    });
  });

  // ---------------------------------------------------------------------------
  // invalidateCredential
  // ---------------------------------------------------------------------------
  describe('invalidateCredential', () => {
    it('should mark credential as invalid', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      await vault.addAppCredential(entry.id, createTestCredential('app1', 'google'));
      await vault.invalidateCredential(entry.id, 'app1', 'google', 'Token revoked');

      const updated = await vault.getCredential(entry.id, 'app1', 'google');
      expect(updated?.isValid).toBe(false);
      expect(updated?.invalidReason).toBe('Token revoked');
    });
  });

  // ---------------------------------------------------------------------------
  // shouldStoreCredential
  // ---------------------------------------------------------------------------
  describe('shouldStoreCredential', () => {
    it('should return true when consent is disabled', async () => {
      const vault = new InMemoryAuthorizationVault();

      const entry = await vault.create({
        userSub: 'user-123',
        clientId: 'client-abc',
      });

      expect(await vault.shouldStoreCredential(entry.id, 'app1')).toBe(true);
    });

    it('should return false for non-existent vault', async () => {
      const vault = new InMemoryAuthorizationVault();
      expect(await vault.shouldStoreCredential('non-existent', 'app1')).toBe(false);
    });
  });
});
