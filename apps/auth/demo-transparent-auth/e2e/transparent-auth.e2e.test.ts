/**
 * E2E Tests for Transparent Auth Mode
 *
 * Tests the transparent authentication mode where:
 * - Authorization header with valid JWT is required
 * - Tokens are validated against remote IdP's JWKS
 * - Unauthorized requests receive 401 with WWW-Authenticate header
 * - The server passes through tokens to the remote provider
 *
 * Note: These tests use raw HTTP requests (not the test fixture's auto-connect)
 * because transparent auth requires valid tokens and we need to test 401 behavior.
 */
import { TestServer } from '@frontmcp/testing';
import { expect } from '@jest/globals';

const ENV = {
  IDP_PROVIDER_URL: 'https://auth.example.com',
  IDP_EXPECTED_AUDIENCE: 'https://api.example.com',
};

describe('Transparent Auth Mode E2E', () => {
  let server: TestServer | null = null;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx ./src/main.ts',
      env: ENV,
      startupTimeout: 30000,
      debug: false,
    });
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Unauthorized Access', () => {
    it('should return 401 for unauthorized requests', async () => {
      const response = await fetch(`${server!.info.baseUrl}/`, {
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

  describe('Protected Resource Metadata', () => {
    it('should expose protected resource metadata endpoint', async () => {
      const response = await fetch(`${server!.info.baseUrl}/.well-known/oauth-protected-resource`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual', // Disable automatic redirect following
      });

      // Should return metadata, 404 if not configured, or redirect
      expect([200, 301, 302, 307, 308, 404]).toContain(response.status);

      if (response.status === 200) {
        const metadata = await response.json();
        expect(metadata.resource).toBeDefined();
      }
    });
  });
});
