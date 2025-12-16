/**
 * @file mock-oauth-server.ts
 * @description Mock OAuth server for testing transparent auth mode
 *
 * This module provides a mock OAuth/OIDC server that serves:
 * - JWKS endpoint for token verification
 * - OAuth metadata endpoint (optional)
 * - Token endpoint for anonymous tokens (optional)
 *
 * @example
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
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import type { TestTokenFactory } from './token-factory';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface MockOAuthServerOptions {
  /** Port to listen on (default: random available port) */
  port?: number;
  /** Issuer URL (default: http://localhost:{port}) */
  issuer?: string;
  /** Enable debug logging */
  debug?: boolean;
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
 * Mock OAuth/OIDC server for testing transparent auth mode
 *
 * Serves JWKS from a TestTokenFactory so that MCP servers can
 * validate test tokens without connecting to a real IdP.
 */
export class MockOAuthServer {
  private readonly tokenFactory: TestTokenFactory;
  private readonly options: MockOAuthServerOptions;
  private server: Server | null = null;
  private _info: MockOAuthServerInfo | null = null;
  private connections: Set<import('net').Socket> = new Set();

  constructor(tokenFactory: TestTokenFactory, options: MockOAuthServerOptions = {}) {
    this.tokenFactory = tokenFactory;
    this.options = options;
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
      this.server = createServer(this.handleRequest.bind(this));

      // Track connections for proper cleanup
      this.server.on('connection', (socket) => {
        this.connections.add(socket);
        socket.on('close', () => this.connections.delete(socket));
      });

      this.server.on('error', (err) => {
        this.log(`Server error: ${err.message}`);
        reject(err);
      });

      this.server.listen(port, () => {
        const address = this.server!.address();
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
    if (!this.server) {
      return;
    }

    // Destroy all active connections to allow server.close() to complete
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
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
    const url = req.url ?? '/';
    this.log(`${req.method} ${url}`);

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
      if (url === '/.well-known/jwks.json' || url === '/.well-known/jwks') {
        await this.handleJwks(req, res);
      } else if (url === '/.well-known/openid-configuration') {
        await this.handleOidcConfig(req, res);
      } else if (url === '/.well-known/oauth-authorization-server') {
        await this.handleOAuthMetadata(req, res);
      } else if (url === '/oauth/token') {
        await this.handleTokenEndpoint(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', error_description: 'Endpoint not found' }));
      }
    } catch (error) {
      this.log(`Error handling request: ${error}`);
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
          expires_in: 3600,
        }),
      );
      this.log('Issued anonymous token');
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'unsupported_grant_type',
          error_description: 'Only anonymous grant type is supported in mock server',
        }),
      );
    }
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
    if (this.options.debug) {
      console.log(`[MockOAuthServer] ${message}`);
    }
  }
}
