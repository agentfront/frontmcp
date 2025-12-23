// file: libs/browser/src/server/browser-server.ts
/**
 * Browser-native MCP server implementation.
 *
 * This server handles JSON-RPC requests over browser transports
 * (EventEmitter, postMessage) and integrates with Valtio stores
 * and component/renderer registries.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  BrowserTransport,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from '../transport';
import { isJSONRPCRequest, isJSONRPCNotification, EventTransportAdapter, createSimpleEmitter } from '../transport';
import type { McpStore } from '../store';
import type { ComponentRegistryInterface, RendererRegistryInterface } from '../registry';
import { BrowserToolEntry } from '../entries';
import type { BrowserPluginType, BrowserPlugin } from '../plugins/browser-plugin.types';
import type { BrowserHookStage } from '../plugins/browser-hook.types';
import { PluginManager } from '../plugins/plugin-manager';

/**
 * Tool definition for the browser server.
 */
export interface BrowserToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, context: BrowserToolContext) => Promise<unknown>;
}

/**
 * Resource definition for the browser server.
 */
export interface BrowserResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: (uri: string, context: BrowserResourceContext) => Promise<{ contents: ResourceContent[] }>;
}

/**
 * Resource content type.
 */
export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * Prompt definition for the browser server.
 */
export interface BrowserPromptDefinition {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
  handler: (
    args: Record<string, string>,
    context: BrowserPromptContext,
  ) => Promise<{
    messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }[];
  }>;
}

/**
 * Context passed to tool handlers.
 */
export interface BrowserToolContext {
  server: BrowserMcpServer;
  store?: McpStore<object>;
  componentRegistry?: ComponentRegistryInterface;
  rendererRegistry?: RendererRegistryInterface;
}

/**
 * Context passed to resource handlers.
 */
export interface BrowserResourceContext {
  server: BrowserMcpServer;
  store?: McpStore<object>;
}

/**
 * Context passed to prompt handlers.
 */
export interface BrowserPromptContext {
  server: BrowserMcpServer;
}

/**
 * Server capabilities.
 */
export interface BrowserServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

/**
 * Browser MCP server options.
 */
export interface BrowserMcpServerOptions {
  /**
   * Server name.
   */
  name: string;

  /**
   * Server version.
   * @default '1.0.0'
   */
  version?: string;

  /**
   * Transport adapter for communication.
   * If not provided, an EventTransportAdapter is created internally.
   */
  transport?: BrowserTransport;

  /**
   * Optional Valtio store for state management.
   */
  store?: McpStore<object>;

  /**
   * Optional component registry.
   */
  componentRegistry?: ComponentRegistryInterface;

  /**
   * Optional renderer registry.
   */
  rendererRegistry?: RendererRegistryInterface;

  /**
   * Server capabilities.
   */
  capabilities?: BrowserServerCapabilities;

  /**
   * Enable debug logging.
   */
  debug?: boolean;

  /**
   * Plugins to register with the server.
   * Plugins can provide tools, resources, prompts, and lifecycle hooks.
   *
   * @example
   * ```typescript
   * const server = new BrowserMcpServer({
   *   name: 'my-app',
   *   plugins: [
   *     loggingPlugin,
   *     createCachePlugin({ ttl: 30000 }),
   *   ],
   * });
   * ```
   */
  plugins?: BrowserPluginType[];
}

/**
 * Browser-native MCP server.
 *
 * @example Simple usage (transport created internally)
 * ```typescript
 * import { BrowserMcpServer } from '@frontmcp/browser';
 *
 * // Just provide a name - transport is created internally
 * const server = new BrowserMcpServer({ name: 'my-app' });
 *
 * server.addTool({
 *   name: 'greet',
 *   description: 'Greet someone',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { name: { type: 'string' } },
 *     required: ['name'],
 *   },
 *   handler: async (args) => ({ message: `Hello, ${args['name']}!` }),
 * });
 *
 * await server.start();
 * ```
 *
 * @example With custom transport
 * ```typescript
 * import { BrowserMcpServer, PostMessageTransportAdapter } from '@frontmcp/browser';
 *
 * const transport = new PostMessageTransportAdapter(window.parent);
 * const server = new BrowserMcpServer({ name: 'my-app', transport });
 * ```
 */
export class BrowserMcpServer {
  private readonly _name: string;
  private readonly _version: string;
  private readonly _transport: BrowserTransport;
  private readonly _ownsTransport: boolean;
  private readonly store?: McpStore<object>;
  private readonly componentRegistry?: ComponentRegistryInterface;
  private readonly rendererRegistry?: RendererRegistryInterface;
  private readonly capabilities: BrowserServerCapabilities;
  private readonly debug: boolean;
  private readonly sessionId: string;
  private readonly pluginManager: PluginManager;

  private tools = new Map<string, BrowserToolDefinition>();
  private resources = new Map<string, BrowserResourceDefinition>();
  private prompts = new Map<string, BrowserPromptDefinition>();

  private isStarted = false;
  private isInitialized = false;

  constructor(options: BrowserMcpServerOptions) {
    this._name = options.name;
    this._version = options.version ?? '1.0.0';

    // Create transport internally if not provided
    if (options.transport) {
      this._transport = options.transport;
      this._ownsTransport = false;
    } else {
      const emitter = createSimpleEmitter();
      this._transport = new EventTransportAdapter(emitter);
      this._ownsTransport = true;
    }

    this.store = options.store;
    this.componentRegistry = options.componentRegistry;
    this.rendererRegistry = options.rendererRegistry;
    this.capabilities = options.capabilities ?? {};
    this.debug = options.debug ?? false;
    this.sessionId = generateUUID();

    // Initialize plugin manager
    this.pluginManager = new PluginManager({
      plugins: options.plugins,
      store: this.store,
    });
    this.pluginManager.setServer(this);

    // Register tools, resources, and prompts from plugins
    this.registerPluginEntries();
  }

  /**
   * Register tools, resources, and prompts from plugins.
   */
  private registerPluginEntries(): void {
    // Register plugin tools
    for (const tool of this.pluginManager.collectTools()) {
      if (!this.tools.has(tool.name)) {
        this.tools.set(tool.name, tool);
      }
    }

    // Register plugin resources
    for (const resource of this.pluginManager.collectResources()) {
      if (!this.resources.has(resource.uri)) {
        this.resources.set(resource.uri, resource);
      }
    }

    // Register plugin prompts
    for (const prompt of this.pluginManager.collectPrompts()) {
      if (!this.prompts.has(prompt.name)) {
        this.prompts.set(prompt.name, prompt);
      }
    }
  }

  /**
   * Get the server name.
   */
  get name(): string {
    return this._name;
  }

  /**
   * Get the server version.
   */
  get version(): string {
    return this._version;
  }

  /**
   * Get the transport adapter.
   */
  get transport(): BrowserTransport {
    return this._transport;
  }

  /**
   * Add a tool to the server.
   */
  addTool(tool: BrowserToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Add a tool entry class to the server.
   */
  addToolEntry<T extends BrowserToolEntry>(ToolClass: new () => T): this {
    const instance = new ToolClass();
    const metadata = (ToolClass as unknown as { metadata: { name: string; description: string; inputSchema: unknown } })
      .metadata;

    // Set browser context on the tool
    instance.setBrowserContext({
      store: this.store,
      componentRegistry: this.componentRegistry as unknown as any,
      rendererRegistry: this.rendererRegistry as unknown as any,
    });

    this.addTool({
      name: metadata.name,
      description: metadata.description,
      inputSchema: metadata.inputSchema as any,
      handler: async (args, context) => {
        // Call the execute method on the tool instance
        return (instance as unknown as { execute: (args: unknown) => Promise<unknown> }).execute(args);
      },
    });

    return this;
  }

  /**
   * Add a resource to the server.
   */
  addResource(resource: BrowserResourceDefinition): this {
    if (this.resources.has(resource.uri)) {
      throw new Error(`Resource "${resource.uri}" is already registered`);
    }
    this.resources.set(resource.uri, resource);
    return this;
  }

  /**
   * Add a prompt to the server.
   */
  addPrompt(prompt: BrowserPromptDefinition): this {
    if (this.prompts.has(prompt.name)) {
      throw new Error(`Prompt "${prompt.name}" is already registered`);
    }
    this.prompts.set(prompt.name, prompt);
    return this;
  }

  /**
   * Remove a tool from the server.
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Remove a resource from the server.
   */
  removeResource(uri: string): boolean {
    return this.resources.delete(uri);
  }

  /**
   * Remove a prompt from the server.
   */
  removePrompt(name: string): boolean {
    return this.prompts.delete(name);
  }

  /**
   * Register a plugin at runtime.
   *
   * @param plugin - Plugin to register
   *
   * @example
   * ```typescript
   * await server.registerPlugin({
   *   name: 'analytics',
   *   hooks: {
   *     didCallTool: (ctx) => {
   *       analytics.track('tool_called', { tool: ctx.params.name });
   *     },
   *   },
   * });
   * ```
   */
  async registerPlugin(plugin: BrowserPluginType): Promise<void> {
    await this.pluginManager.register(plugin);

    // Register any new tools/resources/prompts
    this.registerPluginEntries();
  }

  /**
   * Unregister a plugin at runtime.
   *
   * @param name - Plugin name to unregister
   */
  async unregisterPlugin(name: string): Promise<void> {
    await this.pluginManager.unregister(name);
  }

  /**
   * Get a registered plugin by name.
   */
  getPlugin<T extends BrowserPlugin>(name: string): T | undefined {
    return this.pluginManager.get<T>(name);
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(name: string): boolean {
    return this.pluginManager.has(name);
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): BrowserPlugin[] {
    return this.pluginManager.getAll();
  }

  /**
   * Send a notification to connected clients.
   */
  sendNotification(method: string, params?: unknown): void {
    if (!this.isStarted) {
      return;
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.transport.send(notification);
  }

  /**
   * Get the store instance.
   */
  getStore<T extends object>(): McpStore<T> | undefined {
    return this.store as McpStore<T> | undefined;
  }

  /**
   * Get the component registry.
   */
  getComponentRegistry(): ComponentRegistryInterface | undefined {
    return this.componentRegistry;
  }

  /**
   * Get the renderer registry.
   */
  getRendererRegistry(): RendererRegistryInterface | undefined {
    return this.rendererRegistry;
  }

  /**
   * Get all registered tools.
   */
  getTools(): { name: string; description: string }[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Get all registered resources.
   */
  getResources(): { uri: string; name: string; description?: string }[] {
    return Array.from(this.resources.values()).map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
    }));
  }

  /**
   * Call a tool by name.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const context: BrowserToolContext = {
      server: this,
      store: this.store,
      componentRegistry: this.componentRegistry,
      rendererRegistry: this.rendererRegistry,
    };

    return tool.handler(args, context);
  }

  /**
   * Read a resource by URI.
   */
  async readResource(uri: string): Promise<{ contents: ResourceContent[] }> {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const context: BrowserResourceContext = {
      server: this,
      store: this.store,
    };

    return resource.handler(uri, context);
  }

  /**
   * Start the server.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Connect transport
    await this.transport.connect();

    // Set up message handler
    this.transport.onMessage(async (message) => {
      return this.handleMessage(message);
    });

    // Start all plugins
    await this.pluginManager.startAll();

    this.isStarted = true;
    this.log('Server started');
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    // Stop all plugins
    await this.pluginManager.stopAll();

    this.transport.destroy('Server stopped');
    this.isStarted = false;
    this.log('Server stopped');
  }

  /**
   * Handle incoming JSON-RPC message.
   */
  private async handleMessage(message: JSONRPCMessage): Promise<JSONRPCResponse | void> {
    if (isJSONRPCRequest(message)) {
      return this.handleRequest(message);
    }

    if (isJSONRPCNotification(message)) {
      await this.handleNotification(message);
      return;
    }

    // Response messages are handled by the transport
    return;
  }

  /**
   * Handle JSON-RPC request.
   */
  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    this.log('Request:', request.method, request.params);

    try {
      // Execute willHandle hooks
      const willHandleCtx = await this.pluginManager.executeHooks('willHandle', request.method, request.params);

      // Check if a hook short-circuited
      if (willHandleCtx._flowAction.type === 'respond') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: willHandleCtx._flowAction.result,
        };
      }
      if (willHandleCtx._flowAction.type === 'abort') {
        throw willHandleCtx._flowAction.error;
      }

      // Dispatch the request
      const result = await this.dispatch(request.method, request.params);

      // Execute didHandle hooks
      const didHandleCtx = await this.pluginManager.executeHooks('didHandle', request.method, request.params, result);

      // Use potentially modified result
      const finalResult =
        didHandleCtx._flowAction.type === 'respond' ? didHandleCtx._flowAction.result : didHandleCtx.result ?? result;

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: finalResult,
      };
    } catch (error) {
      // Execute onError hooks
      const errorCtx = await this.pluginManager.executeHooks(
        'onError',
        request.method,
        request.params,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      );

      // Check if error was transformed
      const finalError = errorCtx.error ?? (error instanceof Error ? error : new Error(String(error)));
      const message = finalError.message;

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message,
        },
      };
    }
  }

  /**
   * Handle JSON-RPC notification.
   */
  private async handleNotification(notification: JSONRPCNotification): Promise<void> {
    this.log('Notification:', notification.method, notification.params);

    // Handle standard MCP notifications
    switch (notification.method) {
      case 'notifications/initialized':
        this.isInitialized = true;
        break;
      case 'notifications/cancelled':
        // Handle cancellation if needed
        break;
    }
  }

  /**
   * Dispatch a method call.
   */
  private async dispatch(method: string, params?: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params as Record<string, unknown>);
      case 'tools/list':
        return await this.handleToolsList();
      case 'tools/call':
        return await this.handleToolsCall(params as { name: string; arguments?: Record<string, unknown> });
      case 'resources/list':
        return await this.handleResourcesList();
      case 'resources/read':
        return await this.handleResourcesRead(params as { uri: string });
      case 'prompts/list':
        return await this.handlePromptsList();
      case 'prompts/get':
        return await this.handlePromptsGet(params as { name: string; arguments?: Record<string, string> });
      case 'ping':
        return {};
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private handleInitialize(params: Record<string, unknown>): {
    protocolVersion: string;
    capabilities: BrowserServerCapabilities;
    serverInfo: { name: string; version: string };
  } {
    return {
      protocolVersion: '2024-11-05',
      capabilities: this.buildCapabilities(),
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    };
  }

  private buildCapabilities(): BrowserServerCapabilities {
    const caps: BrowserServerCapabilities = {};

    if (this.tools.size > 0) {
      caps.tools = this.capabilities.tools ?? {};
    }

    if (this.resources.size > 0) {
      caps.resources = this.capabilities.resources ?? {};
    }

    if (this.prompts.size > 0) {
      caps.prompts = this.capabilities.prompts ?? {};
    }

    return caps;
  }

  private async handleToolsList(): Promise<{ tools: { name: string; description: string; inputSchema: unknown }[] }> {
    // Execute willListTools hooks
    const willCtx = await this.pluginManager.executeHooks('willListTools', 'tools/list', undefined);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as { tools: { name: string; description: string; inputSchema: unknown }[] };
    }
    if (willCtx._flowAction.type === 'abort') {
      throw willCtx._flowAction.error;
    }

    const tools = Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    const result = { tools };

    // Execute didListTools hooks (can filter tools)
    const didCtx = await this.pluginManager.executeHooks('didListTools', 'tools/list', undefined, result);
    if (didCtx._flowAction.type === 'respond') {
      return didCtx._flowAction.result as { tools: { name: string; description: string; inputSchema: unknown }[] };
    }

    return didCtx.result ?? result;
  }

  private async handleToolsCall(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: { type: 'text'; text: string }[];
    isError?: boolean;
  }> {
    // Execute willCallTool hooks
    const willCtx = await this.pluginManager.executeHooks('willCallTool', 'tools/call', params);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as { content: { type: 'text'; text: string }[]; isError?: boolean };
    }
    if (willCtx._flowAction.type === 'abort') {
      return {
        content: [{ type: 'text', text: willCtx._flowAction.error.message }],
        isError: true,
      };
    }

    const tool = this.tools.get(params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${params.name}` }],
        isError: true,
      };
    }

    const context: BrowserToolContext = {
      server: this,
      store: this.store,
      componentRegistry: this.componentRegistry,
      rendererRegistry: this.rendererRegistry,
    };

    try {
      const rawResult = await tool.handler(params.arguments ?? {}, context);
      const text = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
      const result = {
        content: [{ type: 'text' as const, text }],
      };

      // Execute didCallTool hooks
      const didCtx = await this.pluginManager.executeHooks('didCallTool', 'tools/call', params, result);
      if (didCtx._flowAction.type === 'respond') {
        return didCtx._flowAction.result as { content: { type: 'text'; text: string }[]; isError?: boolean };
      }

      return didCtx.result ?? result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  }

  private async handleResourcesList(): Promise<{
    resources: { uri: string; name: string; description?: string; mimeType?: string }[];
  }> {
    // Execute willListResources hooks
    const willCtx = await this.pluginManager.executeHooks('willListResources', 'resources/list', undefined);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as {
        resources: { uri: string; name: string; description?: string; mimeType?: string }[];
      };
    }
    if (willCtx._flowAction.type === 'abort') {
      throw willCtx._flowAction.error;
    }

    const resources = Array.from(this.resources.values()).map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }));
    const result = { resources };

    // Execute didListResources hooks
    const didCtx = await this.pluginManager.executeHooks('didListResources', 'resources/list', undefined, result);
    if (didCtx._flowAction.type === 'respond') {
      return didCtx._flowAction.result as {
        resources: { uri: string; name: string; description?: string; mimeType?: string }[];
      };
    }

    return didCtx.result ?? result;
  }

  private async handleResourcesRead(params: { uri: string }): Promise<{ contents: ResourceContent[] }> {
    // Execute willReadResource hooks
    const willCtx = await this.pluginManager.executeHooks('willReadResource', 'resources/read', params);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as { contents: ResourceContent[] };
    }
    if (willCtx._flowAction.type === 'abort') {
      throw willCtx._flowAction.error;
    }

    const resource = this.resources.get(params.uri);
    if (!resource) {
      throw new Error(`Resource not found: ${params.uri}`);
    }

    const context: BrowserResourceContext = {
      server: this,
      store: this.store,
    };

    const result = await resource.handler(params.uri, context);

    // Execute didReadResource hooks
    const didCtx = await this.pluginManager.executeHooks('didReadResource', 'resources/read', params, result);
    if (didCtx._flowAction.type === 'respond') {
      return didCtx._flowAction.result as { contents: ResourceContent[] };
    }

    return didCtx.result ?? result;
  }

  private async handlePromptsList(): Promise<{
    prompts: {
      name: string;
      description?: string;
      arguments?: { name: string; description?: string; required?: boolean }[];
    }[];
  }> {
    // Execute willListPrompts hooks
    const willCtx = await this.pluginManager.executeHooks('willListPrompts', 'prompts/list', undefined);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as {
        prompts: {
          name: string;
          description?: string;
          arguments?: { name: string; description?: string; required?: boolean }[];
        }[];
      };
    }
    if (willCtx._flowAction.type === 'abort') {
      throw willCtx._flowAction.error;
    }

    const prompts = Array.from(this.prompts.values()).map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    }));
    const result = { prompts };

    // Execute didListPrompts hooks
    const didCtx = await this.pluginManager.executeHooks('didListPrompts', 'prompts/list', undefined, result);
    if (didCtx._flowAction.type === 'respond') {
      return didCtx._flowAction.result as {
        prompts: {
          name: string;
          description?: string;
          arguments?: { name: string; description?: string; required?: boolean }[];
        }[];
      };
    }

    return didCtx.result ?? result;
  }

  private async handlePromptsGet(params: { name: string; arguments?: Record<string, string> }): Promise<{
    messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }[];
  }> {
    // Execute willGetPrompt hooks
    const willCtx = await this.pluginManager.executeHooks('willGetPrompt', 'prompts/get', params);
    if (willCtx._flowAction.type === 'respond') {
      return willCtx._flowAction.result as {
        messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }[];
      };
    }
    if (willCtx._flowAction.type === 'abort') {
      throw willCtx._flowAction.error;
    }

    const prompt = this.prompts.get(params.name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${params.name}`);
    }

    const context: BrowserPromptContext = {
      server: this,
    };

    const result = await prompt.handler(params.arguments ?? {}, context);

    // Execute didGetPrompt hooks
    const didCtx = await this.pluginManager.executeHooks('didGetPrompt', 'prompts/get', params, result);
    if (didCtx._flowAction.type === 'respond') {
      return didCtx._flowAction.result as {
        messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }[];
      };
    }

    return didCtx.result ?? result;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[BrowserMcpServer ${this.sessionId.slice(0, 8)}]`, ...args);
    }
  }
}
