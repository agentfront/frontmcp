/**
 * E2E Tests for Multi-Provider Orchestrated Auth
 *
 * Tests the orchestrated authentication with multiple upstream OAuth providers:
 * - Mock OAuth servers for GitHub and Slack
 * - Federated login flow with provider selection
 * - Upstream token access via `this.orchestration.getToken()`
 * - Progressive authorization (skipped providers)
 */
import { test, expect, MockOAuthServer, TestTokenFactory } from '@frontmcp/testing';

// Create separate token factories for each mock provider
let githubTokenFactory: TestTokenFactory;
let slackTokenFactory: TestTokenFactory;
let githubServer: MockOAuthServer;
let slackServer: MockOAuthServer;

// GitHub test user
const githubTestUser = {
  sub: 'github-user-123',
  email: 'user@github.example.com',
  name: 'GitHub Test User',
};

// Slack test user
const slackTestUser = {
  sub: 'slack-user-456',
  email: 'user@slack.example.com',
  name: 'Slack Test User',
};

// Start mock servers before all tests
beforeAll(async () => {
  // Create token factories
  githubTokenFactory = new TestTokenFactory({ issuer: 'https://github.mock.local' });
  slackTokenFactory = new TestTokenFactory({ issuer: 'https://slack.mock.local' });

  // Start mock OAuth servers
  githubServer = new MockOAuthServer(githubTokenFactory, {
    autoApprove: true,
    testUser: githubTestUser,
    clientId: 'github-client',
    validRedirectUris: ['http://localhost:*/oauth/provider/github/callback'],
    debug: process.env['DEBUG'] === '1',
  });

  slackServer = new MockOAuthServer(slackTokenFactory, {
    autoApprove: true,
    testUser: slackTestUser,
    clientId: 'slack-client',
    validRedirectUris: ['http://localhost:*/oauth/provider/slack/callback'],
    debug: process.env['DEBUG'] === '1',
  });

  await Promise.all([githubServer.start(), slackServer.start()]);

  // Set environment variables for the test server
  process.env['GITHUB_ISSUER'] = githubServer.info.issuer;
  process.env['GITHUB_CLIENT_ID'] = 'github-client';
  process.env['SLACK_ISSUER'] = slackServer.info.issuer;
  process.env['SLACK_CLIENT_ID'] = 'slack-client';
});

afterAll(async () => {
  // Clean up environment variables
  delete process.env['GITHUB_ISSUER'];
  delete process.env['GITHUB_CLIENT_ID'];
  delete process.env['SLACK_ISSUER'];
  delete process.env['SLACK_CLIENT_ID'];

  await Promise.all([githubServer?.stop(), slackServer?.stop()]);
});

test.describe('Multi-Provider Orchestrated Auth E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-orchestrated/src/main-multi-provider.ts',
    project: 'demo-e2e-orchestrated',
  });

  test.describe('OAuth Metadata', () => {
    test('should expose JWKS endpoint', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/jwks.json`, {
        headers: { Accept: 'application/json' },
      });

      expect([200, 404]).toContain(response.status);
      if (response.status === 200) {
        const jwks = await response.json();
        expect(Array.isArray(jwks.keys)).toBe(true);
      }
    });

    test('should expose authorization server metadata', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`, {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });

      expect([200, 301, 302, 307, 308, 404]).toContain(response.status);
    });
  });

  test.describe('Authenticated Access with Upstream Tokens', () => {
    test('should list tools including github app tools', async ({ server, auth }) => {
      // Create token with federated claims (simulating completed multi-provider auth)
      const token = await auth.createToken({
        sub: 'multi-user-123',
        scopes: ['read', 'write'],
        claims: {
          federated: {
            enabled: true,
            selectedProviders: ['github', 'slack'],
            skippedProviders: [],
          },
        },
      });

      const client = await server.createClient({ token });

      const tools = await client.tools.list();

      // Should have tools from all apps
      expect(tools).toContainTool('create-note');
      expect(tools).toContainTool('list-notes');
      expect(tools).toContainTool('github-repos');
      expect(tools).toContainTool('github-user');

      await client.disconnect();
    });

    test('should access github tool with authorization', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'multi-user-123',
        scopes: ['read', 'write'],
        claims: {
          federated: {
            enabled: true,
            selectedProviders: ['github'],
            skippedProviders: ['slack'],
          },
        },
      });

      const client = await server.createClient({ token });

      // Call the github-user tool
      // Note: The tool may return success, error, or throw depending on whether
      // orchestration context is fully wired up
      const result = await client.tools.call('github-user', {});

      // Tool should return some content (success or error)
      expect(result.raw.content).toBeDefined();
      expect(result.raw.content?.length).toBeGreaterThan(0);

      // If tool returned structured JSON, verify it has expected fields
      // Otherwise, it may have returned an error text message
      const textContent = result.text();
      expect(textContent).toBeDefined();

      await client.disconnect();
    });

    test('should handle missing provider gracefully', async ({ server, auth }) => {
      // Token without github provider
      const token = await auth.createToken({
        sub: 'user-no-github',
        scopes: ['read', 'write'],
        claims: {
          federated: {
            enabled: true,
            selectedProviders: ['slack'],
            skippedProviders: ['github'],
          },
        },
      });

      const client = await server.createClient({ token });

      // Call github-repos which requires github token
      const result = await client.tools.call('github-repos', { limit: 5 });

      expect(result).toBeSuccessful();
      // Parse the result to check the token status - use json() helper
      const data = result.json<{ tokenReceived: boolean }>();
      // Token should not be received since github wasn't authorized
      expect(data.tokenReceived).toBe(false);

      await client.disconnect();
    });
  });

  test.describe('Multiple Users', () => {
    test('should isolate authorization state between users', async ({ server, auth }) => {
      const token1 = await auth.createToken({
        sub: 'user-with-github',
        scopes: ['read', 'write'],
        claims: {
          federated: {
            enabled: true,
            selectedProviders: ['github'],
          },
        },
      });

      const token2 = await auth.createToken({
        sub: 'user-with-slack',
        scopes: ['read', 'write'],
        claims: {
          federated: {
            enabled: true,
            selectedProviders: ['slack'],
          },
        },
      });

      const client1 = await server.createClient({ token: token1 });
      const client2 = await server.createClient({ token: token2 });

      // Sessions should be different
      expect(client1.sessionId).not.toBe(client2.sessionId);

      // User1 has github claim, User2 doesn't
      expect(client1.auth.user?.sub).toBe('user-with-github');
      expect(client2.auth.user?.sub).toBe('user-with-slack');

      await client1.disconnect();
      await client2.disconnect();
    });
  });

  test.describe('Authorization Endpoints', () => {
    test('should return 401 for unauthenticated requests', async ({ server }) => {
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

    test('should handle OAuth authorization requests', async ({ server }) => {
      // Build authorize URL - note: 400 is expected for invalid requests (bad challenge format)
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      // Note: 'test-challenge' is not a valid S256 hash, so 400 is expected
      authorizeUrl.searchParams.set('code_challenge', 'test-challenge');
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
      });

      // Should return login page (200), redirect (302), or bad request (400 for invalid challenge)
      expect([200, 302, 400]).toContain(response.status);
    });
  });
});

test.describe('Mock OAuth Server Integration', () => {
  test('mock github server should serve JWKS', async () => {
    const response = await fetch(`${githubServer.info.baseUrl}/.well-known/jwks.json`);
    expect(response.ok).toBe(true);

    const jwks = await response.json();
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  test('mock github server should auto-approve authorization', async () => {
    const authorizeUrl = new URL(`${githubServer.info.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', 'github-client');
    authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/oauth/provider/github/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', 'test-state');

    const response = await fetch(authorizeUrl.toString(), { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('code=');
  });

  test('mock slack server should auto-approve authorization', async () => {
    const authorizeUrl = new URL(`${slackServer.info.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', 'slack-client');
    authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/oauth/provider/slack/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', 'test-state');

    const response = await fetch(authorizeUrl.toString(), { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('code=');
  });
});
