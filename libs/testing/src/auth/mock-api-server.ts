/**
 * @file mock-api-server.ts
 * @description Mock API server for testing OpenAPI adapter
 *
 * This module provides a mock HTTP server that serves:
 * - OpenAPI spec endpoint for adapter initialization
 * - Mock API responses for generated tools
 *
 * @example
 * ```typescript
 * import { MockAPIServer } from '@frontmcp/testing';
 *
 * const apiServer = new MockAPIServer({
 *   openApiSpec: { openapi: '3.0.0', ... },
 *   routes: [
 *     { method: 'GET', path: '/products', response: { body: [...] } },
 *   ],
 * });
 *
 * // Start the mock server
 * const info = await apiServer.start();
 *
 * // Configure your MCP server to use this mock
 * // OPENAPI_BASE_URL = info.baseUrl
 *
 * // Stop when done
 * await apiServer.stop();
 * ```
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface MockRoute {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Path to match (e.g., '/products', '/products/:id') */
  path: string;
  /** Response to return */
  response: MockResponse;
}

export interface MockResponse {
  /** HTTP status code (default: 200) */
  status?: number;
  /** Response headers */
  headers?: Record<string, string>;
  /** Response body (will be JSON serialized) */
  body: unknown;
}

export interface MockAPIServerOptions {
  /** Port to listen on (default: random available port) */
  port?: number;
  /** OpenAPI spec to serve at /openapi.json */
  openApiSpec: unknown;
  /** Routes to mock */
  routes?: MockRoute[];
  /** Enable debug logging */
  debug?: boolean;
}

export interface MockAPIServerInfo {
  /** Base URL of the server */
  baseUrl: string;
  /** Port the server is listening on */
  port: number;
  /** OpenAPI spec URL */
  specUrl: string;
}

// ═══════════════════════════════════════════════════════════════════
// MOCK API SERVER
// ═══════════════════════════════════════════════════════════════════

/**
 * Mock API server for testing OpenAPI adapter
 *
 * Serves an OpenAPI spec and mock API responses so that MCP servers
 * can use the OpenAPI adapter without connecting to a real API.
 */
export class MockAPIServer {
  private readonly options: MockAPIServerOptions;
  private server: Server | null = null;
  private _info: MockAPIServerInfo | null = null;
  private routes: MockRoute[];

  constructor(options: MockAPIServerOptions) {
    this.options = options;
    this.routes = options.routes ?? [];
  }

  /**
   * Start the mock API server
   */
  async start(): Promise<MockAPIServerInfo> {
    if (this.server) {
      throw new Error('Mock API server is already running');
    }

    const port = this.options.port ?? 0; // 0 = random available port

    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleRequest.bind(this));

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

        this._info = {
          baseUrl: `http://localhost:${actualPort}`,
          port: actualPort,
          specUrl: `http://localhost:${actualPort}/openapi.json`,
        };

        this.log(`Mock API server started at ${this._info.baseUrl}`);
        resolve(this._info);
      });
    });
  }

  /**
   * Stop the mock API server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this._info = null;
          this.log('Mock API server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get server info
   */
  get info(): MockAPIServerInfo {
    if (!this._info) {
      throw new Error('Mock API server is not running');
    }
    return this._info;
  }

  /**
   * Add a route dynamically
   */
  addRoute(route: MockRoute): void {
    this.routes.push(route);
  }

  /**
   * Clear all routes
   */
  clearRoutes(): void {
    this.routes = [];
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();
    this.log(`${method} ${url}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Serve OpenAPI spec
      if (url === '/openapi.json' || url === '/openapi.yaml') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.options.openApiSpec));
        this.log('Served OpenAPI spec');
        return;
      }

      // Find matching route
      const route = this.findRoute(method, url);
      if (route) {
        const status = route.response.status ?? 200;
        const headers = {
          'Content-Type': 'application/json',
          ...route.response.headers,
        };
        res.writeHead(status, headers);
        res.end(JSON.stringify(route.response.body));
        this.log(`Matched route: ${method} ${route.path} -> ${status}`);
        return;
      }

      // No matching route
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: `No mock for ${method} ${url}` }));
    } catch (error) {
      this.log(`Error handling request: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', message: 'Internal server error' }));
    }
  }

  private findRoute(method: string, url: string): MockRoute | undefined {
    // Strip query string
    const path = url.split('?')[0];

    return this.routes.find((route) => {
      if (route.method !== method) return false;

      // Simple path matching (exact match or path params)
      if (route.path === path) return true;

      // Handle path parameters like /products/:id
      const routeParts = route.path.split('/');
      const urlParts = path.split('/');

      if (routeParts.length !== urlParts.length) return false;

      return routeParts.every((part, i) => {
        if (part.startsWith(':')) return true; // Path parameter
        return part === urlParts[i];
      });
    });
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[MockAPIServer] ${message}`);
    }
  }
}
