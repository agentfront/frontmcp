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

/**
 * Mock request object for handlers
 */
export interface MockRequest {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Request headers (lowercase keys) */
  headers: Record<string, string | undefined>;
  /** Path parameters extracted from the route */
  params: Record<string, string>;
  /** Query parameters */
  query: Record<string, string>;
  /** Request body (parsed JSON if applicable) */
  body?: unknown;
}

/**
 * Mock response helper for handlers
 */
export interface MockResponseHelper {
  /** Send a JSON response */
  json: (body: unknown, status?: number) => void;
  /** Send a response with custom headers */
  send: (body: unknown, status?: number, headers?: Record<string, string>) => void;
}

/**
 * Handler function type for dynamic route handling
 */
export type MockRouteHandler = (req: MockRequest, res: MockResponseHelper) => void | Promise<void>;

export interface MockRoute {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Path to match (e.g., '/products', '/products/:id') */
  path: string;
  /** Static response to return (mutually exclusive with handler) */
  response?: MockResponse;
  /** Dynamic handler function (mutually exclusive with response) */
  handler?: MockRouteHandler;
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
    for (const route of this.routes) {
      this.validateRoute(route);
    }
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
    this.validateRoute(route);
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

  private validateRoute(route: MockRoute): void {
    if (route.handler && route.response) {
      throw new Error(`Mock route ${route.method} ${route.path} must define either 'handler' or 'response', not both`);
    }
    if (!route.handler && !route.response) {
      throw new Error(`Mock route ${route.method} ${route.path} must define either 'handler' or 'response'`);
    }
  }

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
      const matchResult = this.findRoute(method, url);
      if (matchResult) {
        const { route, params } = matchResult;

        // Handle dynamic handler
        if (route.handler) {
          // Parse request body for POST/PUT/PATCH
          let body: unknown;
          if (['POST', 'PUT', 'PATCH'].includes(method)) {
            body = await this.parseBody(req);
          }

          // Parse query parameters
          const queryString = url.includes('?') ? url.split('?')[1] : '';
          const query: Record<string, string> = {};
          if (queryString) {
            const searchParams = new URLSearchParams(queryString);
            searchParams.forEach((value, key) => {
              query[key] = value;
            });
          }

          // Create request object
          const mockReq: MockRequest = {
            url,
            method,
            headers: this.normalizeHeaders(req.headers as Record<string, string | string[] | undefined>),
            params,
            query,
            body,
          };

          // Create response helper
          const mockRes: MockResponseHelper = {
            json: (responseBody: unknown, status = 200) => {
              res.writeHead(status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(responseBody));
            },
            send: (responseBody: unknown, status = 200, headers = {}) => {
              res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
              res.end(JSON.stringify(responseBody));
            },
          };

          await route.handler(mockReq, mockRes);
          this.log(`Matched route with handler: ${method} ${route.path}`);
          return;
        }

        // Handle static response
        if (route.response) {
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

  private findRoute(method: string, url: string): { route: MockRoute; params: Record<string, string> } | undefined {
    // Strip query string
    const path = url.split('?')[0];

    for (const route of this.routes) {
      if (route.method !== method) continue;

      // Simple path matching (exact match)
      if (route.path === path) {
        return { route, params: {} };
      }

      // Handle path parameters like /products/:id
      const routeParts = route.path.split('/');
      const urlParts = path.split('/');

      if (routeParts.length !== urlParts.length) continue;

      const params: Record<string, string> = {};
      let match = true;

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          // Extract path parameter
          params[routeParts[i].slice(1)] = urlParts[i];
        } else if (routeParts[i] !== urlParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        return { route, params };
      }
    }

    return undefined;
  }

  /**
   * Parse request body as JSON
   */
  private async parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      const onData = (chunk: Buffer) => {
        body += chunk.toString();
      };
      const cleanup = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
      };
      const onEnd = () => {
        cleanup();
        try {
          resolve(body ? JSON.parse(body) : undefined);
        } catch {
          resolve(body);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      req.on('data', onData);
      req.once('end', onEnd);
      req.once('error', onError);
    });
  }

  /**
   * Normalize headers to lowercase keys
   */
  private normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
    const normalized: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }
    return normalized;
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[MockAPIServer] ${message}`);
    }
  }
}
