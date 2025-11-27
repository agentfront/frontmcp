/**
 * @file streamable-http.transport.ts
 * @description StreamableHTTP transport implementation for MCP Test Client
 */

import type {
  McpTransport,
  TransportConfig,
  TransportState,
  JsonRpcRequest,
  JsonRpcResponse,
} from './transport.interface';
import type { InterceptorChain } from '../interceptor';

const DEFAULT_TIMEOUT = 30000;

/**
 * StreamableHTTP transport for MCP communication
 *
 * This transport uses HTTP POST requests for all communication,
 * following the MCP StreamableHTTP specification.
 */
export class StreamableHttpTransport implements McpTransport {
  private readonly config: Required<Omit<TransportConfig, 'interceptors'>> & { interceptors?: InterceptorChain };
  private state: TransportState = 'disconnected';
  private sessionId: string | undefined;
  private authToken: string | undefined;
  private connectionCount = 0;
  private reconnectCount = 0;
  private lastRequestHeaders: Record<string, string> = {};
  private interceptors?: InterceptorChain;

  constructor(config: TransportConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      auth: config.auth ?? {},
      debug: config.debug ?? false,
      interceptors: config.interceptors,
    };

    this.authToken = config.auth?.token;
    this.interceptors = config.interceptors;
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.connectionCount++;

    try {
      // If no auth token provided, request anonymous token from FrontMCP SDK
      if (!this.authToken) {
        await this.requestAnonymousToken();
      }

      // StreamableHTTP doesn't require an explicit connection step
      // The session is established on the first request
      this.state = 'connected';
      this.log('Connected to StreamableHTTP transport');
    } catch (error) {
      this.state = 'error';
      throw error;
    }
  }

  /**
   * Request an anonymous token from the FrontMCP OAuth endpoint
   * This allows the test client to authenticate without user interaction
   */
  private async requestAnonymousToken(): Promise<void> {
    const clientId = crypto.randomUUID();
    const tokenUrl = `${this.config.baseUrl}/oauth/token`;

    this.log(`Requesting anonymous token from ${tokenUrl}`);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'anonymous',
          client_id: clientId,
          resource: this.config.baseUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`Failed to get anonymous token: ${response.status} ${errorText}`);
        // Continue without token - server may allow unauthenticated access
        return;
      }

      const tokenResponse = await response.json();
      if (tokenResponse.access_token) {
        this.authToken = tokenResponse.access_token;
        this.log('Anonymous token acquired successfully');
      }
    } catch (error) {
      this.log(`Error requesting anonymous token: ${error}`);
      // Continue without token - server may allow unauthenticated access
    }
  }

  async request<T = unknown>(message: JsonRpcRequest): Promise<JsonRpcResponse & { result?: T }> {
    this.ensureConnected();

    const startTime = Date.now();

    // Process through interceptors if available
    if (this.interceptors) {
      const interceptResult = await this.interceptors.processRequest(message, {
        timestamp: new Date(),
        transport: 'streamable-http',
        sessionId: this.sessionId,
      });

      switch (interceptResult.type) {
        case 'mock': {
          // Return mock response directly, run through response interceptors
          const mockResponse = await this.interceptors.processResponse(
            message,
            interceptResult.response,
            Date.now() - startTime,
          );
          return mockResponse as JsonRpcResponse & { result?: T };
        }

        case 'error':
          throw interceptResult.error;

        case 'continue':
          // Use possibly modified request
          message = interceptResult.request;
          break;
      }
    }

    const headers = this.buildHeaders();
    this.lastRequestHeaders = headers;

    const url = `${this.config.baseUrl}/`;
    this.log(`POST ${url}`, message);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for session ID in response headers
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      let jsonResponse: JsonRpcResponse;

      if (!response.ok) {
        // Handle HTTP errors
        const errorText = await response.text();
        this.log(`HTTP Error ${response.status}: ${errorText}`);

        jsonResponse = {
          jsonrpc: '2.0',
          id: message.id ?? null,
          error: {
            code: -32000,
            message: `HTTP ${response.status}: ${response.statusText}`,
            data: errorText,
          },
        };
      } else {
        // Parse response - may be JSON or SSE
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        this.log('Response:', text);

        // Handle empty response (for notifications)
        if (!text.trim()) {
          jsonResponse = {
            jsonrpc: '2.0',
            id: message.id ?? null,
            result: undefined,
          };
        } else if (contentType.includes('text/event-stream')) {
          // Parse SSE response - extract data from event stream
          jsonResponse = this.parseSSEResponse(text, message.id);
        } else {
          jsonResponse = JSON.parse(text) as JsonRpcResponse;
        }
      }

      // Process response through interceptors
      if (this.interceptors) {
        jsonResponse = await this.interceptors.processResponse(message, jsonResponse, Date.now() - startTime);
      }

      return jsonResponse as JsonRpcResponse & { result?: T };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          jsonrpc: '2.0',
          id: message.id ?? null,
          error: {
            code: -32000,
            message: `Request timeout after ${this.config.timeout}ms`,
          },
        };
      }

      throw error;
    }
  }

  async notify(message: JsonRpcRequest): Promise<void> {
    this.ensureConnected();

    const headers = this.buildHeaders();
    this.lastRequestHeaders = headers;

    const url = `${this.config.baseUrl}/`;
    this.log(`POST ${url} (notification)`, message);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update session ID if present
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`HTTP Error ${response.status} on notification: ${errorText}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name !== 'AbortError') {
        throw error;
      }
    }
  }

  async sendRaw(data: string): Promise<JsonRpcResponse> {
    this.ensureConnected();

    const headers = this.buildHeaders();
    this.lastRequestHeaders = headers;

    const url = `${this.config.baseUrl}/`;
    this.log(`POST ${url} (raw)`, data);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: data,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await response.text();

      if (!text.trim()) {
        return {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        };
      }

      return JSON.parse(text) as JsonRpcResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  async close(): Promise<void> {
    this.state = 'disconnected';
    this.sessionId = undefined;
    this.log('StreamableHTTP transport closed');
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  getState(): TransportState {
    return this.state;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  setTimeout(ms: number): void {
    this.config.timeout = ms;
  }

  setInterceptors(interceptors: InterceptorChain): void {
    this.interceptors = interceptors;
  }

  getInterceptors(): InterceptorChain | undefined {
    return this.interceptors;
  }

  getConnectionCount(): number {
    return this.connectionCount;
  }

  getReconnectCount(): number {
    return this.reconnectCount;
  }

  getLastRequestHeaders(): Record<string, string> {
    return { ...this.lastRequestHeaders };
  }

  async simulateDisconnect(): Promise<void> {
    this.state = 'disconnected';
    this.sessionId = undefined;
  }

  async waitForReconnect(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    // Auto-reconnect
    this.reconnectCount++;
    await this.connect();

    while (Date.now() < deadline) {
      if (this.state === 'connected') {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    throw new Error('Timeout waiting for reconnection');
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Add auth token
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    // Add session ID
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    // Add custom headers from config
    if (this.config.auth.headers) {
      Object.assign(headers, this.config.auth.headers);
    }

    return headers;
  }

  private ensureConnected(): void {
    if (this.state !== 'connected') {
      throw new Error('Transport not connected. Call connect() first.');
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[StreamableHTTP] ${message}`, data ?? '');
    }
  }

  /**
   * Parse SSE (Server-Sent Events) response format
   * SSE format is:
   * event: message
   * id: xxx
   * data: {"jsonrpc":"2.0",...}
   *
   * Multi-line data is supported per SSE spec - each line prefixed with "data: "
   * gets concatenated with newlines.
   *
   * @param text - The raw SSE response text
   * @param requestId - The original request ID
   * @returns Parsed JSON-RPC response
   */
  private parseSSEResponse(text: string, requestId: string | number | undefined): JsonRpcResponse {
    const lines = text.split('\n');
    const dataLines: string[] = [];

    // Collect all data lines - SSE spec concatenates multi-line data with newlines
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6)); // Remove 'data: ' prefix
      } else if (line === 'data:') {
        // Empty data line represents a newline in the data
        dataLines.push('');
      }
    }

    if (dataLines.length > 0) {
      const jsonData = dataLines.join('\n');
      try {
        return JSON.parse(jsonData) as JsonRpcResponse;
      } catch {
        this.log('Failed to parse SSE data as JSON:', jsonData);
      }
    }

    // Fallback: return error response
    return {
      jsonrpc: '2.0',
      id: requestId ?? null,
      error: {
        code: -32700,
        message: 'Failed to parse SSE response',
        data: text,
      },
    };
  }
}
