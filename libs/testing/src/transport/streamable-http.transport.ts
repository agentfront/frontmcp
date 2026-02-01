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
import type { ClientInfo, ElicitationHandler, ElicitationCreateRequest } from '../client/mcp-test-client.types';

const DEFAULT_TIMEOUT = 30000;

/**
 * StreamableHTTP transport for MCP communication
 *
 * This transport uses HTTP POST requests for all communication,
 * following the MCP StreamableHTTP specification.
 */
export class StreamableHttpTransport implements McpTransport {
  private readonly config: Required<Omit<TransportConfig, 'interceptors' | 'clientInfo' | 'elicitationHandler'>> & {
    interceptors?: InterceptorChain;
    clientInfo?: ClientInfo;
  };
  private state: TransportState = 'disconnected';
  private sessionId: string | undefined;
  private authToken: string | undefined;
  private connectionCount = 0;
  private reconnectCount = 0;
  private lastRequestHeaders: Record<string, string> = {};
  private interceptors?: InterceptorChain;
  private readonly publicMode: boolean;
  private elicitationHandler?: ElicitationHandler;

  constructor(config: TransportConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      auth: config.auth ?? {},
      publicMode: config.publicMode ?? false,
      debug: config.debug ?? false,
      interceptors: config.interceptors,
      clientInfo: config.clientInfo,
    };

    this.authToken = config.auth?.token;
    this.interceptors = config.interceptors;
    this.publicMode = config.publicMode ?? false;
    this.elicitationHandler = config.elicitationHandler;
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.connectionCount++;

    try {
      // Public mode: Skip all authentication - connect without any token
      if (this.publicMode) {
        this.log('Public mode: connecting without authentication');
        this.state = 'connected';
        return;
      }

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

      // NOTE: Don't clear timeout here - keep it active for SSE reading
      // The timeout will be cleared after all processing (including SSE) is complete

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

        // Handle empty response (for notifications)
        if (contentType.includes('text/event-stream')) {
          // Handle SSE response with elicitation support
          jsonResponse = await this.handleSSEResponseWithElicitation(response, message);
        } else {
          const text = await response.text();
          this.log('Response:', text);

          if (!text.trim()) {
            jsonResponse = {
              jsonrpc: '2.0',
              id: message.id ?? null,
              result: undefined,
            };
          } else {
            jsonResponse = JSON.parse(text) as JsonRpcResponse;
          }
        }
      }

      // Process response through interceptors
      if (this.interceptors) {
        jsonResponse = await this.interceptors.processResponse(message, jsonResponse, Date.now() - startTime);
      }

      // Clear timeout after all processing (including SSE) is complete
      clearTimeout(timeoutId);
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

  setElicitationHandler(handler: ElicitationHandler | undefined): void {
    this.elicitationHandler = handler;
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

  /**
   * Handle SSE response with elicitation support.
   *
   * Streams the SSE response, detects elicitation/create requests, and handles them
   * by calling the registered handler and sending the response back to the server.
   */
  private async handleSSEResponseWithElicitation(
    response: Response,
    originalRequest: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    this.log('handleSSEResponseWithElicitation: starting', { requestId: originalRequest.id });
    const reader = response.body?.getReader();
    if (!reader) {
      this.log('handleSSEResponseWithElicitation: no response body');
      return {
        jsonrpc: '2.0',
        id: originalRequest.id ?? null,
        error: { code: -32000, message: 'No response body' },
      };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResponse: JsonRpcResponse | null = null;
    let sseSessionId: string | undefined;

    try {
      let readCount = 0;
      while (true) {
        readCount++;
        this.log(`handleSSEResponseWithElicitation: reading chunk ${readCount}`);
        const { done, value } = await reader.read();
        this.log(`handleSSEResponseWithElicitation: read result`, { done, valueLength: value?.length });

        if (done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            const parsed = this.parseSSEEvents(buffer, originalRequest.id);
            for (const event of parsed.events) {
              const handled = await this.handleSSEEvent(event);
              if (handled.isFinal) {
                finalResponse = handled.response;
              }
            }
            if (parsed.sessionId && !sseSessionId) {
              sseSessionId = parsed.sessionId;
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events from buffer
        const eventEndPattern = /\n\n/g;
        let lastEventEnd = 0;
        let match;

        while ((match = eventEndPattern.exec(buffer)) !== null) {
          const eventText = buffer.slice(lastEventEnd, match.index);
          lastEventEnd = match.index + 2; // Skip the \n\n

          if (eventText.trim()) {
            const parsed = this.parseSSEEvents(eventText, originalRequest.id);
            for (const event of parsed.events) {
              const handled = await this.handleSSEEvent(event);
              if (handled.isFinal) {
                finalResponse = handled.response;
              }
            }
            if (parsed.sessionId && !sseSessionId) {
              sseSessionId = parsed.sessionId;
            }
          }
        }

        // Keep unprocessed data in buffer
        buffer = buffer.slice(lastEventEnd);
      }
    } finally {
      reader.releaseLock();
    }

    // Store session ID
    if (sseSessionId && !this.sessionId) {
      this.sessionId = sseSessionId;
      this.log('Session ID from SSE:', this.sessionId);
    }

    // Return final response or error
    if (finalResponse) {
      return finalResponse;
    }

    return {
      jsonrpc: '2.0',
      id: originalRequest.id ?? null,
      error: { code: -32000, message: 'No final response received in SSE stream' },
    };
  }

  /**
   * Parse SSE event text into structured events
   */
  private parseSSEEvents(
    text: string,
    _requestId: string | number | undefined,
  ): { events: Array<{ type: string; data: string; id?: string }>; sessionId?: string } {
    const lines = text.split('\n');
    const events: Array<{ type: string; data: string; id?: string }> = [];
    let currentEvent: { type: string; data: string[]; id?: string } = { type: 'message', data: [] };
    let sessionId: string | undefined;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent.type = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentEvent.data.push(line.slice(6));
      } else if (line === 'data:') {
        currentEvent.data.push('');
      } else if (line.startsWith('id: ')) {
        const idValue = line.slice(4);
        currentEvent.id = idValue;
        // Extract session ID (format: sessionId:messageId)
        const colonIndex = idValue.lastIndexOf(':');
        if (colonIndex > 0) {
          sessionId = idValue.substring(0, colonIndex);
        } else {
          sessionId = idValue;
        }
      } else if (line === '' && currentEvent.data.length > 0) {
        // Empty line marks end of event
        events.push({
          type: currentEvent.type,
          data: currentEvent.data.join('\n'),
          id: currentEvent.id,
        });
        currentEvent = { type: 'message', data: [] };
      }
    }

    // Handle event without trailing newline
    if (currentEvent.data.length > 0) {
      events.push({
        type: currentEvent.type,
        data: currentEvent.data.join('\n'),
        id: currentEvent.id,
      });
    }

    return { events, sessionId };
  }

  /**
   * Handle a single SSE event, including elicitation requests
   */
  private async handleSSEEvent(event: {
    type: string;
    data: string;
    id?: string;
  }): Promise<{ isFinal: boolean; response: JsonRpcResponse }> {
    this.log('SSE Event:', { type: event.type, data: event.data.slice(0, 200) });

    try {
      const parsed = JSON.parse(event.data) as JsonRpcResponse | JsonRpcRequest;

      // Check if this is an elicitation/create request (server→client)
      if ('method' in parsed && parsed.method === 'elicitation/create') {
        await this.handleElicitationRequest(parsed as JsonRpcRequest);
        // This is not the final response - continue reading
        return {
          isFinal: false,
          response: { jsonrpc: '2.0', id: null, result: undefined },
        };
      }

      // This is a regular response - check if it's the final one
      if ('result' in parsed || 'error' in parsed) {
        return { isFinal: true, response: parsed as JsonRpcResponse };
      }

      // Unknown message type - not final
      return {
        isFinal: false,
        response: { jsonrpc: '2.0', id: null, result: undefined },
      };
    } catch {
      this.log('Failed to parse SSE event data:', event.data);
      return {
        isFinal: false,
        response: { jsonrpc: '2.0', id: null, result: undefined },
      };
    }
  }

  /**
   * Handle an elicitation/create request from the server
   */
  private async handleElicitationRequest(request: JsonRpcRequest): Promise<void> {
    const params = request.params as unknown as ElicitationCreateRequest;
    this.log('Elicitation request received:', {
      mode: params?.mode,
      message: params?.message?.slice(0, 100),
    });

    const requestId = request.id;
    if (requestId === undefined || requestId === null) {
      this.log('Elicitation request has no ID, cannot respond');
      return;
    }

    if (!this.elicitationHandler) {
      // No handler registered - send error response
      this.log('No elicitation handler registered, sending error');
      await this.sendElicitationResponse(requestId, {
        action: 'decline',
      });
      return;
    }

    try {
      // Call the handler
      const response = await this.elicitationHandler(params);
      this.log('Elicitation handler response:', response);

      // Send the response back to the server
      await this.sendElicitationResponse(requestId, response);
    } catch (error) {
      this.log('Elicitation handler error:', error);
      await this.sendElicitationResponse(requestId, {
        action: 'cancel',
      });
    }
  }

  /**
   * Send an elicitation response back to the server
   */
  private async sendElicitationResponse(
    requestId: string | number,
    response: { action: 'accept' | 'cancel' | 'decline'; content?: Record<string, unknown> },
  ): Promise<void> {
    const headers = this.buildHeaders();
    const url = `${this.config.baseUrl}/`;

    const rpcResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: requestId,
      result: response,
    };

    this.log('Sending elicitation response:', rpcResponse);

    try {
      const fetchResponse = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(rpcResponse),
      });

      if (!fetchResponse.ok) {
        this.log(`Elicitation response HTTP error: ${fetchResponse.status}`);
      }
    } catch (error) {
      this.log('Failed to send elicitation response:', error);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Add User-Agent header based on clientInfo for platform detection
    // Server uses this to detect the AI platform before MCP initialize
    if (this.config.clientInfo) {
      headers['User-Agent'] = `${this.config.clientInfo.name}/${this.config.clientInfo.version}`;
    }

    // Only add Authorization header if we have a token AND not in public mode
    // Public mode explicitly skips auth headers for CI/CD and public docs testing
    if (this.authToken && !this.publicMode) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    // Always send session ID if we have one (even in public mode - server creates sessions)
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    // Add custom headers from config (allow override even in public mode)
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
   * Parse SSE (Server-Sent Events) response format with session ID extraction
   * SSE format is:
   * event: message
   * id: sessionId:messageId
   * data: {"jsonrpc":"2.0",...}
   *
   * The id field contains the session ID followed by a colon and the message ID.
   *
   * @param text - The raw SSE response text
   * @param requestId - The original request ID
   * @returns Object with parsed JSON-RPC response and session ID (if found)
   */
  private parseSSEResponseWithSession(
    text: string,
    requestId: string | number | undefined,
  ): { response: JsonRpcResponse; sseSessionId?: string } {
    const lines = text.split('\n');
    const dataLines: string[] = [];
    let sseSessionId: string | undefined;

    // Collect all data lines and extract session ID from id: field
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6)); // Remove 'data: ' prefix
      } else if (line === 'data:') {
        // Empty data line represents a newline in the data
        dataLines.push('');
      } else if (line.startsWith('id: ')) {
        // Extract session ID from id field (format: sessionId:messageId)
        const idValue = line.slice(4);
        const colonIndex = idValue.lastIndexOf(':');
        if (colonIndex > 0) {
          sseSessionId = idValue.substring(0, colonIndex);
        } else {
          // No colon, use the whole id as session ID
          sseSessionId = idValue;
        }
      }
    }

    if (dataLines.length > 0) {
      const jsonData = dataLines.join('\n');
      try {
        return {
          response: JSON.parse(jsonData) as JsonRpcResponse,
          sseSessionId,
        };
      } catch {
        this.log('Failed to parse SSE data as JSON:', jsonData);
      }
    }

    // Fallback: return error response
    return {
      response: {
        jsonrpc: '2.0',
        id: requestId ?? null,
        error: {
          code: -32700,
          message: 'Failed to parse SSE response',
          data: text,
        },
      },
      sseSessionId,
    };
  }
}
