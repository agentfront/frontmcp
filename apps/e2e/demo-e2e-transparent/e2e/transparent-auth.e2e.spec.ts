/**
 * E2E Tests for Transparent Auth Mode
 *
 * Tests the transparent authentication mode where:
 * - Tokens are validated against remote IdP's JWKS
 * - User claims are extracted from validated tokens
 * - Anonymous access is not allowed (requires valid token)
 *
 * This test uses MockOAuthServer to provide JWKS for token validation
 * without requiring a real IdP.
 *
 * Uses @frontmcp/testing McpTestClient for clean, type-safe MCP interactions.
 */
import { TestServer, TestTokenFactory, MockOAuthServer, McpTestClient, expect } from '@frontmcp/testing';

describe('Transparent Auth Mode E2E', () => {
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;

  beforeAll(async () => {
    // Create initial token factory - issuer will be updated after mock server starts
    tokenFactory = new TestTokenFactory({
      issuer: 'http://localhost',
      audience: 'frontmcp-test',
    });

    // Create and start mock OAuth server to get the actual port
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const oauthInfo = await mockOAuth.start();

    // Stop the initial server - we'll restart with the correct token factory
    await mockOAuth.stop();

    // Create token factory with the actual issuer URL (now that we know the port)
    tokenFactory = new TestTokenFactory({
      issuer: oauthInfo.issuer,
      audience: oauthInfo.issuer,
    });

    // Recreate mock OAuth server with the updated token factory
    // IMPORTANT: Use the same port to ensure issuer consistency!
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: oauthInfo.port });
    const finalOauthInfo = await mockOAuth.start();

    // Start MCP server pointing to mock OAuth
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
    if (server) {
      await server.stop();
    }
    if (mockOAuth) {
      await mockOAuth.stop();
    }
  });

  describe('Unauthorized Access', () => {
    // These tests MUST use raw fetch because they test error responses
    // that McpTestClient can't handle (it expects successful connections)

    it('should return 401 for requests without token', async () => {
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
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    });

    it('should return 401 for invalid token', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer invalid-token',
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

  describe('Token Validation', () => {
    it('should accept valid tokens and connect successfully', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
      });

      // Use McpTestClient for clean connection
      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      expect(client.isConnected()).toBe(true);
      expect(client.serverInfo.name).toBeDefined();

      await client.disconnect();
    });

    it('should reject expired tokens', async () => {
      const expiredToken = await tokenFactory.createExpiredToken({ sub: 'user-expired' });

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

      expect(response.status).toBe(401);
    });

    it('should reject tokens with invalid signature', async () => {
      const invalidToken = tokenFactory.createTokenWithInvalidSignature({ sub: 'user-invalid' });

      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${invalidToken}`,
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

  describe('Protected Resource Metadata', () => {
    // OAuth metadata endpoints are HTTP endpoints, not MCP - use fetch
    it('should expose protected resource metadata endpoint', async () => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-protected-resource`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });

      // Should return metadata, 404 if not configured, or redirect
      expect([200, 301, 302, 307, 308, 404]).toContain(response.status);

      if (response.status === 200) {
        const metadata = await response.json();
        expect(metadata.resource).toBeDefined();
      }
    });
  });

  describe('Authenticated Access', () => {
    it('should allow authenticated users to list tools', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-456',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      const tools = await client.tools.list();

      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('create-task');
      expect(toolNames).toContain('list-tasks');

      await client.disconnect();
    });
  });

  describe('Tool Execution with Auth', () => {
    it('should execute tools with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-exec',
        scopes: ['read', 'write'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      const result = await client.tools.call('create-task', {
        title: 'Test Task',
        description: 'Created with valid token',
        priority: 'high',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('Test Task');

      await client.disconnect();
    });
  });

  describe('Resource Access with Auth', () => {
    it('should list resources with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-resources',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      const resources = await client.resources.list();

      expect(resources).toBeDefined();
      expect(resources.length).toBeGreaterThan(0);

      const resourceUris = resources.map((r) => r.uri);
      expect(resourceUris).toContain('tasks://all');

      await client.disconnect();
    });
  });

  describe('Prompt Access with Auth', () => {
    it('should list prompts with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-prompts',
        scopes: ['read'],
      });

      const client = await McpTestClient.create({
        baseUrl: server.info.baseUrl,
        transport: 'streamable-http',
        auth: { token },
      }).buildAndConnect();

      const prompts = await client.prompts.list();

      expect(prompts).toBeDefined();
      expect(prompts.length).toBeGreaterThan(0);

      const promptNames = prompts.map((p) => p.name);
      expect(promptNames).toContain('prioritize-tasks');

      await client.disconnect();
    });
  });
});
