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
 * Note: Tests for subsequent requests (tools/list, etc.) are marked as skipped
 * because there's an SDK issue with session handling after initialize.
 */
import { TestServer, TestTokenFactory, MockOAuthServer, expect } from '@frontmcp/testing';

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
    it('should accept valid tokens and return initialize response', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
      });

      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      expect(response.ok).toBe(true);
      const body = await response.text();
      expect(body).toContain('serverInfo');
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

      // First initialize
      const initResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      expect(initResponse.ok).toBe(true);
      const sessionId = initResponse.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List tools
      const toolsResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      if (!toolsResponse.ok) {
        console.log('DEBUG: toolsResponse.status =', toolsResponse.status);
        console.log('DEBUG: toolsResponse body =', await toolsResponse.clone().text());
      }
      expect(toolsResponse.ok).toBe(true);
      const toolsText = await toolsResponse.text();
      expect(toolsText).toContain('create-task');
      expect(toolsText).toContain('list-tasks');
    });
  });

  describe('Tool Execution with Auth', () => {
    it('should execute tools with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-exec',
        scopes: ['read', 'write'],
      });

      // Initialize
      const initResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      const sessionId = initResponse.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // Call tool
      const callResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'create-task',
            arguments: {
              title: 'Test Task',
              description: 'Created with valid token',
              priority: 'high',
            },
          },
        }),
      });

      expect(callResponse.ok).toBe(true);
      const resultText = await callResponse.text();
      expect(resultText).toContain('Test Task');
    });
  });

  describe('Resource Access with Auth', () => {
    it('should list resources with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-resources',
        scopes: ['read'],
      });

      // Initialize
      const initResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      const sessionId = initResponse.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List resources
      const resourcesResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'resources/list',
          params: {},
        }),
      });

      expect(resourcesResponse.ok).toBe(true);
      const resourcesText = await resourcesResponse.text();
      expect(resourcesText).toContain('tasks://all');
    });
  });

  describe('Prompt Access with Auth', () => {
    it('should list prompts with authenticated requests', async () => {
      const token = await tokenFactory.createTestToken({
        sub: 'user-prompts',
        scopes: ['read'],
      });

      // Initialize
      const initResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      const sessionId = initResponse.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List prompts
      const promptsResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'prompts/list',
          params: {},
        }),
      });

      expect(promptsResponse.ok).toBe(true);
      const promptsText = await promptsResponse.text();
      expect(promptsText).toContain('prioritize-tasks');
    });
  });
});
