/**
 * Lightweight MCP JSON-RPC client helpers for E2E testing.
 *
 * Supports both TCP (for serve/server-bundle tests) and Unix socket (for daemon tests).
 * Adapted from demo-e2e-unix-socket/e2e/helpers/unix-socket-client.ts.
 */

import * as http from 'node:http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HttpRequestOptions {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcNotification = Omit<JsonRpcRequest, 'id'>;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

/** Send an HTTP request to a TCP port. */
export function httpRequest(port: number, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  const { method = 'GET', path = '/', headers = {}, body } = options;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  const reqHeaders: Record<string, string> = { ...headers };
  if (payload) {
    reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
    reqHeaders['content-length'] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers: reqHeaders }, (res) => {
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
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Send an HTTP request over a Unix socket. */
export function httpOverSocket(socketPath: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  const { method = 'GET', path = '/', headers = {}, body } = options;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  const reqHeaders: Record<string, string> = { ...headers };
  if (payload) {
    reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
    reqHeaders['content-length'] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path, headers: reqHeaders }, (res) => {
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
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Waiters ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for a TCP port to respond to a health check. */
export async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(port, { path: '/health' });
      if (res.statusCode === 200) return;
    } catch {
      // Connection refused — not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server not ready on port ${port} within ${timeoutMs}ms`);
}

/** Wait for a Unix socket to respond to a health check. */
export async function waitForSocket(socketPath: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  const fs = await import('node:fs');
  while (Date.now() - start < timeoutMs) {
    if (!fs.existsSync(socketPath)) {
      await sleep(100);
      continue;
    }
    try {
      const res = await httpOverSocket(socketPath, { path: '/health' });
      if (res.statusCode === 200) return;
    } catch {
      // Connection refused — not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server not ready on socket ${socketPath} within ${timeoutMs}ms`);
}

// ─── SSE Parser ──────────────────────────────────────────────────────────────

function parseJsonRpcFromSse(sseBody: string): JsonRpcResponse | null {
  const lines = sseBody.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data) {
        try {
          return JSON.parse(data) as JsonRpcResponse;
        } catch {
          // Skip non-JSON
        }
      }
    }
  }
  return null;
}

// ─── MCP JSON-RPC Client ────────────────────────────────────────────────────

type SendFn = (options: HttpRequestOptions) => Promise<HttpResponse>;

/**
 * MCP JSON-RPC client that works over both TCP and Unix sockets.
 * Handles session ID tracking and SSE response parsing.
 */
export class McpJsonRpcClient {
  private nextId = 1;
  private sessionId: string | undefined;

  constructor(
    private readonly send: SendFn,
    private readonly mcpPath = '/mcp',
  ) {}

  /** Create a client for a TCP port. */
  static forPort(port: number, mcpPath = '/mcp'): McpJsonRpcClient {
    return new McpJsonRpcClient((opts) => httpRequest(port, opts), mcpPath);
  }

  /** Create a client for a Unix socket. */
  static forSocket(socketPath: string, mcpPath = '/mcp'): McpJsonRpcClient {
    return new McpJsonRpcClient((opts) => httpOverSocket(socketPath, opts), mcpPath);
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Perform MCP initialize handshake. */
  async initialize(): Promise<JsonRpcResponse> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'cli-e2e-client', version: '1.0.0' },
    });

    // Send initialized notification
    await this.notify('notifications/initialized', {});

    return result;
  }

  async listTools(): Promise<JsonRpcResponse> {
    return this.request('tools/list', {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcResponse> {
    return this.request('tools/call', { name, arguments: args });
  }

  async listResources(): Promise<JsonRpcResponse> {
    return this.request('resources/list', {});
  }

  async readResource(uri: string): Promise<JsonRpcResponse> {
    return this.request('resources/read', { uri });
  }

  async listPrompts(): Promise<JsonRpcResponse> {
    return this.request('prompts/list', {});
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<JsonRpcResponse> {
    return this.request('prompts/get', { name, arguments: args ?? {} });
  }

  /** Send a JSON-RPC request and return the response. */
  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const rpcRequest: JsonRpcRequest = { jsonrpc: '2.0', id, method, params: params ?? {} };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await this.send({
      method: 'POST',
      path: this.mcpPath,
      headers,
      body: rpcRequest,
    });

    // Track session ID
    const newSessionId = response.headers['mcp-session-id'];
    if (typeof newSessionId === 'string') {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers['content-type'] ?? '';
    if (contentType.includes('text/event-stream')) {
      const parsed = parseJsonRpcFromSse(response.body);
      if (!parsed) {
        throw new Error(`Failed to parse JSON-RPC from SSE: ${response.body.slice(0, 200)}`);
      }
      return parsed;
    }

    return JSON.parse(response.body) as JsonRpcResponse;
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const rpcNotification: JsonRpcNotification = { jsonrpc: '2.0', method, params: params ?? {} };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    await this.send({
      method: 'POST',
      path: this.mcpPath,
      headers,
      body: rpcNotification,
    });
  }
}
