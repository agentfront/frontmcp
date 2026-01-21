import { MockOAuthServer } from '../mock-oauth-server';
import { TestTokenFactory } from '../token-factory';

describe('MockOAuthServer', () => {
  let tokenFactory: TestTokenFactory;

  beforeAll(() => {
    tokenFactory = new TestTokenFactory();
  });

  describe('basic functionality', () => {
    let server: MockOAuthServer;

    afterEach(async () => {
      if (server) {
        await server.stop();
      }
    });

    it('should throw when accessing info before start', () => {
      const uninitializedServer = new MockOAuthServer(tokenFactory);
      expect(() => uninitializedServer.info).toThrow('Mock OAuth server is not running');
    });

    it('should start and stop cleanly', async () => {
      server = new MockOAuthServer(tokenFactory);
      const info = await server.start();

      expect(info.port).toBeGreaterThan(0);
      expect(info.baseUrl).toBe(`http://localhost:${info.port}`);
      expect(info.jwksUrl).toBe(`http://localhost:${info.port}/.well-known/jwks.json`);
    });

    it('should serve JWKS endpoint', async () => {
      server = new MockOAuthServer(tokenFactory);
      await server.start();

      const response = await fetch(server.info.jwksUrl);
      expect(response.ok).toBe(true);

      const jwks = await response.json();
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);
    });

    it('should serve OIDC configuration', async () => {
      server = new MockOAuthServer(tokenFactory);
      await server.start();

      const response = await fetch(`${server.info.baseUrl}/.well-known/openid-configuration`);
      expect(response.ok).toBe(true);

      const config = await response.json();
      expect(config.issuer).toBe(server.info.issuer);
      expect(config.jwks_uri).toContain('/.well-known/jwks.json');
      expect(config.authorization_endpoint).toContain('/oauth/authorize');
      expect(config.token_endpoint).toContain('/oauth/token');
    });

    it('should serve OAuth metadata', async () => {
      server = new MockOAuthServer(tokenFactory);
      await server.start();

      const response = await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`);
      expect(response.ok).toBe(true);

      const metadata = await response.json();
      expect(metadata.issuer).toBe(server.info.issuer);
      expect(metadata.grant_types_supported).toContain('authorization_code');
    });
  });

  describe('anonymous token grant', () => {
    let server: MockOAuthServer;

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory);
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should issue anonymous token', async () => {
      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=anonymous',
      });

      expect(response.ok).toBe(true);

      const tokenResponse = await response.json();
      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.token_type).toBe('Bearer');
      expect(tokenResponse.expires_in).toBe(3600);
    });
  });

  describe('authorization code flow', () => {
    let server: MockOAuthServer;
    const testUser = {
      sub: 'test-user-123',
      email: 'test@example.com',
      name: 'Test User',
    };

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory, {
        autoApprove: true,
        testUser,
        clientId: 'test-client',
        validRedirectUris: ['http://localhost:3000/callback'],
        debug: false,
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should auto-approve and redirect with authorization code', async () => {
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('state', 'test-state');

      const response = await fetch(authorizeUrl.toString(), { redirect: 'manual' });

      expect(response.status).toBe(302);

      const location = response.headers.get('location');
      expect(location).toBeDefined();

      const redirectUrl = new URL(location as string);
      expect(redirectUrl.origin).toBe('http://localhost:3000');
      expect(redirectUrl.pathname).toBe('/callback');
      expect(redirectUrl.searchParams.get('code')).toBeDefined();
      expect(redirectUrl.searchParams.get('state')).toBe('test-state');
    });

    it('should reject invalid client_id', async () => {
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'wrong-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const response = await fetch(authorizeUrl.toString(), { redirect: 'manual' });

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toBeDefined();
      const redirectUrl = new URL(location as string);
      expect(redirectUrl.searchParams.get('error')).toBe('unauthorized_client');
    });

    it('should reject invalid redirect_uri', async () => {
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://malicious.com/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const response = await fetch(authorizeUrl.toString());

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('invalid_request');
    });

    it('should exchange authorization code for tokens', async () => {
      // First, get an authorization code
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const location = authResponse.headers.get('location');
      expect(location).toBeDefined();
      const code = new URL(location as string).searchParams.get('code');
      expect(code).toBeDefined();

      // Exchange code for tokens
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'test-client',
        }).toString(),
      });

      expect(tokenResponse.ok).toBe(true);

      const tokens = await tokenResponse.json();
      expect(tokens.access_token).toBeDefined();
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.refresh_token).toBeDefined();
      expect(tokens.id_token).toBeDefined();
    });

    it('should reject reused authorization code', async () => {
      // Get an authorization code
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const location = authResponse.headers.get('location');
      expect(location).toBeDefined();
      const code = new URL(location as string).searchParams.get('code');
      expect(code).toBeDefined();

      // First exchange should succeed
      const firstExchange = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'test-client',
        }).toString(),
      });
      expect(firstExchange.ok).toBe(true);

      // Second exchange should fail
      const secondExchange = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'test-client',
        }).toString(),
      });

      expect(secondExchange.ok).toBe(false);
      const error = await secondExchange.json();
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('PKCE flow', () => {
    let server: MockOAuthServer;
    const testUser = { sub: 'pkce-user' };

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory, {
        autoApprove: true,
        testUser,
        clientId: 'pkce-client',
        validRedirectUris: ['http://localhost:3000/callback'],
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should validate PKCE code_verifier', async () => {
      // Generate PKCE values
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      // S256: base64url(sha256(verifier))
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      // Get authorization code with PKCE
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'pkce-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const pkceLocation = authResponse.headers.get('location');
      expect(pkceLocation).toBeDefined();
      const code = new URL(pkceLocation as string).searchParams.get('code');
      expect(code).toBeDefined();

      // Exchange with correct code_verifier should succeed
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'pkce-client',
          code_verifier: codeVerifier,
        }).toString(),
      });

      expect(tokenResponse.ok).toBe(true);
    });

    it('should reject invalid PKCE code_verifier', async () => {
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'pkce-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const invalidVerifierLocation = authResponse.headers.get('location');
      expect(invalidVerifierLocation).toBeDefined();
      const invalidVerifierCode = new URL(invalidVerifierLocation as string).searchParams.get('code');
      expect(invalidVerifierCode).toBeDefined();

      // Exchange with wrong code_verifier should fail
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: invalidVerifierCode as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'pkce-client',
          code_verifier: 'wrong-verifier',
        }).toString(),
      });

      expect(tokenResponse.ok).toBe(false);
      const error = await tokenResponse.json();
      expect(error.error).toBe('invalid_grant');
      expect(error.error_description).toContain('PKCE');
    });

    it('should require code_verifier when code_challenge was provided', async () => {
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'pkce-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const noVerifierLocation = authResponse.headers.get('location');
      expect(noVerifierLocation).toBeDefined();
      const noVerifierCode = new URL(noVerifierLocation as string).searchParams.get('code');
      expect(noVerifierCode).toBeDefined();

      // Exchange without code_verifier should fail
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: noVerifierCode as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'pkce-client',
        }).toString(),
      });

      expect(tokenResponse.ok).toBe(false);
      const error = await tokenResponse.json();
      expect(error.error).toBe('invalid_grant');
      expect(error.error_description).toContain('code_verifier');
    });

    it('should reject unsupported code_challenge_method', async () => {
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'pkce-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      // Use wrong case - should be 'S256', not 'SHA256'
      authorizeUrl.searchParams.set('code_challenge_method', 'SHA256');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const badMethodLocation = authResponse.headers.get('location');
      expect(badMethodLocation).toBeDefined();
      const badMethodCode = new URL(badMethodLocation as string).searchParams.get('code');
      expect(badMethodCode).toBeDefined();

      // Exchange should fail due to unsupported method
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: badMethodCode as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'pkce-client',
          code_verifier: codeVerifier,
        }).toString(),
      });

      expect(tokenResponse.ok).toBe(false);
      const error = await tokenResponse.json();
      expect(error.error).toBe('invalid_grant');
      expect(error.error_description).toContain('Unsupported code_challenge_method');
    });
  });

  describe('refresh token flow', () => {
    let server: MockOAuthServer;
    const testUser = { sub: 'refresh-user', email: 'refresh@example.com' };

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory, {
        autoApprove: true,
        testUser,
        clientId: 'refresh-client',
        validRedirectUris: ['http://localhost:3000/callback'],
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should refresh access token', async () => {
      // Get authorization code
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'refresh-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const authResponse = await fetch(authorizeUrl.toString(), { redirect: 'manual' });
      const refreshLocation = authResponse.headers.get('location');
      expect(refreshLocation).toBeDefined();
      const refreshCode = new URL(refreshLocation as string).searchParams.get('code');
      expect(refreshCode).toBeDefined();

      // Exchange for tokens
      const tokenResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: refreshCode as string,
          redirect_uri: 'http://localhost:3000/callback',
          client_id: 'refresh-client',
        }).toString(),
      });

      const tokens = await tokenResponse.json();
      const refreshToken = tokens.refresh_token;

      // Use refresh token
      const refreshResponse = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'refresh-client',
        }).toString(),
      });

      expect(refreshResponse.ok).toBe(true);

      const newTokens = await refreshResponse.json();
      expect(newTokens.access_token).toBeDefined();
      expect(newTokens.refresh_token).toBeDefined();
      // Refresh token should be rotated
      expect(newTokens.refresh_token).not.toBe(refreshToken);
    });

    it('should reject invalid refresh token with invalid_grant', async () => {
      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'invalid-token',
          client_id: 'refresh-client',
        }).toString(),
      });

      expect(response.ok).toBe(false);
      const error = await response.json();
      expect(error.error).toBe('invalid_grant');
    });
  });

  describe('userinfo endpoint', () => {
    let server: MockOAuthServer;
    const testUser = {
      sub: 'userinfo-user',
      email: 'userinfo@example.com',
      name: 'UserInfo Test',
      picture: 'https://example.com/avatar.png',
    };

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory, {
        testUser,
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should return user info with Bearer token', async () => {
      const token = await tokenFactory.createTestToken({ sub: testUser.sub });

      const response = await fetch(`${server.info.baseUrl}/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.ok).toBe(true);

      const userInfo = await response.json();
      expect(userInfo.sub).toBe(testUser.sub);
      expect(userInfo.email).toBe(testUser.email);
      expect(userInfo.name).toBe(testUser.name);
      expect(userInfo.picture).toBe(testUser.picture);
    });

    it('should reject requests without Bearer token', async () => {
      const response = await fetch(`${server.info.baseUrl}/userinfo`);

      expect(response.status).toBe(401);
    });
  });

  describe('client secret validation', () => {
    let server: MockOAuthServer;

    afterEach(async () => {
      if (server) {
        await server.stop();
      }
    });

    it('should accept client secret with colons via Basic auth', async () => {
      const clientSecret = 'my:secret:with:colons';
      server = new MockOAuthServer(tokenFactory, {
        clientSecret,
      });
      await server.start();

      // Basic auth: base64(client_id:client_secret)
      const credentials = Buffer.from(`test-client:${clientSecret}`).toString('base64');

      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: 'grant_type=anonymous',
      });

      expect(response.ok).toBe(true);
      const tokenResponse = await response.json();
      expect(tokenResponse.access_token).toBeDefined();
    });

    it('should accept client secret via POST body parameter', async () => {
      const clientSecret = 'my-secret-123';
      server = new MockOAuthServer(tokenFactory, {
        clientSecret,
      });
      await server.start();

      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=anonymous&client_secret=${clientSecret}`,
      });

      expect(response.ok).toBe(true);
      const tokenResponse = await response.json();
      expect(tokenResponse.access_token).toBeDefined();
    });

    it('should reject invalid client secret with 401', async () => {
      server = new MockOAuthServer(tokenFactory, {
        clientSecret: 'correct-secret',
      });
      await server.start();

      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=anonymous&client_secret=wrong-secret',
      });

      expect(response.status).toBe(401);
      const errorResponse = await response.json();
      expect(errorResponse.error).toBe('invalid_client');
    });

    it('should handle empty password in Basic auth', async () => {
      const clientSecret = '';
      server = new MockOAuthServer(tokenFactory, {
        clientSecret,
      });
      await server.start();

      // Basic auth with empty password: base64("client:")
      const credentials = Buffer.from('test-client:').toString('base64');

      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: 'grant_type=anonymous',
      });

      expect(response.ok).toBe(true);
    });

    it('should handle password with special characters via Basic auth', async () => {
      const clientSecret = 'secret+with=special/chars&more';
      server = new MockOAuthServer(tokenFactory, {
        clientSecret,
      });
      await server.start();

      const credentials = Buffer.from(`test-client:${clientSecret}`).toString('base64');

      const response = await fetch(`${server.info.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: 'grant_type=anonymous',
      });

      expect(response.ok).toBe(true);
      const tokenResponse = await response.json();
      expect(tokenResponse.access_token).toBeDefined();
    });
  });

  describe('redirect URI wildcards', () => {
    let server: MockOAuthServer;

    beforeAll(async () => {
      server = new MockOAuthServer(tokenFactory, {
        autoApprove: true,
        testUser: { sub: 'wildcard-user' },
        clientId: 'wildcard-client',
        validRedirectUris: ['http://localhost:*/callback'],
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should accept redirect URI matching wildcard pattern', async () => {
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'wildcard-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:8080/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const response = await fetch(authorizeUrl.toString(), { redirect: 'manual' });

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('localhost:8080/callback');
    });

    it('should reject redirect URI not matching pattern', async () => {
      const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', 'wildcard-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://example.com:8080/callback');
      authorizeUrl.searchParams.set('response_type', 'code');

      const response = await fetch(authorizeUrl.toString());

      expect(response.status).toBe(400);
    });
  });
});
