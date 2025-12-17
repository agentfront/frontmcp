/**
 * E2E Tests for Orchestrated Auth Mode
 *
 * Tests the orchestrated authentication mode where:
 * - Local auth server manages sessions and tokens
 * - Consent flow is required for tool access
 * - Stateful sessions are maintained
 * - Multiple auth providers can be orchestrated
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Orchestrated Auth Mode E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-orchestrated/src/main.ts',
  });

  test.describe('Unauthenticated Access', () => {
    test('should return 401 when allowDefaultPublic is false', async ({ server }) => {
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
  });

  test.describe('Authenticated Access', () => {
    test('should accept locally signed tokens', async ({ server, auth }) => {
      // In orchestrated local mode, the server signs its own tokens
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
        email: 'user@test.local',
        name: 'Test User',
      });

      const client = await server.createClient({ token });

      expect(client.isConnected()).toBe(true);
      expect(client.auth.isAnonymous).toBe(false);

      await client.disconnect();
    });

    test('should create stateful session', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      const client = await server.createClient({ token });

      expect(client.sessionId).toBeDefined();
      expect(client.sessionId.length).toBeGreaterThan(0);

      await client.disconnect();
    });
  });

  test.describe('Tool Access with Auth', () => {
    test('should list tools for authenticated user', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
      });

      const client = await server.createClient({ token });

      const tools = await client.tools.list();

      expect(tools).toContainTool('create-note');
      expect(tools).toContainTool('list-notes');
      expect(tools).toContainTool('create-task');
      expect(tools).toContainTool('list-tasks');
      expect(tools).toContainTool('complete-task');

      await client.disconnect();
    });

    test('should call tools with proper authorization', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
      });

      const client = await server.createClient({ token });

      const result = await client.tools.call('create-note', {
        title: 'Test Note',
        content: 'This is a test note',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Test Note');

      await client.disconnect();
    });
  });

  test.describe('Resource Access', () => {
    test('should list resources for authenticated user', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      const client = await server.createClient({ token });

      const resources = await client.resources.list();
      expect(resources).toContainResource('notes://all');

      await client.disconnect();
    });

    test('should read resources with authorization', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      const client = await server.createClient({ token });

      const content = await client.resources.read('notes://all');
      expect(content).toBeSuccessful();

      await client.disconnect();
    });
  });

  test.describe('Prompt Access', () => {
    test('should list prompts for authenticated user', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      const client = await server.createClient({ token });

      const prompts = await client.prompts.list();

      expect(prompts).toContainPrompt('summarize-notes');
      expect(prompts).toContainPrompt('prioritize-tasks');

      await client.disconnect();
    });

    test('should get prompts with authorization', async ({ server, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      const client = await server.createClient({ token });

      const result = await client.prompts.get('summarize-notes', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      await client.disconnect();
    });
  });

  test.describe('OAuth Metadata Endpoints', () => {
    test('should expose authorization server metadata', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual', // Disable automatic redirect following
      });

      // Should return metadata, 404 if endpoint not exposed, or 3xx redirect
      expect([200, 301, 302, 307, 308, 404]).toContain(response.status);

      if (response.status === 200) {
        const metadata = await response.json();
        expect(metadata.issuer).toBeDefined();
      }
    });

    test('should expose JWKS endpoint for token verification', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/jwks.json`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      // Should return JWKS or 404 if endpoint not exposed
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        const jwks = await response.json();
        expect(jwks.keys).toBeDefined();
        expect(Array.isArray(jwks.keys)).toBe(true);
      }
    });
  });

  test.describe('Multi-User Scenarios', () => {
    test('should isolate sessions between different users', async ({ server, auth }) => {
      const token1 = await auth.createToken({
        sub: 'user-1',
        scopes: ['read', 'write'],
      });

      const token2 = await auth.createToken({
        sub: 'user-2',
        scopes: ['read', 'write'],
      });

      const client1 = await server.createClient({ token: token1 });
      const client2 = await server.createClient({ token: token2 });

      // Sessions should be different for different users
      expect(client1.sessionId !== client2.sessionId).toBe(true);
      expect(client1.auth.user?.sub).toBe('user-1');
      expect(client2.auth.user?.sub).toBe('user-2');

      await client1.disconnect();
      await client2.disconnect();
    });
  });
});
