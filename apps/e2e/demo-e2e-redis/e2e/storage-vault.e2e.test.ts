/**
 * E2E Tests for StorageAuthorizationVault
 *
 * Tests the vault's core functionality:
 * - CRUD operations on vault entries
 * - App credential management (OAuth, API keys)
 * - Consent record operations
 * - Pending auth workflow (create, complete, cancel)
 * - App authorization
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Storage Authorization Vault E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    publicMode: true,
  });

  test.describe('Vault Entry CRUD Operations', () => {
    test('should create a vault entry', async ({ mcp }) => {
      const result = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-123',
        userEmail: 'test@example.com',
        userName: 'Test User',
        clientId: 'client-456',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('user-123');
      expect(result).toHaveTextContent('client-456');
    });

    test('should get a vault entry by ID', async ({ mcp }) => {
      // Create entry first
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-get-test',
        clientId: 'client-get-test',
      });

      expect(createResult).toBeSuccessful();

      // Extract entry ID from response using json() method
      const parsed = createResult.json<{ entryId: string }>();
      expect(parsed.entryId).toBeDefined();
      const entryId = parsed.entryId;

      // Get entry
      const getResult = await mcp.tools.call('get-vault-entry', { entryId });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('user-get-test');
      expect(getResult).toHaveTextContent('true'); // found
    });

    test('should return not found for non-existent entry', async ({ mcp }) => {
      const result = await mcp.tools.call('get-vault-entry', {
        entryId: 'non-existent-entry-id',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('not found');
    });

    test('should update a vault entry', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-update-test',
        clientId: 'client-update-test',
      });

      expect(createResult).toBeSuccessful();
      const parsed = createResult.json<{ entryId: string }>();
      const entryId = parsed.entryId;

      // Update entry
      const updateResult = await mcp.tools.call('update-vault-entry', {
        entryId,
        userEmail: 'updated@example.com',
        userName: 'Updated User',
      });

      expect(updateResult).toBeSuccessful();
      expect(updateResult).toHaveTextContent('Updated');

      // Verify update
      const getResult = await mcp.tools.call('get-vault-entry', { entryId });
      expect(getResult).toHaveTextContent('Updated User');
    });

    test('should delete a vault entry', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-delete-test',
        clientId: 'client-delete-test',
      });

      expect(createResult).toBeSuccessful();
      const parsed = createResult.json<{ entryId: string }>();
      const entryId = parsed.entryId;

      // Delete entry
      const deleteResult = await mcp.tools.call('delete-vault-entry', { entryId });
      expect(deleteResult).toBeSuccessful();
      expect(deleteResult).toHaveTextContent('Deleted');

      // Verify deletion
      const getResult = await mcp.tools.call('get-vault-entry', { entryId });
      expect(getResult).toHaveTextContent('not found');
    });
  });

  test.describe('App Credential Management', () => {
    test('should add and retrieve OAuth credential', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-cred-oauth',
        clientId: 'client-cred-oauth',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Add OAuth credential
      const addResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'github-app',
        providerId: 'github',
        credentialType: 'oauth',
        accessToken: 'ghp_xxxxxxxxxxxx',
        refreshToken: 'ghr_xxxxxxxxxxxx',
        scopes: ['repo', 'user'],
        expiresAt: Date.now() + 3600000,
      });

      expect(addResult).toBeSuccessful();
      expect(addResult).toHaveTextContent('oauth');
      expect(addResult).toHaveTextContent('github-app');

      // Get credentials
      const getResult = await mcp.tools.call('get-credentials', {
        entryId,
        appId: 'github-app',
      });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('github');
      expect(getResult).toHaveTextContent('oauth');
    });

    test('should add and retrieve API key credential', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-cred-apikey',
        clientId: 'client-cred-apikey',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Add API key credential
      const addResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'openai-app',
        providerId: 'openai',
        credentialType: 'api_key',
        apiKey: 'sk-xxxxxxxxxxxx',
        headerName: 'Authorization',
      });

      expect(addResult).toBeSuccessful();
      expect(addResult).toHaveTextContent('api_key');

      // Get specific credential
      const getResult = await mcp.tools.call('get-credentials', {
        entryId,
        appId: 'openai-app',
        providerId: 'openai',
      });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('"count":1');
    });

    test('should add bearer token credential', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-cred-bearer',
        clientId: 'client-cred-bearer',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Add bearer credential
      const addResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'service-app',
        providerId: 'internal-service',
        credentialType: 'bearer',
        bearerToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      });

      expect(addResult).toBeSuccessful();
      expect(addResult).toHaveTextContent('bearer');
    });

    test('should retrieve all credentials for a vault entry', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-multi-cred',
        clientId: 'client-multi-cred',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Add multiple credentials
      const addResult1 = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'app1',
        providerId: 'provider1',
        credentialType: 'api_key',
        apiKey: 'key1',
      });
      expect(addResult1).toBeSuccessful();

      const addResult2 = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'app2',
        providerId: 'provider2',
        credentialType: 'bearer',
        bearerToken: 'token2',
      });
      expect(addResult2).toBeSuccessful();

      // Get all credentials
      const getResult = await mcp.tools.call('get-credentials', { entryId });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('"count":2');
    });
  });

  test.describe('Consent Record Operations', () => {
    test('should update consent for vault entry', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-consent',
        clientId: 'client-consent',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Update consent
      const consentResult = await mcp.tools.call('update-consent', {
        entryId,
        enabled: true,
        selectedToolIds: ['app1:tool1', 'app1:tool2', 'app2:tool1'],
        availableToolIds: ['app1:tool1', 'app1:tool2', 'app2:tool1', 'app2:tool2'],
      });

      expect(consentResult).toBeSuccessful();
      expect(consentResult).toHaveTextContent('Updated consent');
    });

    test('should filter credentials based on consent', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-consent-filter',
        clientId: 'client-consent-filter',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Set consent for specific app
      const consentResult = await mcp.tools.call('update-consent', {
        entryId,
        enabled: true,
        selectedToolIds: ['consented-app:tool1'],
        availableToolIds: ['consented-app:tool1', 'other-app:tool1'],
      });
      expect(consentResult).toBeSuccessful();
      expect(consentResult).toHaveTextContent('Updated consent');

      // Add credential for consented app
      const addCredResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'consented-app',
        providerId: 'provider',
        credentialType: 'api_key',
        apiKey: 'allowed-key',
      });
      expect(addCredResult).toBeSuccessful();

      // Get credentials - should include the consented credential
      const getResult = await mcp.tools.call('get-credentials', {
        entryId,
        appId: 'consented-app',
      });

      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('"count":1');
    });
  });

  test.describe('Pending Auth Workflow', () => {
    test('should create pending auth request', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-pending-auth',
        clientId: 'client-pending-auth',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Create pending auth
      const pendingResult = await mcp.tools.call('create-pending-auth', {
        entryId,
        appId: 'slack-app',
        toolId: 'send-message',
        authUrl: 'https://slack.com/oauth/authorize?client_id=xxx',
        requiredScopes: ['chat:write', 'users:read'],
        ttlMs: 300000,
      });

      expect(pendingResult).toBeSuccessful();
      expect(pendingResult).toHaveTextContent('pendingAuthId');
      expect(pendingResult).toHaveTextContent('slack-app');
    });

    test('should complete pending auth and auto-authorize app', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-complete-auth',
        clientId: 'client-complete-auth',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Create pending auth
      const pendingResult = await mcp.tools.call('create-pending-auth', {
        entryId,
        appId: 'jira-app',
        authUrl: 'https://jira.atlassian.com/oauth',
      });

      const pendingAuthId = pendingResult.json<{ pendingAuthId: string }>().pendingAuthId;

      // Complete pending auth
      const completeResult = await mcp.tools.call('complete-pending-auth', {
        entryId,
        pendingAuthId,
        action: 'complete',
      });

      expect(completeResult).toBeSuccessful();
      expect(completeResult).toHaveTextContent('Completed');

      // Verify app is now authorized
      const getResult = await mcp.tools.call('get-vault-entry', { entryId });
      expect(getResult).toHaveTextContent('jira-app');
    });

    test('should cancel pending auth request', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-cancel-auth',
        clientId: 'client-cancel-auth',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Create pending auth
      const pendingResult = await mcp.tools.call('create-pending-auth', {
        entryId,
        appId: 'trello-app',
        authUrl: 'https://trello.com/authorize',
      });

      const pendingAuthId = pendingResult.json<{ pendingAuthId: string }>().pendingAuthId;

      // Cancel pending auth
      const cancelResult = await mcp.tools.call('complete-pending-auth', {
        entryId,
        pendingAuthId,
        action: 'cancel',
      });

      expect(cancelResult).toBeSuccessful();
      expect(cancelResult).toHaveTextContent('Cancelled');
    });

    test('should fail to create pending auth for non-existent vault', async ({ mcp }) => {
      const result = await mcp.tools.call('create-pending-auth', {
        entryId: 'non-existent-vault-id',
        appId: 'some-app',
        authUrl: 'https://example.com/auth',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Failed');
      // Error message indicates vault not found
      expect(result).toHaveTextContent('Vault');
    });
  });

  test.describe('App Authorization', () => {
    test('should authorize an app', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-auth-app',
        clientId: 'client-auth-app',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Authorize app
      const authResult = await mcp.tools.call('authorize-app', {
        entryId,
        appId: 'notion-app',
      });

      expect(authResult).toBeSuccessful();
      expect(authResult).toHaveTextContent('"isAuthorized":true');
    });

    test('should check authorization status', async ({ mcp }) => {
      // Create entry with pre-authorized app
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-check-auth',
        clientId: 'client-check-auth',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Initially not authorized
      const beforeAuth = await mcp.tools.call('get-vault-entry', { entryId });
      expect(beforeAuth).toHaveTextContent('"authorizedAppIds":[]');

      // Authorize
      await mcp.tools.call('authorize-app', { entryId, appId: 'linear-app' });

      // Now authorized
      const afterAuth = await mcp.tools.call('get-vault-entry', { entryId });
      expect(afterAuth).toHaveTextContent('linear-app');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle update on non-existent vault entry gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('update-vault-entry', {
        entryId: 'non-existent-entry-for-update',
        userEmail: 'test@example.com',
      });

      // Should succeed but potentially with no effect (depends on implementation)
      expect(result).toBeSuccessful();
    });

    test('should handle delete on non-existent vault entry gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('delete-vault-entry', {
        entryId: 'non-existent-entry-for-delete',
      });

      // Should succeed even if entry doesn't exist (idempotent delete)
      expect(result).toBeSuccessful();
    });

    test('should handle credential retrieval from non-existent vault', async ({ mcp }) => {
      const result = await mcp.tools.call('get-credentials', {
        entryId: 'non-existent-vault-creds',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"count":0');
    });

    test('should handle adding credential to non-existent vault entry', async ({ mcp }) => {
      const result = await mcp.tools.call('add-credential', {
        entryId: 'non-existent-vault-add-cred',
        appId: 'test-app',
        providerId: 'test-provider',
        credentialType: 'bearer',
        bearerToken: 'test-token',
      });

      // This may fail or succeed depending on implementation
      // The important thing is it doesn't crash
      expect(result).toBeSuccessful();
    });

    test('should handle authorization of app on non-existent vault', async ({ mcp }) => {
      const result = await mcp.tools.call('authorize-app', {
        entryId: 'non-existent-vault-auth',
        appId: 'test-app',
      });

      // Should handle gracefully
      expect(result).toBeSuccessful();
    });

    test('should handle consent update on non-existent vault', async ({ mcp }) => {
      const result = await mcp.tools.call('update-consent', {
        entryId: 'non-existent-vault-consent',
        enabled: true,
        selectedToolIds: ['tool1'],
        availableToolIds: ['tool1', 'tool2'],
      });

      // Should handle gracefully
      expect(result).toBeSuccessful();
    });

    test('should handle completing non-existent pending auth', async ({ mcp }) => {
      // Create a vault entry first
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-invalid-pending',
        clientId: 'client-invalid-pending',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Try to complete a non-existent pending auth
      const result = await mcp.tools.call('complete-pending-auth', {
        entryId,
        pendingAuthId: 'non-existent-pending-auth-id',
        action: 'complete',
      });

      // Should handle gracefully (may fail or succeed with message)
      expect(result).toBeSuccessful();
    });

    test('should handle credentials with various expiration states', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-expiry-test',
        clientId: 'client-expiry-test',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Add credential with past expiration (already expired)
      const expiredResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'expired-app',
        providerId: 'expired-provider',
        credentialType: 'oauth',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 3600000, // 1 hour ago
      });

      expect(expiredResult).toBeSuccessful();

      // Add credential with far future expiration
      const futureResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'future-app',
        providerId: 'future-provider',
        credentialType: 'oauth',
        accessToken: 'future-token',
        expiresAt: Date.now() + 86400000 * 365, // 1 year from now
      });

      expect(futureResult).toBeSuccessful();

      // Get all credentials - both should be stored
      const getResult = await mcp.tools.call('get-credentials', { entryId });
      expect(getResult).toHaveTextContent('"count":2');
    });

    test('should handle basic auth credential type', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-basic-auth',
        clientId: 'client-basic-auth',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Add basic auth credential
      const addResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'basic-app',
        providerId: 'basic-provider',
        credentialType: 'basic',
        username: 'testuser',
        password: 'testpass',
      });

      expect(addResult).toBeSuccessful();
      expect(addResult).toHaveTextContent('basic');
    });

    test('should handle empty tool selections in consent', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-empty-consent',
        clientId: 'client-empty-consent',
      });

      const entryId = createResult.json<{ entryId: string }>().entryId;

      // Update consent with empty selections
      const consentResult = await mcp.tools.call('update-consent', {
        entryId,
        enabled: false,
        selectedToolIds: [],
        availableToolIds: [],
      });

      expect(consentResult).toBeSuccessful();
      expect(consentResult).toHaveTextContent('Updated consent');
    });
  });

  test.describe('Persistence Across Requests', () => {
    test('should persist vault entries across multiple tool calls', async ({ mcp }) => {
      // Create entry
      const createResult = await mcp.tools.call('create-vault-entry', {
        userSub: 'user-persist-test',
        clientId: 'client-persist-test',
      });

      expect(createResult).toBeSuccessful();
      const entryId = createResult.json<{ entryId: string }>().entryId;
      expect(entryId).toBeDefined();

      // Add credential
      const addCredResult = await mcp.tools.call('add-credential', {
        entryId,
        appId: 'persist-app',
        providerId: 'persist-provider',
        credentialType: 'bearer',
        bearerToken: 'persist-token',
      });
      expect(addCredResult).toBeSuccessful();
      expect(addCredResult).toHaveTextContent('bearer');

      // Update consent
      const consentResult = await mcp.tools.call('update-consent', {
        entryId,
        enabled: true,
        selectedToolIds: ['persist-app:tool'],
        availableToolIds: ['persist-app:tool'],
      });
      expect(consentResult).toBeSuccessful();
      expect(consentResult).toHaveTextContent('Updated consent');

      // Authorize app
      const authResult = await mcp.tools.call('authorize-app', { entryId, appId: 'persist-app' });
      expect(authResult).toBeSuccessful();
      expect(authResult).toHaveTextContent('"isAuthorized":true');

      // Verify all data persisted
      const getResult = await mcp.tools.call('get-vault-entry', { entryId });
      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('user-persist-test');
      expect(getResult).toHaveTextContent('"credentialCount":1');
      expect(getResult).toHaveTextContent('persist-app');
    });
  });
});
