/**
 * @file mock-oauth-server.ts
 * @description Mock OAuth server for testing transparent and orchestrated auth modes
 *
 * This module provides a mock OAuth/OIDC server that serves:
 * - JWKS endpoint for token verification
 * - OAuth metadata endpoint
 * - Authorization endpoint (with auto-approve for E2E tests)
 * - Token endpoint (supports authorization_code, refresh_token, anonymous)
 * - UserInfo endpoint
 *
 * @example Basic usage
 * ```typescript
 * import { MockOAuthServer, TestTokenFactory } from '@frontmcp/testing';
 *
 * const tokenFactory = new TestTokenFactory();
 * const oauthServer = new MockOAuthServer(tokenFactory);
 *
 * // Start the mock server
 * await oauthServer.start();
 *
 * // Configure your MCP server to use this mock
 * // IDP_PROVIDER_URL = oauthServer.baseUrl
 *
 * // Create tokens using the same factory
 * const token = await tokenFactory.createTestToken({ sub: 'user-123' });
 *
 * // Stop when done
 * await oauthServer.stop();
 * ```
 *
 * @example Authorization code flow (E2E testing)
 * ```typescript
 * const oauthServer = new MockOAuthServer(tokenFactory, {
 *   autoApprove: true,
 *   testUser: { sub: 'user-123', email: 'test@example.com' },
 *   clientId: 'my-client',
 *   validRedirectUris: ['http://localhost:3000/callback'],
 * });
 *
 * await oauthServer.start();
 *
 * // User visits /oauth/authorize → automatically redirects back with code
 * // Token exchange happens automatically
 * ```
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { randomBytes, sha256Base64url, base64urlEncode } from '@frontmcp/utils';
import type { TestTokenFactory } from './token-factory';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Test user configuration for mock OAuth server
 */
export interface MockTestUser {
  /** Subject identifier */
  sub: string;
  /** User email */
  email?: string;
  /** Display name */
  name?: string;
  /** Profile picture URL */
  picture?: string;
  /** Additional claims to include in tokens */
  claims?: Record<string, unknown>;
}

/**
 * Authorization code record stored by mock server
 */
interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scopes: string[];
  user: MockTestUser;
  state?: string;
  expiresAt: number;
  used: boolean;
}

/**
 * Refresh token record stored by mock server
 */
interface RefreshTokenRecord {
  token: string;
  clientId: string;
  user: MockTestUser;
  scopes: string[];
  expiresAt: number;
}

export interface MockOAuthServerOptions {
  /** Port to listen on (default: random available port) */
  port?: number;
  /** Issuer URL (default: http://localhost:{port}) */
  issuer?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-approve authorization requests (for E2E testing) */
  autoApprove?: boolean;
  /** Test user to return on authorization (required if autoApprove is true) */
  testUser?: MockTestUser;
  /** Expected client ID for validation */
  clientId?: string;
  /** Expected client secret (optional, for confidential clients) */
  clientSecret?: string;
  /** Allowed redirect URIs (supports wildcards like http://localhost:*) */
  validRedirectUris?: string[];
  /** Access token TTL in seconds (default: 3600) */
  accessTokenTtlSeconds?: number;
  /** Refresh token TTL in seconds (default: 30 days) */
  refreshTokenTtlSeconds?: number;
}

export interface MockOAuthServerInfo {
  /** Base URL of the server */
  baseUrl: string;
  /** Port the server is listening on */
  port: number;
  /** Issuer URL */
  issuer: string;
  /** JWKS endpoint URL */
  jwksUrl: string;
}

// ═══════════════════════════════════════════════════════════════════
// MOCK OAUTH SERVER
// ═══════════════════════════════════════════════════════════════════

/**
 * Mock OAuth/OIDC server for testing transparent and orchestrated auth modes
 *
 * Serves JWKS from a TestTokenFactory so that MCP servers can
 * validate test tokens without connecting to a real IdP.
 *
 * Supports full authorization code flow with PKCE for E2E testing
 * of orchestrated multi-provider authentication.
 */
export class MockOAuthServer {
  private readonly tokenFactory: TestTokenFactory;
  private options: MockOAuthServerOptions;
  private server: Server | null = null;
  private _info: MockOAuthServerInfo | null = null;
  private connections: Set<import('net').Socket> = new Set();

  /** Authorization code storage (code -> record) */
  private authCodes = new Map<string, AuthorizationCodeRecord>();

  /** Refresh token storage (token -> record) */
  private refreshTokens = new Map<string, RefreshTokenRecord>();

  /** Access token TTL in seconds */
  private readonly accessTokenTtlSeconds: number;

  /** Refresh token TTL in seconds */
  private readonly refreshTokenTtlSeconds: number;

  constructor(tokenFactory: TestTokenFactory, options: MockOAuthServerOptions = {}) {
    this.tokenFactory = tokenFactory;
    this.options = options;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 3600;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds ?? 30 * 24 * 3600;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURATION METHODS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Set auto-approve mode for authorization requests
   */
  setAutoApprove(enabled: boolean): void {
    this.options.autoApprove = enabled;
  }

  /**
   * Set the test user returned on authorization
   */
  setTestUser(user: MockTestUser): void {
    this.options.testUser = user;
  }

  /**
   * Add a valid redirect URI
   */
  addValidRedirectUri(uri: string): void {
    const uris = this.options.validRedirectUris ?? [];
    uris.push(uri);
    this.options.validRedirectUris = uris;
  }

  /**
   * Clear all stored authorization codes and refresh tokens
   */
  clearStoredTokens(): void {
    this.authCodes.clear();
    this.refreshTokens.clear();
  }

  /**
   * Start the mock OAuth server
   */
  async start(): Promise<MockOAuthServerInfo> {
    if (this.server) {
      throw new Error('Mock OAuth server is already running');
    }

    const port = this.options.port ?? 0; // 0 = random available port

    return new Promise((resolve, reject) => {
      const server = createServer(this.handleRequest.bind(this));
      this.server = server;

      // Track connections for proper cleanup
      server.on('connection', (socket) => {
        this.connections.add(socket);
        socket.on('close', () => this.connections.delete(socket));
      });

      server.on('error', (err) => {
        this.log(`Server error: ${err.message}`);
        reject(err);
      });

      server.listen(port, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }

        const actualPort = address.port;
        const issuer = this.options.issuer ?? `http://localhost:${actualPort}`;

        this._info = {
          baseUrl: `http://localhost:${actualPort}`,
          port: actualPort,
          issuer,
          jwksUrl: `http://localhost:${actualPort}/.well-known/jwks.json`,
        };

        this.log(`Mock OAuth server started at ${this._info.baseUrl}`);
        resolve(this._info);
      });
    });
  }

  /**
   * Stop the mock OAuth server
   */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    // Destroy all active connections to allow server.close() to complete
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this._info = null;
          this.log('Mock OAuth server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get server info
   */
  get info(): MockOAuthServerInfo {
    if (!this._info) {
      throw new Error('Mock OAuth server is not running');
    }
    return this._info;
  }

  /**
   * Get the token factory (for creating tokens)
   */
  getTokenFactory(): TestTokenFactory {
    return this.tokenFactory;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fullUrl = req.url ?? '/';
    const [urlPath, queryString] = fullUrl.split('?');
    this.log(`${req.method} ${urlPath}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (urlPath === '/.well-known/jwks.json' || urlPath === '/.well-known/jwks') {
        await this.handleJwks(req, res);
      } else if (urlPath === '/.well-known/openid-configuration') {
        await this.handleOidcConfig(req, res);
      } else if (urlPath === '/.well-known/oauth-authorization-server') {
        await this.handleOAuthMetadata(req, res);
      } else if (urlPath === '/oauth/authorize') {
        await this.handleAuthorizeEndpoint(req, res, queryString);
      } else if (urlPath === '/oauth/token') {
        await this.handleTokenEndpoint(req, res);
      } else if (urlPath === '/userinfo') {
        await this.handleUserInfoEndpoint(req, res);
      } else if (urlPath === '/oauth/authorize/submit' && req.method === 'POST') {
        await this.handleAuthorizeSubmit(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', error_description: 'Endpoint not found' }));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      this.logError(`Error handling request to ${urlPath}: ${errorMsg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', error_description: 'Internal server error' }));
    }
  }

  private async handleJwks(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const jwks = await this.tokenFactory.getPublicJwks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jwks));
    this.log('Served JWKS');
  }

  private async handleOidcConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const issuer = this._info?.issuer ?? 'http://localhost';
    const config = {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code', 'token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'name'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials', 'anonymous'],
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
    this.log('Served OIDC configuration');
  }

  private async handleOAuthMetadata(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const issuer = this._info?.issuer ?? 'http://localhost';
    const metadata = {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code', 'token'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials', 'anonymous'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      scopes_supported: ['openid', 'profile', 'email', 'anonymous'],
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metadata));
    this.log('Served OAuth metadata');
  }

  /**
   * Handle authorization endpoint (GET /oauth/authorize)
   * Supports auto-approve mode for E2E testing
   */
  private async handleAuthorizeEndpoint(
    _req: IncomingMessage,
    res: ServerResponse,
    queryString?: string,
  ): Promise<void> {
    const params = new URLSearchParams(queryString ?? '');

    // Extract parameters
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const responseType = params.get('response_type');
    const state = params.get('state') ?? undefined;
    const scope = params.get('scope') ?? 'openid';
    const codeChallenge = params.get('code_challenge') ?? undefined;
    const codeChallengeMethod = params.get('code_challenge_method') ?? undefined;

    // Validate required parameters
    if (!clientId || !redirectUri || !responseType) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required parameters: client_id, redirect_uri, response_type',
        }),
      );
      return;
    }

    // Validate response_type
    if (responseType !== 'code') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'unsupported_response_type',
          error_description: 'Only response_type=code is supported',
        }),
      );
      return;
    }

    // Validate redirect_uri FIRST (before any redirects to prevent open redirect)
    if (!this.isValidRedirectUri(redirectUri)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Invalid redirect_uri',
        }),
      );
      return;
    }

    // Validate client_id if configured (safe to redirect now that redirect_uri is validated)
    if (this.options.clientId && clientId !== this.options.clientId) {
      this.redirectWithError(res, redirectUri, 'unauthorized_client', 'Invalid client_id', state);
      return;
    }

    // Auto-approve mode: immediately redirect with authorization code
    if (this.options.autoApprove) {
      const testUser = this.options.testUser;
      if (!testUser) {
        this.logError('autoApprove is enabled but no testUser configured. Set testUser in MockOAuthServerOptions.');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'server_error',
            error_description: 'autoApprove is enabled but no testUser configured',
          }),
        );
        return;
      }

      // Generate authorization code
      const code = this.generateCode();
      const scopes = scope.split(' ').filter(Boolean);

      // Store the code
      this.authCodes.set(code, {
        code,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scopes,
        user: testUser,
        state,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
        used: false,
      });

      // Redirect back with code
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', code);
      if (state) {
        callbackUrl.searchParams.set('state', state);
      }

      this.log(`Auto-approved auth request, redirecting with code to ${callbackUrl.origin}${callbackUrl.pathname}`);
      res.writeHead(302, { Location: callbackUrl.toString() });
      res.end();
      return;
    }

    // Manual mode: render login page (for manual testing)
    const html = this.renderLoginPage(clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async handleTokenEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Parse request body
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get('grant_type');

    if (grantType === 'anonymous') {
      // Issue an anonymous token
      const token = await this.tokenFactory.createAnonymousToken();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: token,
          token_type: 'Bearer',
          expires_in: this.accessTokenTtlSeconds,
        }),
      );
      this.log('Issued anonymous token');
    } else if (grantType === 'authorization_code') {
      await this.handleAuthorizationCodeGrant(params, res);
    } else if (grantType === 'refresh_token') {
      await this.handleRefreshTokenGrant(params, res);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'unsupported_grant_type',
          error_description: `Unsupported grant_type: ${grantType}`,
        }),
      );
    }
  }

  /**
   * Handle authorization_code grant type
   */
  private async handleAuthorizationCodeGrant(params: URLSearchParams, res: ServerResponse): Promise<void> {
    const code = params.get('code');
    const redirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');
    const codeVerifier = params.get('code_verifier');

    // Validate required parameters
    if (!code || !redirectUri || !clientId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required parameters: code, redirect_uri, client_id',
        }),
      );
      return;
    }

    // Find the authorization code
    const codeRecord = this.authCodes.get(code);
    if (!codeRecord) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Authorization code not found or expired',
        }),
      );
      return;
    }

    // Check if code has been used (single-use)
    if (codeRecord.used) {
      this.authCodes.delete(code);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Authorization code has already been used',
        }),
      );
      return;
    }

    // Check expiration
    if (codeRecord.expiresAt < Date.now()) {
      this.authCodes.delete(code);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Authorization code has expired',
        }),
      );
      return;
    }

    // Validate client_id
    if (codeRecord.clientId !== clientId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'client_id mismatch',
        }),
      );
      return;
    }

    // Validate redirect_uri
    if (codeRecord.redirectUri !== redirectUri) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'redirect_uri mismatch',
        }),
      );
      return;
    }

    // Validate PKCE if code_challenge was provided
    if (codeRecord.codeChallenge) {
      if (!codeVerifier) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'code_verifier required',
          }),
        );
        return;
      }

      const expectedChallenge = this.computeCodeChallenge(codeVerifier, codeRecord.codeChallengeMethod);
      if (expectedChallenge !== codeRecord.codeChallenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'PKCE verification failed',
          }),
        );
        return;
      }
    }

    // Mark code as used
    codeRecord.used = true;

    // Generate tokens
    const accessToken = await this.tokenFactory.createTestToken({
      sub: codeRecord.user.sub,
      claims: {
        email: codeRecord.user.email,
        name: codeRecord.user.name,
        ...(codeRecord.user.claims ?? {}),
      },
    });

    // Generate ID token (same as access token for simplicity)
    const idToken = await this.tokenFactory.createTestToken({
      sub: codeRecord.user.sub,
      claims: {
        email: codeRecord.user.email,
        name: codeRecord.user.name,
        ...(codeRecord.user.claims ?? {}),
      },
    });

    // Generate refresh token
    const refreshToken = this.generateCode();
    this.refreshTokens.set(refreshToken, {
      token: refreshToken,
      clientId,
      user: codeRecord.user,
      scopes: codeRecord.scopes,
      expiresAt: Date.now() + this.refreshTokenTtlSeconds * 1000,
    });

    this.log(`Issued tokens for user: ${codeRecord.user.sub}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.accessTokenTtlSeconds,
        refresh_token: refreshToken,
        id_token: idToken,
        scope: codeRecord.scopes.join(' '),
      }),
    );
  }

  /**
   * Handle refresh_token grant type
   */
  private async handleRefreshTokenGrant(params: URLSearchParams, res: ServerResponse): Promise<void> {
    const refreshToken = params.get('refresh_token');
    const clientId = params.get('client_id');

    if (!refreshToken || !clientId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required parameters: refresh_token, client_id',
        }),
      );
      return;
    }

    const tokenRecord = this.refreshTokens.get(refreshToken);
    if (!tokenRecord) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Refresh token not found or expired',
        }),
      );
      return;
    }

    if (tokenRecord.expiresAt < Date.now()) {
      this.refreshTokens.delete(refreshToken);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Refresh token has expired',
        }),
      );
      return;
    }

    if (tokenRecord.clientId !== clientId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'client_id mismatch',
        }),
      );
      return;
    }

    // Generate new access token
    const accessToken = await this.tokenFactory.createTestToken({
      sub: tokenRecord.user.sub,
      claims: {
        email: tokenRecord.user.email,
        name: tokenRecord.user.name,
        ...(tokenRecord.user.claims ?? {}),
      },
    });

    // Rotate refresh token
    this.refreshTokens.delete(refreshToken);
    const newRefreshToken = this.generateCode();
    this.refreshTokens.set(newRefreshToken, {
      ...tokenRecord,
      token: newRefreshToken,
      expiresAt: Date.now() + this.refreshTokenTtlSeconds * 1000,
    });

    this.log(`Refreshed tokens for user: ${tokenRecord.user.sub}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.accessTokenTtlSeconds,
        refresh_token: newRefreshToken,
        scope: tokenRecord.scopes.join(' '),
      }),
    );
  }

  /**
   * Handle userinfo endpoint (GET /userinfo)
   */
  private async handleUserInfoEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Extract Bearer token from Authorization header.
    // Note: Token is not validated - any Bearer token returns the configured test user.
    // This is intentional for testing purposes.
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      res.end(JSON.stringify({ error: 'invalid_token', error_description: 'Missing or invalid Authorization header' }));
      return;
    }

    // For mock server, we'll return the test user if configured
    const testUser = this.options.testUser;
    if (!testUser) {
      this.logError('UserInfo endpoint called but no testUser configured. Set testUser in MockOAuthServerOptions.');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', error_description: 'No test user configured' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        sub: testUser.sub,
        email: testUser.email,
        name: testUser.name,
        picture: testUser.picture,
        ...(testUser.claims ?? {}),
      }),
    );
  }

  /**
   * Handle authorize form submission (POST /oauth/authorize/submit)
   * Processes the manual login form for non-autoApprove testing
   */
  private async handleAuthorizeSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Parse form data from POST body
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);

    // Extract form fields
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const scope = params.get('scope') ?? 'openid';
    const state = params.get('state') ?? undefined;
    const codeChallenge = params.get('code_challenge') ?? undefined;
    const codeChallengeMethod = params.get('code_challenge_method') ?? undefined;
    const action = params.get('action');

    // User fields
    const sub = params.get('sub');
    const email = params.get('email') ?? undefined;
    const name = params.get('name') ?? undefined;

    // Validate required fields
    if (!clientId || !redirectUri || !sub) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required fields',
        }),
      );
      return;
    }

    // Validate redirect_uri FIRST (before any redirects to prevent open redirect)
    if (!this.isValidRedirectUri(redirectUri)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Invalid redirect_uri',
        }),
      );
      return;
    }

    // Validate client_id if configured (safe to redirect now that redirect_uri is validated)
    if (this.options.clientId && clientId !== this.options.clientId) {
      this.redirectWithError(res, redirectUri, 'unauthorized_client', 'Invalid client_id', state);
      return;
    }

    // Handle deny action (safe to redirect now that redirect_uri is validated)
    if (action === 'deny') {
      this.redirectWithError(res, redirectUri, 'access_denied', 'User denied the authorization request', state);
      return;
    }

    // Create test user from form data
    const testUser: MockTestUser = {
      sub,
      email,
      name,
    };

    // Generate authorization code
    const code = this.generateCode();
    const scopes = scope.split(' ').filter(Boolean);

    // Store the code
    this.authCodes.set(code, {
      code,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scopes,
      user: testUser,
      state,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      used: false,
    });

    // Redirect back with code
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', code);
    if (state) {
      callbackUrl.searchParams.set('state', state);
    }

    this.log(
      `Manual auth approved for user: ${sub}, redirecting with code to ${callbackUrl.origin}${callbackUrl.pathname}`,
    );
    res.writeHead(302, { Location: callbackUrl.toString() });
    res.end();
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private log(message: string): void {
    const shouldLog = this.options.debug || process.env['DEBUG'] === '1' || process.env['DEBUG_SERVER'] === '1';
    if (shouldLog) {
      console.log(`[MockOAuthServer] ${message}`);
    }
  }

  private logError(message: string): void {
    // Always log errors to stderr regardless of debug mode
    console.error(`[MockOAuthServer ERROR] ${message}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Validate redirect URI against configured valid URIs
   * Supports wildcards for port (e.g., http://localhost:*)
   */
  private isValidRedirectUri(redirectUri: string): boolean {
    const validUris = this.options.validRedirectUris;

    // If no valid URIs configured, allow all (for backwards compatibility)
    if (!validUris || validUris.length === 0) {
      return true;
    }

    // Input length guard to prevent DoS
    if (redirectUri.length > 2048) {
      return false;
    }

    for (const pattern of validUris) {
      // Exact match
      if (pattern === redirectUri) {
        return true;
      }

      // Wildcard pattern (e.g., http://localhost:*/callback)
      // Uses safe string-based matching (O(n) complexity) instead of regex
      if (pattern.includes('*')) {
        if (this.matchWildcardPattern(pattern, redirectUri)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Safe string-based wildcard matching (O(n) complexity)
   * Avoids regex to prevent ReDoS vulnerabilities
   */
  private matchWildcardPattern(pattern: string, input: string): boolean {
    const parts = pattern.split('*');
    let remaining = input;

    // First part must be prefix
    if (!remaining.startsWith(parts[0])) {
      return false;
    }
    remaining = remaining.slice(parts[0].length);

    // Check middle and last parts
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // Last part must be suffix
        if (!remaining.endsWith(part)) {
          return false;
        }
      } else {
        // Middle parts must exist somewhere in remaining
        const idx = remaining.indexOf(part);
        if (idx === -1) {
          return false;
        }
        remaining = remaining.slice(idx + part.length);
      }
    }

    return true;
  }

  /**
   * Redirect with OAuth error
   */
  private redirectWithError(
    res: ServerResponse,
    redirectUri: string,
    error: string,
    errorDescription: string,
    state?: string,
  ): void {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', errorDescription);
    if (state) {
      url.searchParams.set('state', state);
    }
    res.writeHead(302, { Location: url.toString() });
    res.end();
  }

  /**
   * Generate a random authorization code
   */
  private generateCode(): string {
    return base64urlEncode(randomBytes(32));
  }

  /**
   * Compute PKCE code challenge from verifier
   */
  private computeCodeChallenge(verifier: string, method?: string): string {
    if (method === 'S256') {
      return sha256Base64url(verifier);
    }
    // Plain method (not recommended but supported)
    return verifier;
  }

  /**
   * Render a simple login page for manual testing
   */
  private renderLoginPage(
    clientId: string,
    redirectUri: string,
    scope: string,
    state?: string,
    codeChallenge?: string,
    codeChallengeMethod?: string,
  ): string {
    const issuer = this._info?.issuer ?? 'http://localhost';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock OAuth Login</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 400px;
      width: 100%;
    }
    h1 { margin-top: 0; color: #333; }
    .info { color: #666; font-size: 14px; margin-bottom: 20px; }
    .field { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: 500; }
    input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
    button {
      width: 100%;
      padding: 12px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover { background: #5a6fd6; }
    .deny { background: #e53e3e; margin-top: 10px; }
    .deny:hover { background: #c53030; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Mock OAuth Login</h1>
    <p class="info">
      <strong>Client:</strong> ${this.escapeHtml(clientId)}<br>
      <strong>Scopes:</strong> ${this.escapeHtml(scope)}<br>
      <strong>Issuer:</strong> ${this.escapeHtml(issuer)}
    </p>
    <form method="POST" action="/oauth/authorize/submit">
      <input type="hidden" name="client_id" value="${this.escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${this.escapeHtml(redirectUri)}">
      <input type="hidden" name="scope" value="${this.escapeHtml(scope)}">
      ${state ? `<input type="hidden" name="state" value="${this.escapeHtml(state)}">` : ''}
      ${codeChallenge ? `<input type="hidden" name="code_challenge" value="${this.escapeHtml(codeChallenge)}">` : ''}
      ${codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${this.escapeHtml(codeChallengeMethod)}">` : ''}
      <div class="field">
        <label for="sub">User ID (sub)</label>
        <input type="text" id="sub" name="sub" value="test-user-123" required>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" value="test@example.com">
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" value="Test User">
      </div>
      <button type="submit" name="action" value="approve">Approve</button>
      <button type="submit" name="action" value="deny" class="deny">Deny</button>
    </form>
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
