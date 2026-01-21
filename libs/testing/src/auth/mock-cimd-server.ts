/**
 * @file mock-cimd-server.ts
 * @description Mock CIMD server for testing OAuth clients with CIMD support
 *
 * This module provides a mock HTTP server that serves CIMD (Client ID Metadata Documents)
 * for testing OAuth flows with dynamic client metadata.
 *
 * @example
 * ```typescript
 * import { MockCimdServer } from '@frontmcp/testing';
 *
 * const cimdServer = new MockCimdServer();
 * const info = await cimdServer.start();
 *
 * // Register a client
 * const clientId = cimdServer.registerClient({
 *   name: 'Test Client',
 *   redirectUris: ['http://localhost:3000/callback'],
 * });
 *
 * // Use clientId in OAuth flow
 * // client_id = http://localhost:PORT/clients/test-client/metadata.json
 *
 * await cimdServer.stop();
 * ```
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Options for registering a mock CIMD client
 */
export interface MockCimdClientOptions {
  /**
   * Human-readable name for the client.
   * Also used to generate the URL path if not provided.
   */
  name: string;

  /**
   * Custom path for the metadata endpoint.
   * If not provided, derived from name (e.g., "Test Client" -> "test-client")
   */
  path?: string;

  /**
   * Redirect URIs for the client.
   * @default ['http://localhost:3000/callback']
   */
  redirectUris?: string[];

  /**
   * Token endpoint authentication method.
   * @default 'none'
   */
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt';

  /**
   * OAuth grant types the client can use.
   * @default ['authorization_code']
   */
  grantTypes?: string[];

  /**
   * OAuth response types the client can request.
   * @default ['code']
   */
  responseTypes?: string[];

  /**
   * URL of the client's home page.
   */
  clientUri?: string;

  /**
   * URL of the client's logo image.
   */
  logoUri?: string;

  /**
   * Requested OAuth scopes (space-separated).
   */
  scope?: string;

  /**
   * Contact emails for the client.
   */
  contacts?: string[];
}

/**
 * Server configuration options
 */
export interface MockCimdServerOptions {
  /**
   * Port to listen on (default: random available port)
   */
  port?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Server info returned after start
 */
export interface MockCimdServerInfo {
  /**
   * Base URL of the server
   */
  baseUrl: string;

  /**
   * Port the server is listening on
   */
  port: number;
}

/**
 * Internal representation of a registered client
 */
interface RegisteredClient {
  path: string;
  document: CimdDocument;
}

/**
 * CIMD document structure
 */
interface CimdDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// MOCK CIMD SERVER
// ═══════════════════════════════════════════════════════════════════

/**
 * Mock server for CIMD (Client ID Metadata Documents) testing.
 *
 * Serves client metadata documents at configurable paths, allowing
 * testing of OAuth flows with dynamic client registration via CIMD.
 */
export class MockCimdServer {
  private readonly options: MockCimdServerOptions;
  private server: Server | null = null;
  private _info: MockCimdServerInfo | null = null;

  /** Map of path -> client */
  private clients = new Map<string, RegisteredClient>();

  /** Map of path -> custom response (for error testing) */
  private customResponses = new Map<string, { status: number; body?: unknown }>();

  constructor(options: MockCimdServerOptions = {}) {
    this.options = options;
  }

  /**
   * Start the mock CIMD server.
   */
  async start(): Promise<MockCimdServerInfo> {
    if (this.server) {
      throw new Error('Mock CIMD server is already running');
    }

    const port = this.options.port ?? 0;

    return new Promise((resolve, reject) => {
      const server = createServer(this.handleRequest.bind(this));
      this.server = server;

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
        this._info = {
          baseUrl: `http://localhost:${actualPort}`,
          port: actualPort,
        };

        this.log(`Mock CIMD server started at ${this._info.baseUrl}`);
        resolve(this._info);
      });
    });
  }

  /**
   * Stop the mock CIMD server.
   */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this._info = null;
          this.log('Mock CIMD server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get server info.
   */
  get info(): MockCimdServerInfo {
    if (!this._info) {
      throw new Error('Mock CIMD server is not running');
    }
    return this._info;
  }

  /**
   * Register a client and return its client_id URL.
   *
   * @param options - Client configuration
   * @returns The client_id URL to use in OAuth flows
   */
  registerClient(options: MockCimdClientOptions): string {
    if (!this._info) {
      throw new Error('Mock CIMD server is not running. Call start() first.');
    }

    const path = options.path ?? this.nameToPath(options.name);
    const fullPath = `/clients/${path}/metadata.json`;
    const clientId = `${this._info.baseUrl}${fullPath}`;

    const document: CimdDocument = {
      client_id: clientId,
      client_name: options.name,
      redirect_uris: options.redirectUris ?? ['http://localhost:3000/callback'],
      token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? 'none',
      grant_types: options.grantTypes ?? ['authorization_code'],
      response_types: options.responseTypes ?? ['code'],
      ...(options.clientUri && { client_uri: options.clientUri }),
      ...(options.logoUri && { logo_uri: options.logoUri }),
      ...(options.scope && { scope: options.scope }),
      ...(options.contacts && { contacts: options.contacts }),
    };

    this.clients.set(fullPath, { path: fullPath, document });
    this.log(`Registered client: ${options.name} at ${fullPath}`);

    return clientId;
  }

  /**
   * Get the client_id URL for a previously registered client.
   *
   * @param name - The client name used during registration
   * @returns The client_id URL
   */
  getClientId(name: string): string {
    if (!this._info) {
      throw new Error('Mock CIMD server is not running');
    }

    const path = this.nameToPath(name);
    const fullPath = `/clients/${path}/metadata.json`;
    const client = this.clients.get(fullPath);

    if (!client) {
      throw new Error(`Client "${name}" not found. Register it first.`);
    }

    return client.document.client_id;
  }

  /**
   * Register an invalid document for error testing.
   *
   * @param path - The path to serve the invalid document at
   * @param document - The invalid document content
   */
  registerInvalidDocument(path: string, document: unknown): void {
    if (!this._info) {
      throw new Error('Mock CIMD server is not running');
    }

    const fullPath = path.startsWith('/') ? path : `/${path}`;
    const clientId = `${this._info.baseUrl}${fullPath}`;

    // Store as a special "invalid" client that bypasses validation
    this.clients.set(fullPath, {
      path: fullPath,
      document: document as CimdDocument,
    });

    this.log(`Registered invalid document at ${fullPath}`);
  }

  /**
   * Register a custom error response for a path.
   *
   * @param path - The path to return the error at
   * @param statusCode - HTTP status code to return
   * @param body - Optional response body
   */
  registerFetchError(path: string, statusCode: number, body?: unknown): void {
    const fullPath = path.startsWith('/') ? path : `/${path}`;
    this.customResponses.set(fullPath, { status: statusCode, body });
    this.log(`Registered error response at ${fullPath}: ${statusCode}`);
  }

  /**
   * Remove a registered client.
   *
   * @param name - The client name to remove
   */
  removeClient(name: string): void {
    const path = this.nameToPath(name);
    const fullPath = `/clients/${path}/metadata.json`;
    this.clients.delete(fullPath);
    this.log(`Removed client: ${name}`);
  }

  /**
   * Clear all registered clients and custom responses.
   */
  clear(): void {
    this.clients.clear();
    this.customResponses.clear();
    this.log('Cleared all clients and custom responses');
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    this.log(`${method} ${url}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    // Check for custom error responses first
    if (this.customResponses.has(url)) {
      const customResponse = this.customResponses.get(url)!;
      res.writeHead(customResponse.status, { 'Content-Type': 'application/json' });
      res.end(customResponse.body ? JSON.stringify(customResponse.body) : '');
      this.log(`Returned custom error response: ${customResponse.status}`);
      return;
    }

    // Check for registered clients
    const client = this.clients.get(url);
    if (client) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=3600',
      });
      res.end(JSON.stringify(client.document));
      this.log(`Served client metadata: ${client.document.client_name}`);
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', message: `No client at ${url}` }));
    this.log(`Client not found: ${url}`);
  }

  private nameToPath(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[MockCimdServer] ${message}`);
    }
  }
}
