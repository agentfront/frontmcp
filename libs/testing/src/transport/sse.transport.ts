/**
 * @file sse.transport.ts
 * @description Legacy HTTP+SSE transport (MCP 2024-11-05) for the MCP Test Client
 *
 * The client opens a long-lived `GET <entry>/sse` stream. The server's first event, `endpoint`,
 * names the URL to POST JSON-RPC messages to (`<entry>/message?sessionId=…`). Every POST is
 * answered `202 Accepted`; the JSON-RPC response arrives later as a `message` event on the
 * stream, as do notifications and server→client requests (e.g. `elicitation/create`).
 */

import type { ClientInfo, ElicitationCreateRequest, ElicitationHandler } from '../client/mcp-test-client.types';
import type { InterceptorChain } from '../interceptor';
import { errorMessage, isAbortError, markInterceptedError } from './error-utils';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpTransport,
  NotificationHandler,
  TransportConfig,
  TransportState,
} from './transport.interface';

const DEFAULT_TIMEOUT = 30000;

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SseEvent {
  type: string;
  data: string;
}

/**
 * Legacy HTTP+SSE transport.
 *
 * Needs a server that serves the legacy SSE endpoints (`transport.protocol` with `legacy: true`,
 * or `sse: true`). Requests are correlated with their responses by JSON-RPC id.
 */
export class SseTransport implements McpTransport {
  private readonly baseUrl: string;
  private readonly entryPath?: string;
  private timeout: number;
  private readonly authHeaders: Record<string, string>;
  private readonly publicMode: boolean;
  private readonly debug: boolean;
  private readonly clientInfo?: ClientInfo;
  private readonly notificationHandler?: NotificationHandler;
  private interceptors?: InterceptorChain;
  private elicitationHandler?: ElicitationHandler;

  private state: TransportState = 'disconnected';
  private authToken: string | undefined;
  private sessionId: string | undefined;
  private messageEndpoint: string | undefined;
  private stream: AbortController | undefined;
  private readonly pending = new Map<string | number, PendingRequest>();
  private connectionCount = 0;
  private reconnectCount = 0;
  private lastRequestHeaders: Record<string, string> = {};

  constructor(config: TransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.entryPath = config.entryPath;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.authHeaders = config.auth?.headers ?? {};
    this.authToken = config.auth?.token;
    this.publicMode = config.publicMode ?? false;
    this.debug = config.debug ?? false;
    this.clientInfo = config.clientInfo;
    this.notificationHandler = config.notificationHandler;
    this.interceptors = config.interceptors;
    this.elicitationHandler = config.elicitationHandler;
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.connectionCount++;
    try {
      if (!this.publicMode && !this.authToken) {
        await this.requestAnonymousToken();
      }
      await this.openStream();
      this.state = 'connected';
      this.log(`Connected; messages go to ${this.messageEndpoint}`);
    } catch (error) {
      this.state = 'error';
      this.stream?.abort();
      this.stream = undefined;
      throw error;
    }
  }

  async request<T = unknown>(message: JsonRpcRequest): Promise<JsonRpcResponse & { result?: T }> {
    this.ensureConnected();
    const startTime = Date.now();

    if (this.interceptors) {
      const intercepted = await this.interceptors.processRequest(message, {
        timestamp: new Date(),
        transport: 'sse',
        sessionId: this.sessionId,
      });
      switch (intercepted.type) {
        case 'mock':
          return (await this.interceptors.processResponse(
            message,
            intercepted.response,
            Date.now() - startTime,
          )) as JsonRpcResponse & { result?: T };
        case 'error':
          throw markInterceptedError(intercepted.error);
        case 'continue':
          message = intercepted.request;
          break;
      }
    }

    let response: JsonRpcResponse;
    if (message.id === undefined) {
      await this.post(JSON.stringify(message));
      response = { jsonrpc: '2.0', id: null, result: undefined };
    } else {
      response = await this.postAndAwait(message.id, JSON.stringify(message));
    }

    if (this.interceptors) {
      response = await this.interceptors.processResponse(message, response, Date.now() - startTime);
    }
    return response as JsonRpcResponse & { result?: T };
  }

  async notify(message: JsonRpcRequest): Promise<void> {
    this.ensureConnected();
    const result = await this.post(JSON.stringify(message));
    if (!result.ok) this.log(`HTTP ${result.status} on notification: ${result.body}`);
  }

  async sendRaw(data: string): Promise<JsonRpcResponse> {
    this.ensureConnected();
    let id: string | number | undefined;
    try {
      const parsed = JSON.parse(data) as { id?: unknown };
      if (typeof parsed.id === 'string' || typeof parsed.id === 'number') id = parsed.id;
    } catch {
      // Not JSON: the server rejects the POST itself, handled below
    }
    if (id !== undefined) return this.postAndAwait(id, data);

    const result = await this.post(data);
    if (!result.ok) {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error', data: result.body } };
    }
    return { jsonrpc: '2.0', id: null, result: undefined };
  }

  async close(): Promise<void> {
    this.closeStream('Transport closed');
    this.state = 'disconnected';
    this.sessionId = undefined;
    this.messageEndpoint = undefined;
    this.log('SSE transport closed');
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
    this.timeout = ms;
  }

  getMessageEndpoint(): string | undefined {
    return this.messageEndpoint;
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

  setInterceptors(interceptors: InterceptorChain): void {
    this.interceptors = interceptors;
  }

  getInterceptors(): InterceptorChain | undefined {
    return this.interceptors;
  }

  setElicitationHandler(handler: ElicitationHandler | undefined): void {
    this.elicitationHandler = handler;
  }

  async simulateDisconnect(): Promise<void> {
    this.closeStream('Simulated disconnect');
    this.state = 'disconnected';
    this.sessionId = undefined;
    this.messageEndpoint = undefined;
  }

  async waitForReconnect(timeoutMs: number): Promise<void> {
    this.reconnectCount++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timeout waiting for reconnection')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STREAM
  // ═══════════════════════════════════════════════════════════════════

  /** Open `GET <entry>/sse` and wait for the `endpoint` event. */
  private async openStream(): Promise<void> {
    const controller = new AbortController();
    this.stream = controller;
    const url = this.sseUrl();
    const { 'Content-Type': _contentType, ...headers } = this.buildHeaders();
    this.log(`GET ${url}`);

    const connectTimer = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(connectTimer);
      throw new Error(
        isAbortError(error)
          ? `SSE connection to ${url} timed out after ${this.timeout}ms`
          : `SSE connection to ${url} failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    const isEventStream = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
    if (!response.ok || !response.body || !isEventStream) {
      clearTimeout(connectTimer);
      const body = await response.text().catch(() => '');
      throw new Error(
        `SSE connection to ${url} failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}. ` +
          `The legacy HTTP+SSE transport needs a server that serves it ` +
          `(@FrontMcp({ transport: { protocol: { legacy: true } } })).`,
      );
    }

    const endpoint = new Promise<string>((resolve, reject) => {
      const reader = response.body?.getReader();
      if (!reader) {
        reject(new Error(`SSE connection to ${url} has no body`));
        return;
      }
      void this.readStream(controller, reader, resolve, reject);
    });
    try {
      const data = await endpoint;
      const messageUrl = new URL(data, url);
      this.messageEndpoint = messageUrl.toString();
      this.sessionId = messageUrl.searchParams.get('sessionId') ?? undefined;
    } finally {
      clearTimeout(connectTimer);
    }
  }

  private async readStream(
    controller: AbortController,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEndpoint: (data: string) => void,
    onEndpointError: (error: Error) => void,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let endpointSeen = false;
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        const { completeEvents, remainder } = splitSSEEvents(buffer + decoder.decode(chunk.value, { stream: true }));
        buffer = remainder;
        for (const text of completeEvents) {
          const event = parseSSEEvent(text);
          if (!event) continue;
          if (event.type === 'endpoint') {
            if (!endpointSeen) {
              endpointSeen = true;
              onEndpoint(event.data);
            }
            continue;
          }
          await this.handleMessage(event.data);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) this.log('SSE stream failed:', error);
    } finally {
      reader.releaseLock();
    }
    if (!endpointSeen) {
      onEndpointError(new Error(`SSE stream at ${this.sseUrl()} ended before the server sent its endpoint`));
    }
    // The server closed the stream: nothing pending can be answered any more
    if (this.stream === controller) {
      this.stream = undefined;
      this.rejectPending('SSE stream closed by the server');
      if (this.state === 'connected') this.state = 'disconnected';
    }
  }

  private async handleMessage(data: string): Promise<void> {
    let message: (JsonRpcResponse & { method?: string; params?: Record<string, unknown> }) | undefined;
    try {
      message = JSON.parse(data);
    } catch {
      this.log('Ignoring SSE event that is not JSON:', data);
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (typeof message.method === 'string') {
      const request = message as unknown as JsonRpcRequest;
      if (request.id === undefined || request.id === null) {
        this.notificationHandler?.(request);
        return;
      }
      await this.answerServerRequest(request);
      return;
    }

    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    }
  }

  /** Server→client requests: elicitation goes to the handler, `ping` is answered, the rest refused. */
  private async answerServerRequest(request: JsonRpcRequest): Promise<void> {
    const id = request.id as string | number;
    let reply: JsonRpcResponse;
    if (request.method === 'elicitation/create') {
      reply = { jsonrpc: '2.0', id, result: await this.elicit(request.params as unknown as ElicitationCreateRequest) };
    } else if (request.method === 'ping') {
      reply = { jsonrpc: '2.0', id, result: {} };
    } else {
      reply = { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
    const result = await this.post(JSON.stringify(reply));
    if (!result.ok) this.log(`HTTP ${result.status} answering ${request.method}: ${result.body}`);
  }

  private async elicit(
    params: ElicitationCreateRequest,
  ): Promise<{ action: 'accept' | 'cancel' | 'decline'; content?: Record<string, unknown> }> {
    if (!this.elicitationHandler) return { action: 'decline' };
    try {
      return await this.elicitationHandler(params);
    } catch (error) {
      this.log('Elicitation handler error:', error);
      return { action: 'cancel' };
    }
  }

  private closeStream(reason: string): void {
    const controller = this.stream;
    this.stream = undefined;
    controller?.abort();
    this.rejectPending(reason);
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ jsonrpc: '2.0', id, error: { code: -32000, message: reason } });
    }
    this.pending.clear();
  }

  // ═══════════════════════════════════════════════════════════════════
  // POSTING
  // ═══════════════════════════════════════════════════════════════════

  /** POST a message and resolve with the response the stream carries for `id`. */
  private async postAndAwait(id: string | number, body: string): Promise<JsonRpcResponse> {
    const answer = new Promise<JsonRpcResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ jsonrpc: '2.0', id, error: { code: -32000, message: `Request timeout after ${this.timeout}ms` } });
      }, this.timeout);
      this.pending.set(id, { resolve, timer });
    });

    const result = await this.post(body);
    if (!result.ok) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `HTTP ${result.status}: ${result.statusText}`, data: result.body },
      };
    }
    return answer;
  }

  private async post(body: string): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
    const endpoint = this.messageEndpoint;
    if (!endpoint) throw new Error('SSE transport has no message endpoint. Call connect() first.');
    const headers = this.buildHeaders();
    this.lastRequestHeaders = headers;
    this.log(`POST ${endpoint}`, body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
      const text = await response.text();
      return { ok: response.ok, status: response.status, statusText: response.statusText, body: text };
    } catch (error) {
      if (isAbortError(error)) {
        return { ok: false, status: 0, statusText: `timeout after ${this.timeout}ms`, body: '' };
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private async requestAnonymousToken(): Promise<void> {
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/oauth/token`;
    url.search = '';
    const tokenUrl = url.toString();
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'anonymous', client_id: crypto.randomUUID(), resource: this.baseUrl }),
      });
      if (!response.ok) {
        this.log(`No anonymous token (HTTP ${response.status})`);
        return;
      }
      const token = (await response.json()) as { access_token?: string };
      if (token.access_token) this.authToken = token.access_token;
    } catch (error) {
      // The server may allow unauthenticated access
      this.log('Error requesting anonymous token:', error);
    }
  }

  /** `<baseUrl><entryPath>/sse`, built from URL parts so query params on `baseUrl` survive. */
  private sseUrl(): string {
    const url = new URL(this.baseUrl);
    const entry = (this.entryPath ?? '').replace(/^\/+|\/+$/g, '');
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = entry ? `${basePath}/${entry}/sse` : `${basePath}/sse`;
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.clientInfo) headers['User-Agent'] = `${this.clientInfo.name}/${this.clientInfo.version}`;
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    Object.assign(headers, this.authHeaders);
    return headers;
  }

  private ensureConnected(): void {
    if (this.state !== 'connected') {
      throw new Error('Transport not connected. Call connect() first.');
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[SSE] ${message}`, data ?? '');
    }
  }
}

/** Splits complete SSE events off the buffer, accepting CRLF, CR and LF line endings, even split across chunks. */
function splitSSEEvents(buffer: string): { completeEvents: string[]; remainder: string } {
  const endsWithCarriageReturn = buffer.endsWith('\r');
  const normalized = (endsWithCarriageReturn ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n');
  const completeEvents = normalized.split('\n\n');
  const remainder = completeEvents.pop() ?? '';
  return { completeEvents, remainder: endsWithCarriageReturn ? `${remainder}\r` : remainder };
}

/** Parse one SSE event block; `undefined` for comments / keep-alives without data. */
function parseSSEEvent(text: string): SseEvent | undefined {
  let type = 'message';
  const data: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  }
  return data.length > 0 ? { type, data: data.join('\n') } : undefined;
}
