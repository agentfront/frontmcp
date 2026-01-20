import { InMemoryOrchestratedTokenStore } from '../orchestrated-token.store';
import { randomBytes } from '@frontmcp/utils';

describe('InMemoryOrchestratedTokenStore', () => {
  let store: InMemoryOrchestratedTokenStore;
  const authId = 'auth-123';
  const providerId = 'github';

  beforeEach(() => {
    // Create store without encryption for simpler testing
    store = new InMemoryOrchestratedTokenStore();
  });

  afterEach(() => {
    store.dispose();
  });

  describe('storeTokens and getAccessToken', () => {
    it('should store and retrieve access token', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
        refreshToken: 'ghr_yyyy',
      });

      const token = await store.getAccessToken(authId, providerId);
      expect(token).toBe('gho_xxxx');
    });

    it('should return null for non-existent tokens', async () => {
      const token = await store.getAccessToken('nonexistent', providerId);
      expect(token).toBeNull();
    });
  });

  describe('getRefreshToken', () => {
    it('should store and retrieve refresh token', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
        refreshToken: 'ghr_yyyy',
      });

      const token = await store.getRefreshToken(authId, providerId);
      expect(token).toBe('ghr_yyyy');
    });

    it('should return null when no refresh token', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
      });

      const token = await store.getRefreshToken(authId, providerId);
      expect(token).toBeNull();
    });
  });

  describe('hasTokens', () => {
    it('should return true when tokens exist', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
      });

      const has = await store.hasTokens(authId, providerId);
      expect(has).toBe(true);
    });

    it('should return false when tokens do not exist', async () => {
      const has = await store.hasTokens(authId, providerId);
      expect(has).toBe(false);
    });
  });

  describe('deleteTokens', () => {
    it('should delete tokens', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
      });

      await store.deleteTokens(authId, providerId);

      const has = await store.hasTokens(authId, providerId);
      expect(has).toBe(false);
    });
  });

  describe('multiple providers', () => {
    it('should store tokens for multiple providers independently', async () => {
      await store.storeTokens(authId, 'github', {
        accessToken: 'github_token',
      });
      await store.storeTokens(authId, 'slack', {
        accessToken: 'slack_token',
      });

      const githubToken = await store.getAccessToken(authId, 'github');
      const slackToken = await store.getAccessToken(authId, 'slack');

      expect(githubToken).toBe('github_token');
      expect(slackToken).toBe('slack_token');
    });

    it('should get all provider IDs for an authorization', async () => {
      await store.storeTokens(authId, 'github', { accessToken: 'a' });
      await store.storeTokens(authId, 'slack', { accessToken: 'b' });
      await store.storeTokens(authId, 'jira', { accessToken: 'c' });

      const providerIds = await store.getProviderIds(authId);
      expect(providerIds).toHaveLength(3);
      expect(providerIds).toContain('github');
      expect(providerIds).toContain('slack');
      expect(providerIds).toContain('jira');
    });
  });

  describe('deleteAllForAuthorization', () => {
    it('should delete all tokens for an authorization', async () => {
      await store.storeTokens(authId, 'github', { accessToken: 'a' });
      await store.storeTokens(authId, 'slack', { accessToken: 'b' });

      await store.deleteAllForAuthorization(authId);

      const hasGithub = await store.hasTokens(authId, 'github');
      const hasSlack = await store.hasTokens(authId, 'slack');

      expect(hasGithub).toBe(false);
      expect(hasSlack).toBe(false);
    });
  });

  describe('token expiration', () => {
    it('should return null for expired tokens', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
        expiresAt: Date.now() - 1000, // Already expired
      });

      const token = await store.getAccessToken(authId, providerId);
      expect(token).toBeNull();
    });

    it('should return valid tokens that have not expired', async () => {
      await store.storeTokens(authId, providerId, {
        accessToken: 'gho_xxxx',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      });

      const token = await store.getAccessToken(authId, providerId);
      expect(token).toBe('gho_xxxx');
    });
  });

  describe('with encryption', () => {
    let encryptedStore: InMemoryOrchestratedTokenStore;

    beforeEach(() => {
      const encryptionKey = randomBytes(32);
      encryptedStore = new InMemoryOrchestratedTokenStore({
        encryptionKey,
      });
    });

    afterEach(() => {
      encryptedStore.dispose();
    });

    it('should store and retrieve tokens with encryption', async () => {
      await encryptedStore.storeTokens(authId, providerId, {
        accessToken: 'secret_token',
        refreshToken: 'secret_refresh',
      });

      const accessToken = await encryptedStore.getAccessToken(authId, providerId);
      const refreshToken = await encryptedStore.getRefreshToken(authId, providerId);

      expect(accessToken).toBe('secret_token');
      expect(refreshToken).toBe('secret_refresh');
    });

    it('should handle multiple providers with encryption', async () => {
      await encryptedStore.storeTokens(authId, 'github', { accessToken: 'gh_token' });
      await encryptedStore.storeTokens(authId, 'slack', { accessToken: 'sl_token' });

      const ghToken = await encryptedStore.getAccessToken(authId, 'github');
      const slToken = await encryptedStore.getAccessToken(authId, 'slack');

      expect(ghToken).toBe('gh_token');
      expect(slToken).toBe('sl_token');
    });
  });

  describe('size and clear', () => {
    it('should track store size', async () => {
      expect(store.size).toBe(0);

      await store.storeTokens(authId, 'github', { accessToken: 'a' });
      expect(store.size).toBe(1);

      await store.storeTokens(authId, 'slack', { accessToken: 'b' });
      expect(store.size).toBe(2);
    });

    it('should clear all tokens', async () => {
      await store.storeTokens(authId, 'github', { accessToken: 'a' });
      await store.storeTokens(authId, 'slack', { accessToken: 'b' });

      store.clear();

      expect(store.size).toBe(0);
    });
  });

  describe('migrateTokens', () => {
    it('should migrate tokens from one authorization ID to another', async () => {
      const pendingAuthId = 'pending:abc123';
      const realAuthId = 'real-auth-def456';

      // Store tokens under pending auth ID
      await store.storeTokens(pendingAuthId, 'github', { accessToken: 'github_token' });
      await store.storeTokens(pendingAuthId, 'slack', { accessToken: 'slack_token' });

      // Verify tokens exist under pending ID
      expect(await store.hasTokens(pendingAuthId, 'github')).toBe(true);
      expect(await store.hasTokens(pendingAuthId, 'slack')).toBe(true);

      // Migrate tokens
      await store.migrateTokens(pendingAuthId, realAuthId);

      // Verify tokens are now under real auth ID
      expect(await store.getAccessToken(realAuthId, 'github')).toBe('github_token');
      expect(await store.getAccessToken(realAuthId, 'slack')).toBe('slack_token');

      // Verify tokens are no longer under pending ID
      expect(await store.hasTokens(pendingAuthId, 'github')).toBe(false);
      expect(await store.hasTokens(pendingAuthId, 'slack')).toBe(false);
    });

    it('should handle migration with no tokens to migrate', async () => {
      const fromId = 'nonexistent';
      const toId = 'target';

      // Should not throw
      await expect(store.migrateTokens(fromId, toId)).resolves.not.toThrow();

      // Target should have no tokens
      expect(store.size).toBe(0);
    });

    it('should migrate tokens with encryption enabled', async () => {
      const encryptedStore = new InMemoryOrchestratedTokenStore({
        encryptionKey: randomBytes(32),
      });

      const pendingAuthId = 'pending:xyz789';
      const realAuthId = 'real-auth-uvw012';

      // Store encrypted tokens
      await encryptedStore.storeTokens(pendingAuthId, 'jira', {
        accessToken: 'jira_secret_token',
        refreshToken: 'jira_refresh',
      });

      // Migrate
      await encryptedStore.migrateTokens(pendingAuthId, realAuthId);

      // Verify decrypted tokens are correct under new ID
      expect(await encryptedStore.getAccessToken(realAuthId, 'jira')).toBe('jira_secret_token');
      expect(await encryptedStore.getRefreshToken(realAuthId, 'jira')).toBe('jira_refresh');

      // Original should be gone
      expect(await encryptedStore.hasTokens(pendingAuthId, 'jira')).toBe(false);

      encryptedStore.dispose();
    });
  });
});
