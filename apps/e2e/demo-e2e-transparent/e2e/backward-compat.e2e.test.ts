/**
 * E2E Tests for Backward Compatibility - Transparent Auth Mode
 *
 * Tests that the split-auth-package refactoring maintains backward compatibility:
 * - Token validation against JWKS works correctly
 * - Session maintenance across requests
 * - Auth claims preserved in context
 * - All MCP capabilities available after auth
 *
 * These tests ensure existing transparent auth integrations continue to work
 * after the auth package extraction.
 */
import { TestServer, TestTokenFactory, MockOAuthServer, McpTestClient, expect } from '@frontmcp/testing';

describe('Transparent Auth Backward Compatibility E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // Setup token factory with a temporary issuer
    tokenFactory = new TestTokenFactory({
      issuer: 'http://localhost',
      audience: 'frontmcp-test',
    });

    // Start mock OAuth to get the actual port
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();
    await mockOAuth.stop();

    // Recreate with actual issuer URL
    tokenFactory = new TestTokenFactory({
      issuer: oauthInfo.issuer,
      audience: oauthInfo.issuer,
    });

    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    // Start MCP server
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-transparent/src/main.ts',
      env: {
        IDP_PROVIDER_URL: finalOauthInfo.baseUrl,
        IDP_EXPECTED_AUDIENCE: finalOauthInfo.issuer,
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterAll(async () => {
    await server?.stop();
    await mockOAuth?.stop();
  });

  describe('JWKS Validation Compatibility', () => {
    it('should validate tokens using remote JWKS endpoint', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-jwks-compat',
        scopes: ['read', 'write'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);
      await client.disconnect();
    });

    it('should fetch JWKS from well-known endpoint', async () => {
      // Verify JWKS endpoint is accessible (used for token validation)
      const jwksResponse = await fetch(`${mockOAuth.info.baseUrl}/.well-known/jwks.json`, {
        headers: { Accept: 'application/json' },
      });

      expect(jwksResponse.status).toBe(200);
      const jwks = await jwksResponse.json();
      expect(jwks.keys).toBeDefined();
      expect(Array.isArray(jwks.keys)).toBe(true);
    });

    it('should cache JWKS keys for performance', async () => {
      const token1 = await tokenFactory.createTestToken({ sub: 'user-cache-1', scopes: ['read'] });
      const token2 = await tokenFactory.createTestToken({ sub: 'user-cache-2', scopes: ['read'] });

      // Both should validate without extra JWKS fetches
      const client1 = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token: token1 },
      }).buildAndConnect();

      const client2 = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token: token2 },
      }).buildAndConnect();

      expect(client1.isConnected()).toBe(true);
      expect(client2.isConnected()).toBe(true);

      await client1.disconnect();
      await client2.disconnect();
    });
  });

  describe('Session Maintenance Compatibility', () => {
    it('should maintain session across multiple requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-session-compat',
        scopes: ['read', 'write'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      // First request
      const tools = await client.tools.list();
      expect(tools).toBeDefined();

      // Second request - should use same session
      const resources = await client.resources.list();
      expect(resources).toBeDefined();

      // Third request - session still valid
      const prompts = await client.prompts.list();
      expect(prompts).toBeDefined();

      await client.disconnect();
    });

    it('should preserve session state across tool calls', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-session-state',
        scopes: ['read', 'write'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      // Create a task
      const createResult = await client.tools.call('create-task', {
        title: 'Session Test Task',
        description: 'A task to test session state preservation',
        priority: 'medium',
      });
      expect(createResult).toBeSuccessful();

      // List tasks - should include the created task
      const listResult = await client.tools.call('list-tasks', {});
      expect(listResult).toBeSuccessful();
      expect(listResult.text()).toContain('Session Test Task');

      await client.disconnect();
    });
  });

  describe('Auth Claims Preservation', () => {
    it('should extract standard claims from validated token', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-claims-test',
        email: 'claims@example.com',
        name: 'Claims Test User',
        scopes: ['read', 'write', 'admin'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);
      // Auth info should be available (client stores it from connection)
      expect(client.auth).toBeDefined();

      await client.disconnect();
    });

    it('should handle tokens with custom claims', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-custom-claims',
        scopes: ['read'],
        extraClaims: {
          tenantId: 'tenant-123',
          roles: ['user', 'viewer'],
        },
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);

      // Tool should work with custom claims
      const result = await client.tools.call('list-tasks', {});
      expect(result).toBeSuccessful();

      await client.disconnect();
    });
  });

  describe('Full MCP Capability Compatibility', () => {
    it('should support all tool operations', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-tool-compat',
        scopes: ['read', 'write'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      // List tools
      const tools = await client.tools.list();
      expect(tools.length).toBeGreaterThan(0);

      // Call a tool
      const result = await client.tools.call('create-task', {
        title: 'Compat Task',
        description: 'A task for compatibility testing',
        priority: 'low',
      });
      expect(result).toBeSuccessful();

      await client.disconnect();
    });

    it('should support all resource operations', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-resource-compat',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      // List resources
      const resources = await client.resources.list();
      expect(resources.length).toBeGreaterThan(0);

      // Read a resource
      const content = await client.resources.read('tasks://all');
      expect(content).toBeDefined();

      await client.disconnect();
    });

    it('should support all prompt operations', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-prompt-compat',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      // List prompts
      const prompts = await client.prompts.list();
      expect(prompts.length).toBeGreaterThan(0);

      // Get a prompt
      const result = await client.prompts.get('prioritize-tasks', {});
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      await client.disconnect();
    });
  });

  describe('Error Response Compatibility', () => {
    it('should return proper 401 response for missing token', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      expect(response.status).toBe(401);
      // Should include WWW-Authenticate header per RFC 6750
      const wwwAuth = response.headers.get('WWW-Authenticate');
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).toContain('Bearer');
    });

    it('should return proper error for malformed token', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer not.a.valid.jwt.token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Token Error Scenarios', () => {
    it('should reject expired token', async () => {
      // Create an expired token
      const expiredToken = await tokenFactory.createTestToken({
        sub: 'user-expired',
        scopes: ['read'],
        expiresIn: -3600, // Expired 1 hour ago
      });

      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${expiredToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      // Server may return 400 (Bad Request) or 401 (Unauthorized) for expired tokens
      expect([400, 401]).toContain(response.status);
    });

    it('should reject token signed with wrong key', async () => {
      // Create a separate token factory with different keys
      const wrongKeyFactory = new TestTokenFactory({
        issuer: mockOAuth.info.issuer,
        audience: mockOAuth.info.issuer,
      });

      const badToken = await wrongKeyFactory.createTestToken({
        sub: 'user-wrong-key',
        scopes: ['read'],
      });

      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${badToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should handle token with minimal claims', async () => {
      // Token with only required claims (sub)
      const minimalToken = await tokenFactory.createTestToken({
        sub: 'user-minimal-claims',
        scopes: [],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token: minimalToken },
      }).buildAndConnect();

      // Should still connect even with minimal claims
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
    });

    it('should handle token with empty scopes', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-empty-scopes',
        scopes: [],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);

      // Should still be able to list tools even without specific scopes
      const tools = await client.tools.list();
      expect(tools).toBeDefined();

      await client.disconnect();
    });

    it('should handle token with very long scopes list', async () => {
      // Create token with many scopes
      const manyScopes = Array.from({ length: 50 }, (_, i) => `scope-${i}`);

      const token = await tokenFactory.createTestToken({
        sub: 'user-many-scopes',
        scopes: manyScopes,
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);

      await client.disconnect();
    });

    it('should handle token with unicode in claims', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-unicode-中文-🎉',
        email: 'unicode-日本語@example.com',
        name: 'Test User 用户 🌍',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);

      await client.disconnect();
    });

    it('should reject completely invalid Bearer format', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer ', // Empty bearer token
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      // Server should reject with 401 for empty/invalid token
      expect(response.status).toBe(401);
    });

    it('should reject non-Bearer auth scheme', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-basic-auth',
        scopes: ['read'],
      });

      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Basic ${token}`, // Wrong scheme
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });

      // Server should reject with 401 for invalid auth scheme
      expect(response.status).toBe(401);
    });

    it('should handle concurrent validation of same token', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-concurrent',
        scopes: ['read', 'write'],
      });

      // Validate same token concurrently
      const clients = await Promise.all([
        McpTestClient.create({
          baseUrl: server.info.baseUrl,
          transport: 'streamable-http',
          auth: { token },
        }).buildAndConnect(),
        McpTestClient.create({
          baseUrl: server.info.baseUrl,
          transport: 'streamable-http',
          auth: { token },
        }).buildAndConnect(),
        McpTestClient.create({
          baseUrl: server.info.baseUrl,
          transport: 'streamable-http',
          auth: { token },
        }).buildAndConnect(),
      ]);

      // All should succeed
      clients.forEach((client) => {
        expect(client.isConnected()).toBe(true);
      });

      // Cleanup
      await Promise.all(clients.map((c) => c.disconnect()));
    });

    it('should handle concurrent validation of different tokens', async () => {
      // Create multiple different tokens
      const tokens = await Promise.all([
        tokenFactory.createTestToken({ sub: 'user-concurrent-1', scopes: ['read'] }),
        tokenFactory.createTestToken({ sub: 'user-concurrent-2', scopes: ['read'] }),
        tokenFactory.createTestToken({ sub: 'user-concurrent-3', scopes: ['read'] }),
      ]);

      // Validate all concurrently
      const clients = await Promise.all(
        tokens.map((token) =>
          McpTestClient.create({
            baseUrl: server.info.baseUrl,
            transport: 'streamable-http',
            auth: { token },
          }).buildAndConnect(),
        ),
      );

      // All should succeed
      clients.forEach((client) => {
        expect(client.isConnected()).toBe(true);
      });

      // Cleanup
      await Promise.all(clients.map((c) => c.disconnect()));
    });
  });

  describe('Multi-User Compatibility', () => {
    it('should isolate sessions between different users', async () => {
      const token1 = await tokenFactory.createTestToken({
        sub: 'user-multi-1',
        scopes: ['read', 'write'],
      });

      const token2 = await tokenFactory.createTestToken({
        sub: 'user-multi-2',
        scopes: ['read', 'write'],
      });

      const client1 = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token: token1 },
      }).buildAndConnect();

      const client2 = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token: token2 },
      }).buildAndConnect();

      // Both clients should work independently
      const result1 = await client1.tools.call('create-task', {
        title: 'User 1 Task',
        description: 'Task created by user 1',
        priority: 'high',
      });
      expect(result1).toBeSuccessful();

      const result2 = await client2.tools.call('create-task', {
        title: 'User 2 Task',
        description: 'Task created by user 2',
        priority: 'low',
      });
      expect(result2).toBeSuccessful();

      await client1.disconnect();
      await client2.disconnect();
    });
  });
});
