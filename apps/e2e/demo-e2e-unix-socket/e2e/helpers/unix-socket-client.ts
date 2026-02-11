/**
 * Unix Socket MCP Client Helper
 *
 * Provides low-level HTTP-over-Unix-socket transport and a higher-level
 * MCP JSON-RPC client for E2E testing of Unix socket servers.
 */

import * as http from 'node:http';

// ─── Low-level HTTP over Unix Socket ───────────────────────────────────────────

export interface HttpOverSocketOptions {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpOverSocketResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Send a single HTTP request over a Unix socket.
 * Returns the raw response with status, headers, and body.
 */
export function httpOverSocket(
  socketPath: string,
  options: HttpOverSocketOptions = {},
): Promise<HttpOverSocketResponse> {
  const { method = 'GET', path = '/', headers = {}, body } = options;

  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    const reqHeaders: Record<string, string> = { ...headers };
    if (payload) {
      reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
      reqHeaders['content-length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        socketPath,
        method,
        path,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── MCP JSON-RPC Client over Unix Socket ──────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Extract JSON-RPC response from an SSE body.
 * SSE format: lines of "event: message\ndata: {...}\n\n"
 */
function parseJsonRpcFromSse(sseBody: string): JsonRpcResponse | null {
  const lines = sseBody.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data) {
        try {
          return JSON.parse(data) as JsonRpcResponse;
        } catch {
          // Skip non-JSON data lines
        }
      }
    }
  }
  return null;
}

/**
 * MCP client that communicates over Unix sockets using Streamable HTTP transport.
 *
 * Handles:
 * - JSON-RPC 2.0 protocol
 * - SSE response parsing
 * - Session ID tracking via `mcp-session-id` header
 */
export class UnixSocketMcpClient {
  private nextId = 1;
  private sessionId: string | undefined;

  constructor(private readonly socketPath: string) {}

  /**
   * Perform the MCP initialization handshake.
   * Sends `initialize` request + `notifications/initialized` notification.
   */
  async initialize(): Promise<JsonRpcResponse> {
    const initResult = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'unix-socket-e2e-client', version: '1.0.0' },
    });

    // Send initialized notification
    await this.notify('notifications/initialized', {});

    return initResult;
  }

  /**
   * Send a JSON-RPC request and return the response.
   * Handles both JSON and SSE response content types.
   */
  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await httpOverSocket(this.socketPath, {
      method: 'POST',
      path: '/',
      headers,
      body: rpcRequest,
    });

    // Track session ID from response
    const newSessionId = response.headers['mcp-session-id'];
    if (typeof newSessionId === 'string') {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers['content-type'] ?? '';

    if (contentType.includes('text/event-stream')) {
      const parsed = parseJsonRpcFromSse(response.body);
      if (!parsed) {
        throw new Error(`Failed to parse JSON-RPC from SSE response: ${response.body.slice(0, 200)}`);
      }
      return parsed;
    }

    // JSON response
    return JSON.parse(response.body) as JsonRpcResponse;
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const rpcNotification: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params: params ?? {},
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    await httpOverSocket(this.socketPath, {
      method: 'POST',
      path: '/',
      headers,
      body: rpcNotification,
    });
  }

  /**
   * Returns the current session ID (assigned by the server during initialization).
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }
}
