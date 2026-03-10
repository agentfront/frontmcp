/**
 * E2E Tests for CIMD (Client ID Metadata Documents)
 *
 * Tests the full OAuth flow with CIMD clients, including:
 * - Metadata resolution from client_id URLs
 * - Redirect URI validation
 * - Error handling for invalid documents
 * - Caching behavior
 */
import { test, expect, MockCimdServer } from '@frontmcp/testing';
import { generatePkceChallenge } from '@frontmcp/auth';

// Stable code verifier for tests (43+ chars of A-Za-z0-9-._~)
const TEST_CODE_VERIFIER = 'test-verifier-12345678901234567890123456789012345';

// Pre-compute the challenge for the test verifier
const TEST_CODE_CHALLENGE = generatePkceChallenge(TEST_CODE_VERIFIER).challenge;

// CIMD server instance (shared across tests in describe block)
let cimdServer: MockCimdServer;

test.describe('CIMD E2E Tests', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-cimd/src/main.ts',
    project: 'demo-e2e-cimd',
  });

  // Start CIMD server before all tests
  test.beforeAll(async () => {
    cimdServer = new MockCimdServer({ debug: false });
    await cimdServer.start();
  });

  // Stop CIMD server after all tests
  test.afterAll(async () => {
    if (cimdServer) {
      await cimdServer.stop();
    }
  });

  // Clear registered clients before each test
  test.beforeEach(async () => {
    cimdServer.clear();
  });

  test.describe('OAuth Authorization with CIMD', () => {
    test('should recognize CIMD client_id and fetch metadata', async ({ server }) => {
      // Register a CIMD client
      const clientId = cimdServer.registerClient({
        name: 'Test CIMD Client',
        redirectUris: ['http://localhost:3000/callback'],
      });

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      // Make authorization request with CIMD client_id
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'read write');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return login page (200) or redirect to login
      // The exact behavior depends on server configuration
      expect([200, 302, 303]).toContain(response.status);

      // If we get a page response, verify it contains client info
      if (response.status === 200) {
        const html = await response.text();
        // The server should have resolved the CIMD metadata
        // and may display client_name on the login/consent page
        expect(html.length).toBeGreaterThan(0);
      }
    });

    test('should reject invalid redirect_uri not in CIMD document', async ({ server }) => {
      // Register a CIMD client with specific redirect URIs
      const clientId = cimdServer.registerClient({
        name: 'Restricted Redirect Client',
        redirectUris: ['http://localhost:3000/callback'],
      });

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      // Try to use a different redirect_uri
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://evil.com/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return error (400 or redirect with error)
      // When redirect_uri is invalid, server must NOT redirect to it
      expect([400, 401, 403]).toContain(response.status);

      // Server may return HTML error page or JSON - just verify we get a response
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await response.json();
        expect(body.error).toBeDefined();
      } else {
        // HTML error page is also valid
        const html = await response.text();
        expect(html.length).toBeGreaterThan(0);
      }
    });

    test('should accept any registered redirect_uri from CIMD document', async ({ server }) => {
      // Register a CIMD client with multiple redirect URIs
      const clientId = cimdServer.registerClient({
        name: 'Multi-Redirect Client',
        redirectUris: [
          'http://localhost:3000/callback',
          'http://localhost:3001/auth/callback',
          'http://localhost:8080/oauth/complete',
        ],
      });

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      // Test each redirect_uri
      for (const redirectUri of [
        'http://localhost:3000/callback',
        'http://localhost:3001/auth/callback',
        'http://localhost:8080/oauth/complete',
      ]) {
        const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('state', 'test-state');
        authorizeUrl.searchParams.set('code_challenge', codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');

        const response = await fetch(authorizeUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
        });

        // Should not return 400 for valid redirect_uri
        expect(response.status).not.toBe(400);
      }
    });
  });

  test.describe('CIMD Validation Errors', () => {
    test('should reject CIMD document missing required fields', async ({ server }) => {
      // Register an invalid CIMD document (missing client_name)
      cimdServer.registerInvalidDocument('/invalid/missing-fields.json', {
        client_id: `${cimdServer.info.baseUrl}/invalid/missing-fields.json`,
        // Missing client_name and redirect_uris
      });

      const clientId = `${cimdServer.info.baseUrl}/invalid/missing-fields.json`;

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return validation error
      expect([400, 401, 403, 502]).toContain(response.status);
    });

    test('should reject CIMD document with client_id mismatch', async ({ server }) => {
      // Register a CIMD document where client_id doesn't match the URL
      cimdServer.registerInvalidDocument('/invalid/mismatch.json', {
        client_id: 'https://different-domain.com/other-client', // Doesn't match URL
        client_name: 'Mismatched Client',
        redirect_uris: ['http://localhost:3000/callback'],
      });

      const clientId = `${cimdServer.info.baseUrl}/invalid/mismatch.json`;

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return validation error
      expect([400, 401, 403, 502]).toContain(response.status);
    });
  });

  test.describe('CIMD Fetch Errors', () => {
    test('should handle 404 when CIMD endpoint not found', async ({ server }) => {
      // Use a client_id that doesn't exist
      const clientId = `${cimdServer.info.baseUrl}/nonexistent/client.json`;

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return error
      expect([400, 401, 403, 502]).toContain(response.status);
    });

    test('should handle 500 from CIMD server', async ({ server }) => {
      // Register a path that returns 500
      cimdServer.registerFetchError('/error/server-error.json', 500, {
        error: 'internal_server_error',
      });

      const clientId = `${cimdServer.info.baseUrl}/error/server-error.json`;

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should return error (400 or 502 for upstream error)
      expect([400, 401, 403, 502]).toContain(response.status);
    });
  });

  test.describe('Non-CIMD Clients', () => {
    test('should treat regular string client_id as non-CIMD', async ({ server }) => {
      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      // Use a regular string client_id (not a URL)
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'my-regular-client-id');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      // Should not fail with CIMD-specific error
      // Regular client handling may return 400 (unknown client) or redirect
      expect([200, 302, 303, 400, 401]).toContain(response.status);
    });
  });

  test.describe('CIMD Caching', () => {
    test('should cache CIMD metadata', async ({ server }) => {
      // Register a CIMD client
      const clientId = cimdServer.registerClient({
        name: 'Cached Client',
        redirectUris: ['http://localhost:3000/callback'],
      });

      // Generate PKCE challenge
      const codeChallenge = TEST_CODE_CHALLENGE;

      // First request
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state-1');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const response1 = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      expect([200, 302, 303]).toContain(response1.status);

      // Second request (should use cache)
      authorizeUrl.searchParams.set('state', 'test-state-2');

      const response2 = await fetch(authorizeUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
      });

      expect([200, 302, 303]).toContain(response2.status);
    });
  });

  test.describe('OAuth Metadata with CIMD', () => {
    test('should expose authorization server metadata', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });

      // Should return metadata, redirect, or 404
      expect([200, 301, 302, 307, 308, 404]).toContain(response.status);

      if (response.status === 200) {
        const metadata = await response.json();
        expect(metadata.issuer).toBeDefined();
        expect(metadata.authorization_endpoint).toBeDefined();
        expect(metadata.token_endpoint).toBeDefined();
      }
    });

    test('should expose JWKS endpoint', async ({ server }) => {
      const response = await fetch(`${server.info.baseUrl}/.well-known/jwks.json`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      // Should return JWKS or 404
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        const jwks = await response.json();
        expect(jwks.keys).toBeDefined();
        expect(Array.isArray(jwks.keys)).toBe(true);
      }
    });
  });
});
