/**
 * @file mcp-test-client.ts
 * @description Main MCP Test Client implementation for E2E testing
 */

import type {
  McpTestClientConfig,
  McpResponse,
  TestTransportType,
  TestAuthConfig,
  ToolResultWrapper,
  ResourceContentWrapper,
  PromptResultWrapper,
  LogEntry,
  RequestTrace,
  NotificationEntry,
  ProgressUpdate,
  SessionInfo,
  AuthState,
  McpErrorInfo,
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  GetPromptResult,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  JSONRPCResponse,
} from './mcp-test-client.types';
import { McpTestClientBuilder } from './mcp-test-client.builder';
import type { McpTransport } from '../transport/transport.interface';
import { StreamableHttpTransport } from '../transport/streamable-http.transport';
import type {
  InterceptorChain,
  MockDefinition,
  MockHandle,
  RequestInterceptor,
  ResponseInterceptor,
} from '../interceptor';
import { DefaultInterceptorChain, mockResponse } from '../interceptor';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_CLIENT_INFO = {
  name: '@frontmcp/testing',
  version: '0.4.0',
};

// ═══════════════════════════════════════════════════════════════════
// MAIN CLIENT CLASS
// ═══════════════════════════════════════════════════════════════════

export class McpTestClient {
  private readonly config: Required<McpTestClientConfig>;
  private transport: McpTransport | null = null;
  private initResult: InitializeResult | null = null;
  private requestIdCounter = 0;
  private _lastRequestId: string | number = 0;
  private _sessionId: string | undefined;
  private _sessionInfo: SessionInfo | null = null;
  private _authState: AuthState = { isAnonymous: true, scopes: [] };

  // Logging and tracing
  private _logs: LogEntry[] = [];
  private _traces: RequestTrace[] = [];
  private _notifications: NotificationEntry[] = [];
  private _progressUpdates: ProgressUpdate[] = [];

  // Interceptor chain
  private _interceptors: InterceptorChain;

  // ═══════════════════════════════════════════════════════════════════
  // CONSTRUCTOR & FACTORY
  // ═══════════════════════════════════════════════════════════════════

  constructor(config: McpTestClientConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      transport: config.transport ?? 'streamable-http',
      auth: config.auth ?? {},
      publicMode: config.publicMode ?? false,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      debug: config.debug ?? false,
      protocolVersion: config.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
      clientInfo: config.clientInfo ?? DEFAULT_CLIENT_INFO,
    };

    // If a token is provided, user is authenticated (even in public mode)
    // Public mode just means anonymous access is allowed, not that tokens are ignored
    if (config.auth?.token) {
      this._authState = {
        isAnonymous: false,
        token: config.auth.token,
        scopes: this.parseScopesFromToken(config.auth.token),
        user: this.parseUserFromToken(config.auth.token),
      };
    }
    // Otherwise, user is anonymous (default _authState is already { isAnonymous: true, scopes: [] })

    // Initialize interceptor chain
    this._interceptors = new DefaultInterceptorChain();
  }

  /**
   * Create a new McpTestClientBuilder for fluent configuration
   */
  static create(config: McpTestClientConfig): McpTestClientBuilder {
    return new McpTestClientBuilder(config);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION & LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Connect to the MCP server and perform initialization
   */
  async connect(): Promise<InitializeResult> {
    this.log('debug', `Connecting to ${this.config.baseUrl}...`);

    // Create transport based on config
    this.transport = this.createTransport();

    // Connect transport
    await this.transport.connect();

    // Perform MCP initialization
    const initResponse = await this.initialize();

    if (!initResponse.success || !initResponse.data) {
      throw new Error(`Failed to initialize MCP connection: ${initResponse.error?.message ?? 'Unknown error'}`);
    }

    this.initResult = initResponse.data;
    this._sessionId = this.transport.getSessionId();
    this._sessionInfo = {
      id: this._sessionId ?? `session-${Date.now()}`,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      requestCount: 1,
    };

    // Send initialized notification per MCP protocol
    // This notification MUST be sent after receiving initialize response
    // before the client can make any other requests
    await this.transport.notify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    this.log('info', `Connected to ${this.initResult.serverInfo?.name ?? 'MCP Server'}`);

    return this.initResult;
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.initResult = null;
    this.log('info', 'Disconnected from MCP server');
  }

  /**
   * Reconnect to the server, optionally with an existing session ID
   */
  async reconnect(options?: { sessionId?: string }): Promise<void> {
    await this.disconnect();

    if (options?.sessionId && this.transport) {
      // Set session ID before reconnecting
      this._sessionId = options.sessionId;
    }

    await this.connect();
  }

  /**
   * Check if the client is currently connected
   */
  isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SESSION & AUTH PROPERTIES
  // ═══════════════════════════════════════════════════════════════════

  get sessionId(): string {
    return this._sessionId ?? '';
  }

  get session(): SessionInfo & { expire: () => Promise<void> } {
    const info = this._sessionInfo ?? {
      id: '',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      requestCount: 0,
    };

    return {
      ...info,
      expire: async () => {
        // Force session expiration for testing
        this._sessionId = undefined;
        this._sessionInfo = null;
      },
    };
  }

  get auth(): AuthState {
    return this._authState;
  }

  /**
   * Authenticate with a token
   */
  async authenticate(token: string): Promise<void> {
    this._authState = {
      isAnonymous: false,
      token,
      scopes: this.parseScopesFromToken(token),
      user: this.parseUserFromToken(token),
    };

    // Update transport headers
    if (this.transport) {
      this.transport.setAuthToken(token);
    }

    this.log('debug', 'Authentication updated');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SERVER INFO & CAPABILITIES
  // ═══════════════════════════════════════════════════════════════════

  get serverInfo(): { name: string; version: string; title?: string } {
    return {
      name: this.initResult?.serverInfo?.name ?? '',
      version: this.initResult?.serverInfo?.version ?? '',
    };
  }

  get protocolVersion(): string {
    return this.initResult?.protocolVersion ?? '';
  }

  get instructions(): string {
    return this.initResult?.instructions ?? '';
  }

  get capabilities(): InitializeResult['capabilities'] {
    return this.initResult?.capabilities ?? {};
  }

  /**
   * Check if server has a specific capability
   */
  hasCapability(name: 'tools' | 'resources' | 'prompts' | 'logging' | 'sampling'): boolean {
    return !!this.capabilities[name];
  }

  // ═══════════════════════════════════════════════════════════════════
  // TOOLS API
  // ═══════════════════════════════════════════════════════════════════

  readonly tools = {
    /**
     * List all available tools
     */
    list: async (): Promise<Tool[]> => {
      const response = await this.listTools();
      if (!response.success || !response.data) {
        throw new Error(`Failed to list tools: ${response.error?.message}`);
      }
      return response.data.tools;
    },

    /**
     * Call a tool by name with arguments
     */
    call: async (name: string, args?: Record<string, unknown>): Promise<ToolResultWrapper> => {
      const response = await this.callTool(name, args);
      return this.wrapToolResult(response);
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // RESOURCES API
  // ═══════════════════════════════════════════════════════════════════

  readonly resources = {
    /**
     * List all static resources
     */
    list: async (): Promise<Resource[]> => {
      const response = await this.listResources();
      if (!response.success || !response.data) {
        throw new Error(`Failed to list resources: ${response.error?.message}`);
      }
      return response.data.resources;
    },

    /**
     * List all resource templates
     */
    listTemplates: async (): Promise<ResourceTemplate[]> => {
      const response = await this.listResourceTemplates();
      if (!response.success || !response.data) {
        throw new Error(`Failed to list resource templates: ${response.error?.message}`);
      }
      return response.data.resourceTemplates;
    },

    /**
     * Read a resource by URI
     */
    read: async (uri: string): Promise<ResourceContentWrapper> => {
      const response = await this.readResource(uri);
      return this.wrapResourceContent(response);
    },

    /**
     * Subscribe to resource changes (placeholder for future implementation)
     */
    subscribe: async (_uri: string): Promise<void> => {
      // TODO: Implement resource subscription
      this.log('warn', 'Resource subscription not yet implemented');
    },

    /**
     * Unsubscribe from resource changes (placeholder for future implementation)
     */
    unsubscribe: async (_uri: string): Promise<void> => {
      // TODO: Implement resource unsubscription
      this.log('warn', 'Resource unsubscription not yet implemented');
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // PROMPTS API
  // ═══════════════════════════════════════════════════════════════════

  readonly prompts = {
    /**
     * List all available prompts
     */
    list: async (): Promise<Prompt[]> => {
      const response = await this.listPrompts();
      if (!response.success || !response.data) {
        throw new Error(`Failed to list prompts: ${response.error?.message}`);
      }
      return response.data.prompts;
    },

    /**
     * Get a prompt with arguments
     */
    get: async (name: string, args?: Record<string, string>): Promise<PromptResultWrapper> => {
      const response = await this.getPrompt(name, args);
      return this.wrapPromptResult(response);
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // RAW PROTOCOL ACCESS
  // ═══════════════════════════════════════════════════════════════════

  readonly raw = {
    /**
     * Send any JSON-RPC request
     */
    request: async (message: {
      jsonrpc: '2.0';
      id: string | number;
      method: string;
      params?: Record<string, unknown>;
    }): Promise<JSONRPCResponse> => {
      this.ensureConnected();
      const start = Date.now();
      const response = await this.transport!.request(message);
      this.traceRequest(message.method, message.params, message.id, response, Date.now() - start);
      return response;
    },

    /**
     * Send a notification (no response expected)
     */
    notify: async (message: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }): Promise<void> => {
      this.ensureConnected();
      await this.transport!.notify(message);
    },

    /**
     * Send raw string data (for error testing)
     */
    sendRaw: async (data: string): Promise<JSONRPCResponse> => {
      this.ensureConnected();
      return this.transport!.sendRaw(data);
    },
  };

  get lastRequestId(): string | number {
    return this._lastRequestId;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TRANSPORT INFO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get transport information and utilities
   */
  get transport_info(): {
    type: TestTransportType;
    isConnected: () => boolean;
    messageEndpoint: string | undefined;
    connectionCount: number;
    reconnectCount: number;
    lastRequestHeaders: Record<string, string>;
    simulateDisconnect: () => Promise<void>;
    waitForReconnect: (timeoutMs: number) => Promise<void>;
  } {
    return {
      type: this.config.transport,
      isConnected: () => this.transport?.isConnected() ?? false,
      messageEndpoint: this.transport?.getMessageEndpoint?.(),
      connectionCount: this.transport?.getConnectionCount?.() ?? 0,
      reconnectCount: this.transport?.getReconnectCount?.() ?? 0,
      lastRequestHeaders: this.transport?.getLastRequestHeaders?.() ?? {},
      simulateDisconnect: async () => {
        await this.transport?.simulateDisconnect?.();
      },
      waitForReconnect: async (timeoutMs: number) => {
        await this.transport?.waitForReconnect?.(timeoutMs);
      },
    };
  }

  // Alias for transport info
  get transport_() {
    return this.transport_info;
  }

  // ═══════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════

  readonly notifications = {
    /**
     * Start collecting server notifications
     */
    collect: (): NotificationCollector => {
      return new NotificationCollector(this._notifications);
    },

    /**
     * Collect progress notifications specifically
     */
    collectProgress: (): ProgressCollector => {
      return new ProgressCollector(this._progressUpdates);
    },

    /**
     * Send a notification to the server
     */
    send: async (method: string, params?: Record<string, unknown>): Promise<void> => {
      await this.raw.notify({ jsonrpc: '2.0', method, params });
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // LOGGING & DEBUGGING
  // ═══════════════════════════════════════════════════════════════════

  readonly logs = {
    all: (): LogEntry[] => [...this._logs],

    filter: (level: 'debug' | 'info' | 'warn' | 'error'): LogEntry[] => this._logs.filter((l) => l.level === level),

    search: (text: string): LogEntry[] => this._logs.filter((l) => l.message.includes(text)),

    last: (): LogEntry | undefined => this._logs[this._logs.length - 1],

    clear: (): void => {
      this._logs = [];
    },
  };

  readonly trace = {
    all: (): RequestTrace[] => [...this._traces],

    last: (): RequestTrace | undefined => this._traces[this._traces.length - 1],

    clear: (): void => {
      this._traces = [];
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // MOCKING & INTERCEPTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * API for mocking MCP requests
   *
   * @example
   * ```typescript
   * // Mock a specific tool call
   * const handle = mcp.mock.tool('my-tool', { result: 'mocked!' });
   *
   * // Mock with params matching
   * mcp.mock.add({
   *   method: 'tools/call',
   *   params: { name: 'my-tool' },
   *   response: mockResponse.toolResult([{ type: 'text', text: 'mocked' }]),
   * });
   *
   * // Clear all mocks after test
   * mcp.mock.clear();
   * ```
   */
  readonly mock = {
    /**
     * Add a mock definition
     */
    add: (mock: MockDefinition): MockHandle => {
      return this._interceptors.mocks.add(mock);
    },

    /**
     * Mock a tools/call request for a specific tool
     */
    tool: (name: string, result: unknown, options?: { times?: number; delay?: number }): MockHandle => {
      return this._interceptors.mocks.add({
        method: 'tools/call',
        params: { name },
        response: mockResponse.toolResult([
          { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
        ]),
        times: options?.times,
        delay: options?.delay,
      });
    },

    /**
     * Mock a tools/call request to return an error
     */
    toolError: (name: string, code: number, message: string, options?: { times?: number }): MockHandle => {
      return this._interceptors.mocks.add({
        method: 'tools/call',
        params: { name },
        response: mockResponse.error(code, message),
        times: options?.times,
      });
    },

    /**
     * Mock a resources/read request
     */
    resource: (
      uri: string,
      content: string | { text?: string; blob?: string; mimeType?: string },
      options?: { times?: number; delay?: number },
    ): MockHandle => {
      const contentObj = typeof content === 'string' ? { uri, text: content } : { uri, ...content };
      return this._interceptors.mocks.add({
        method: 'resources/read',
        params: { uri },
        response: mockResponse.resourceRead([contentObj]),
        times: options?.times,
        delay: options?.delay,
      });
    },

    /**
     * Mock a resources/read request to return an error
     */
    resourceError: (uri: string, options?: { times?: number }): MockHandle => {
      return this._interceptors.mocks.add({
        method: 'resources/read',
        params: { uri },
        response: mockResponse.errors.resourceNotFound(uri),
        times: options?.times,
      });
    },

    /**
     * Mock the tools/list response
     */
    toolsList: (
      tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
      options?: { times?: number },
    ): MockHandle => {
      return this._interceptors.mocks.add({
        method: 'tools/list',
        response: mockResponse.toolsList(tools),
        times: options?.times,
      });
    },

    /**
     * Mock the resources/list response
     */
    resourcesList: (
      resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>,
      options?: { times?: number },
    ): MockHandle => {
      return this._interceptors.mocks.add({
        method: 'resources/list',
        response: mockResponse.resourcesList(resources),
        times: options?.times,
      });
    },

    /**
     * Clear all mocks
     */
    clear: (): void => {
      this._interceptors.mocks.clear();
    },

    /**
     * Get all active mocks
     */
    all: (): MockDefinition[] => {
      return this._interceptors.mocks.getAll();
    },
  };

  /**
   * API for intercepting requests and responses
   *
   * @example
   * ```typescript
   * // Log all requests
   * const remove = mcp.intercept.request((ctx) => {
   *   console.log('Request:', ctx.request.method);
   *   return { action: 'passthrough' };
   * });
   *
   * // Modify requests
   * mcp.intercept.request((ctx) => {
   *   if (ctx.request.method === 'tools/call') {
   *     return {
   *       action: 'modify',
   *       request: { ...ctx.request, params: { ...ctx.request.params, extra: true } },
   *     };
   *   }
   *   return { action: 'passthrough' };
   * });
   *
   * // Add latency to all requests
   * mcp.intercept.delay(100);
   *
   * // Clean up
   * remove();
   * mcp.intercept.clear();
   * ```
   */
  readonly intercept = {
    /**
     * Add a request interceptor
     * @returns Function to remove the interceptor
     */
    request: (interceptor: RequestInterceptor): (() => void) => {
      return (this._interceptors as DefaultInterceptorChain).addRequestInterceptor(interceptor);
    },

    /**
     * Add a response interceptor
     * @returns Function to remove the interceptor
     */
    response: (interceptor: ResponseInterceptor): (() => void) => {
      return (this._interceptors as DefaultInterceptorChain).addResponseInterceptor(interceptor);
    },

    /**
     * Add latency to all requests
     * @returns Function to remove the interceptor
     */
    delay: (ms: number): (() => void) => {
      return (this._interceptors as DefaultInterceptorChain).addRequestInterceptor(async () => {
        await new Promise((r) => setTimeout(r, ms));
        return { action: 'passthrough' };
      });
    },

    /**
     * Fail requests matching a method
     * @returns Function to remove the interceptor
     */
    failMethod: (method: string, error?: string): (() => void) => {
      return (this._interceptors as DefaultInterceptorChain).addRequestInterceptor((ctx) => {
        if (ctx.request.method === method) {
          return { action: 'error', error: new Error(error ?? `Intercepted: ${method}`) };
        }
        return { action: 'passthrough' };
      });
    },

    /**
     * Clear all interceptors (but not mocks)
     */
    clear: (): void => {
      (this._interceptors as DefaultInterceptorChain).request = [];
      (this._interceptors as DefaultInterceptorChain).response = [];
    },

    /**
     * Clear everything (interceptors and mocks)
     */
    clearAll: (): void => {
      (this._interceptors as DefaultInterceptorChain).clear();
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // TIMEOUT
  // ═══════════════════════════════════════════════════════════════════

  setTimeout(ms: number): void {
    this.config.timeout = ms;
    if (this.transport) {
      this.transport.setTimeout(ms);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: MCP OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  private async initialize(): Promise<McpResponse<InitializeResult>> {
    return this.request<InitializeResult>('initialize', {
      protocolVersion: this.config.protocolVersion,
      capabilities: {
        sampling: {},
      },
      clientInfo: this.config.clientInfo,
    });
  }

  private async listTools(): Promise<McpResponse<ListToolsResult>> {
    return this.request<ListToolsResult>('tools/list', {});
  }

  private async callTool(name: string, args?: Record<string, unknown>): Promise<McpResponse<CallToolResult>> {
    return this.request<CallToolResult>('tools/call', {
      name,
      arguments: args ?? {},
    });
  }

  private async listResources(): Promise<McpResponse<ListResourcesResult>> {
    return this.request<ListResourcesResult>('resources/list', {});
  }

  private async listResourceTemplates(): Promise<McpResponse<ListResourceTemplatesResult>> {
    return this.request<ListResourceTemplatesResult>('resources/templates/list', {});
  }

  private async readResource(uri: string): Promise<McpResponse<ReadResourceResult>> {
    return this.request<ReadResourceResult>('resources/read', { uri });
  }

  private async listPrompts(): Promise<McpResponse<ListPromptsResult>> {
    return this.request<ListPromptsResult>('prompts/list', {});
  }

  private async getPrompt(name: string, args?: Record<string, string>): Promise<McpResponse<GetPromptResult>> {
    return this.request<GetPromptResult>('prompts/get', {
      name,
      arguments: args ?? {},
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: TRANSPORT & REQUEST HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private createTransport(): McpTransport {
    switch (this.config.transport) {
      case 'streamable-http':
        return new StreamableHttpTransport({
          baseUrl: this.config.baseUrl,
          timeout: this.config.timeout,
          auth: this.config.auth,
          publicMode: this.config.publicMode,
          debug: this.config.debug,
          interceptors: this._interceptors,
          clientInfo: this.config.clientInfo,
        });
      case 'sse':
        // TODO: Implement SSE transport
        throw new Error('SSE transport not yet implemented');
      default:
        throw new Error(`Unknown transport type: ${this.config.transport}`);
    }
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<McpResponse<T>> {
    this.ensureConnected();

    const id = ++this.requestIdCounter;
    this._lastRequestId = id;
    const start = Date.now();

    try {
      const response = await this.transport!.request<T>({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      const durationMs = Date.now() - start;
      this.updateSessionActivity();

      if ('error' in response && response.error) {
        const error = response.error as McpErrorInfo;
        this.traceRequest(method, params, id, response, durationMs);
        return {
          success: false,
          error,
          durationMs,
          requestId: id,
        };
      }

      this.traceRequest(method, params, id, response, durationMs);
      return {
        success: true,
        data: response.result as T,
        durationMs,
        requestId: id,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error: McpErrorInfo = {
        code: -32603,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      return {
        success: false,
        error,
        durationMs,
        requestId: id,
      };
    }
  }

  private ensureConnected(): void {
    if (!this.transport?.isConnected()) {
      throw new Error('Not connected to MCP server. Call connect() first.');
    }
  }

  private updateSessionActivity(): void {
    if (this._sessionInfo) {
      this._sessionInfo.lastActivityAt = new Date();
      this._sessionInfo.requestCount++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: RESULT WRAPPERS
  // ═══════════════════════════════════════════════════════════════════

  private wrapToolResult(response: McpResponse<CallToolResult>): ToolResultWrapper {
    const raw = response.data ?? { content: [] };
    const isError = !response.success || raw.isError === true;

    // Check for Tool UI response - has UI metadata in _meta
    // inline mode uses ui/html, hybrid mode uses ui/component
    const meta = raw._meta as Record<string, unknown> | undefined;
    console.log(`[PLATFORM_DEBUG] Response _meta: ${JSON.stringify(meta)}`);
    const hasUI = meta?.['ui/html'] !== undefined || meta?.['ui/component'] !== undefined;
    console.log(`[PLATFORM_DEBUG] hasToolUI will return: ${hasUI}`);
    const structuredContent = (raw as Record<string, unknown>)['structuredContent'];

    return {
      raw,
      isSuccess: !isError,
      isError,
      error: response.error,
      durationMs: response.durationMs,
      json<T>(): T {
        // For Tool UI responses, return structuredContent (the typed output)
        if (hasUI && structuredContent !== undefined) {
          return structuredContent as T;
        }
        // For regular responses, parse text content as JSON
        const textContent = raw.content?.find((c) => c.type === 'text');
        if (textContent && 'text' in textContent) {
          return JSON.parse(textContent.text) as T;
        }
        throw new Error('No text content to parse as JSON');
      },
      text(): string | undefined {
        const textContent = raw.content?.find((c) => c.type === 'text');
        if (textContent && 'text' in textContent) {
          return textContent.text;
        }
        return undefined;
      },
      hasTextContent(): boolean {
        return raw.content?.some((c) => c.type === 'text') ?? false;
      },
      hasImageContent(): boolean {
        return raw.content?.some((c) => c.type === 'image') ?? false;
      },
      hasResourceContent(): boolean {
        return raw.content?.some((c) => c.type === 'resource') ?? false;
      },
      hasToolUI(): boolean {
        return hasUI;
      },
    };
  }

  private wrapResourceContent(response: McpResponse<ReadResourceResult>): ResourceContentWrapper {
    const raw = response.data ?? { contents: [] };
    const isError = !response.success;
    const firstContent = raw.contents?.[0];

    return {
      raw,
      isSuccess: !isError,
      isError,
      error: response.error,
      durationMs: response.durationMs,
      json<T>(): T {
        if (firstContent && 'text' in firstContent) {
          return JSON.parse(firstContent.text) as T;
        }
        throw new Error('No text content to parse as JSON');
      },
      text(): string | undefined {
        if (firstContent && 'text' in firstContent) {
          return firstContent.text;
        }
        return undefined;
      },
      mimeType(): string | undefined {
        return firstContent?.mimeType;
      },
      hasMimeType(type: string): boolean {
        return firstContent?.mimeType === type;
      },
    };
  }

  private wrapPromptResult(response: McpResponse<GetPromptResult>): PromptResultWrapper {
    const raw = response.data ?? { messages: [] };
    const isError = !response.success;

    return {
      raw,
      isSuccess: !isError,
      isError,
      error: response.error,
      durationMs: response.durationMs,
      messages: raw.messages ?? [],
      description: raw.description,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: LOGGING & TRACING
  // ═══════════════════════════════════════════════════════════════════

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      data,
    };
    this._logs.push(entry);

    if (this.config.debug) {
      console.log(`[${level.toUpperCase()}] ${message}`, data ?? '');
    }
  }

  private traceRequest(
    method: string,
    params: unknown,
    id: string | number,
    response: JSONRPCResponse,
    durationMs: number,
  ): void {
    this._traces.push({
      request: { method, params, id },
      response: {
        result: 'result' in response ? response.result : undefined,
        error: 'error' in response ? (response.error as McpErrorInfo) : undefined,
      },
      durationMs,
      timestamp: new Date(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE: TOKEN PARSING
  // ═══════════════════════════════════════════════════════════════════

  private parseScopesFromToken(token: string): string[] {
    try {
      const payload = this.decodeJwtPayload(token);
      if (!payload) return [];
      const scope = payload['scope'];
      const scopes = payload['scopes'];
      if (typeof scope === 'string') {
        return scope.split(' ');
      }
      if (Array.isArray(scopes)) {
        return scopes as string[];
      }
      return [];
    } catch {
      return [];
    }
  }

  private parseUserFromToken(token: string): { sub: string; email?: string; name?: string } | undefined {
    try {
      const payload = this.decodeJwtPayload(token);
      const sub = payload?.['sub'];
      if (!sub || typeof sub !== 'string') return undefined;
      return {
        sub,
        email: payload['email'] as string | undefined,
        name: payload['name'] as string | undefined,
      };
    } catch {
      return undefined;
    }
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION COLLECTORS
// ═══════════════════════════════════════════════════════════════════

class NotificationCollector {
  constructor(private readonly notifications: NotificationEntry[]) {}

  get received(): NotificationEntry[] {
    return [...this.notifications];
  }

  has(method: string): boolean {
    return this.notifications.some((n) => n.method === method);
  }

  async waitFor(method: string, timeoutMs: number): Promise<NotificationEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.notifications.find((n) => n.method === method);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for notification: ${method}`);
  }
}

class ProgressCollector {
  constructor(private readonly updates: ProgressUpdate[]) {}

  get all(): ProgressUpdate[] {
    return [...this.updates];
  }

  async waitForComplete(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const last = this.updates[this.updates.length - 1];
      if (last && last.total !== undefined && last.progress >= last.total) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Timeout waiting for progress to complete');
  }
}
