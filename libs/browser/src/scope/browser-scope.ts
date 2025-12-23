// file: libs/browser/src/scope/browser-scope.ts
/**
 * Browser Scope - A browser-compatible scope for MCP servers.
 *
 * This provides similar functionality to the SDK's Scope but without
 * Node.js dependencies, making it suitable for browser environments.
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type { BrowserTransport } from '../transport/transport.interface';
import type { PlatformCrypto, PlatformStorage, PlatformLogger } from '../platform';
import { BrowserCryptoAdapter, BrowserStorageAdapter } from '../platform';
import type {
  BrowserScopeOptions,
  BrowserServerInfo,
  ScopeToolDefinition,
  ScopeResourceDefinition,
  ScopePromptDefinition,
  BrowserToolChangeEvent,
  BrowserResourceChangeEvent,
  BrowserScopeCapabilities,
} from './types';

/**
 * Console-based logger for browser
 */
const consoleLogger: PlatformLogger = {
  debug: (message, ...args) => console.debug(`[BrowserScope] ${message}`, ...args),
  info: (message, ...args) => console.info(`[BrowserScope] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[BrowserScope] ${message}`, ...args),
  error: (message, ...args) => console.error(`[BrowserScope] ${message}`, ...args),
  verbose: (message, ...args) => console.debug(`[BrowserScope:verbose] ${message}`, ...args),
};

/**
 * Browser Scope - Lightweight MCP scope for browser environments.
 *
 * This class provides:
 * - Tool, resource, and prompt registration
 * - Browser-compatible platform adapters
 * - Change event subscriptions
 * - Similar API to SDK Scope for migration path
 *
 * @example Basic usage
 * ```typescript
 * import { createBrowserScope } from '@frontmcp/browser';
 *
 * const scope = createBrowserScope({
 *   serverInfo: { name: 'my-app', version: '1.0.0' },
 * });
 *
 * // Register a tool
 * scope.registerTool({
 *   name: 'greet',
 *   description: 'Greet a user',
 *   handler: (input) => `Hello, ${input.name}!`,
 * });
 *
 * // Start the scope
 * await scope.start();
 * ```
 */
export class BrowserScope {
  readonly id: string;
  readonly serverInfo: BrowserServerInfo;
  readonly crypto: PlatformCrypto;
  readonly storage: PlatformStorage;
  readonly logger: PlatformLogger;

  private _transport: BrowserTransport | null = null;
  private _started = false;
  private readonly debug: boolean;

  // Registries
  private readonly tools = new Map<string, ScopeToolDefinition>();
  private readonly resources = new Map<string, ScopeResourceDefinition>();
  private readonly prompts = new Map<string, ScopePromptDefinition>();

  // Event handlers
  private toolChangeHandlers = new Set<(event: BrowserToolChangeEvent) => void>();
  private resourceChangeHandlers = new Set<(event: BrowserResourceChangeEvent) => void>();

  constructor(options: BrowserScopeOptions) {
    this.id = generateUUID();
    this.serverInfo = options.serverInfo;
    this.crypto = options.crypto ?? new BrowserCryptoAdapter();
    this.storage = options.storage ?? new BrowserStorageAdapter();
    this.logger = options.logger ?? consoleLogger;
    this.debug = options.debug ?? false;
    this._transport = options.transport ?? null;
  }

  /**
   * Get transport
   */
  get transport(): BrowserTransport | null {
    return this._transport;
  }

  /**
   * Set transport
   */
  setTransport(transport: BrowserTransport): void {
    this._transport = transport;
  }

  /**
   * Check if scope is started
   */
  get isStarted(): boolean {
    return this._started;
  }

  // ==========================================================================
  // Tool Registration
  // ==========================================================================

  /**
   * Register a tool
   */
  registerTool<In = unknown, Out = unknown>(definition: ScopeToolDefinition<In, Out>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }

    this.tools.set(definition.name, definition as ScopeToolDefinition);
    this.emitToolChange({ kind: 'added', toolName: definition.name });

    if (this.debug) {
      this.logger.debug(`Registered tool: ${definition.name}`);
    }
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.emitToolChange({ kind: 'removed', toolName: name });
      if (this.debug) {
        this.logger.debug(`Unregistered tool: ${name}`);
      }
    }
    return removed;
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): ScopeToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools
   */
  listTools(): ScopeToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool
   */
  async executeTool<In = unknown, Out = unknown>(name: string, input: In): Promise<Out> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    return tool.handler(input) as Promise<Out>;
  }

  /**
   * Subscribe to tool changes
   */
  onToolChange(handler: (event: BrowserToolChangeEvent) => void): () => void {
    this.toolChangeHandlers.add(handler);
    return () => this.toolChangeHandlers.delete(handler);
  }

  private emitToolChange(event: BrowserToolChangeEvent): void {
    for (const handler of this.toolChangeHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore errors in handlers
      }
    }
  }

  // ==========================================================================
  // Resource Registration
  // ==========================================================================

  /**
   * Register a resource
   */
  registerResource<T = unknown>(definition: ScopeResourceDefinition<T>): void {
    if (this.resources.has(definition.uri)) {
      throw new Error(`Resource "${definition.uri}" is already registered`);
    }

    this.resources.set(definition.uri, definition as ScopeResourceDefinition);
    this.emitResourceChange({ kind: 'added', resourceUri: definition.uri });

    if (this.debug) {
      this.logger.debug(`Registered resource: ${definition.uri}`);
    }
  }

  /**
   * Unregister a resource
   */
  unregisterResource(uri: string): boolean {
    const removed = this.resources.delete(uri);
    if (removed) {
      this.emitResourceChange({ kind: 'removed', resourceUri: uri });
      if (this.debug) {
        this.logger.debug(`Unregistered resource: ${uri}`);
      }
    }
    return removed;
  }

  /**
   * Get a resource by URI
   */
  getResource(uri: string): ScopeResourceDefinition | undefined {
    return this.resources.get(uri);
  }

  /**
   * List all resources
   */
  listResources(): ScopeResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  /**
   * Check if resource exists
   */
  hasResource(uri: string): boolean {
    return this.resources.has(uri);
  }

  /**
   * Read a resource
   */
  async readResource<T = unknown>(uri: string): Promise<T> {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new Error(`Resource "${uri}" not found`);
    }

    return resource.handler() as Promise<T>;
  }

  /**
   * Subscribe to resource changes
   */
  onResourceChange(handler: (event: BrowserResourceChangeEvent) => void): () => void {
    this.resourceChangeHandlers.add(handler);
    return () => this.resourceChangeHandlers.delete(handler);
  }

  private emitResourceChange(event: BrowserResourceChangeEvent): void {
    for (const handler of this.resourceChangeHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore errors in handlers
      }
    }
  }

  // ==========================================================================
  // Prompt Registration
  // ==========================================================================

  /**
   * Register a prompt
   */
  registerPrompt(definition: ScopePromptDefinition): void {
    if (this.prompts.has(definition.name)) {
      throw new Error(`Prompt "${definition.name}" is already registered`);
    }

    this.prompts.set(definition.name, definition);

    if (this.debug) {
      this.logger.debug(`Registered prompt: ${definition.name}`);
    }
  }

  /**
   * Unregister a prompt
   */
  unregisterPrompt(name: string): boolean {
    const removed = this.prompts.delete(name);
    if (removed && this.debug) {
      this.logger.debug(`Unregistered prompt: ${name}`);
    }
    return removed;
  }

  /**
   * Get a prompt by name
   */
  getPrompt(name: string): ScopePromptDefinition | undefined {
    return this.prompts.get(name);
  }

  /**
   * List all prompts
   */
  listPrompts(): ScopePromptDefinition[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Check if prompt exists
   */
  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }

  /**
   * Execute a prompt
   */
  async executePrompt(name: string, args: Record<string, string>): Promise<string> {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new Error(`Prompt "${name}" not found`);
    }

    return prompt.handler(args);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the scope
   */
  async start(): Promise<void> {
    if (this._started) {
      return;
    }

    if (this._transport) {
      await this._transport.connect();
    }

    this._started = true;
    this.logger.info(`Browser scope started: ${this.serverInfo.name} v${this.serverInfo.version}`);
  }

  /**
   * Stop the scope
   */
  async stop(): Promise<void> {
    if (!this._started) {
      return;
    }

    if (this._transport) {
      this._transport.destroy('Scope stopped');
    }

    this._started = false;
    this.logger.info(`Browser scope stopped: ${this.serverInfo.name}`);
  }

  /**
   * Get scope capabilities
   */
  getCapabilities(): BrowserScopeCapabilities {
    return {
      tools: {
        listChanged: this.tools.size > 0,
      },
      resources: {
        subscribe: false,
        listChanged: this.resources.size > 0,
      },
      prompts: {
        listChanged: this.prompts.size > 0,
      },
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Clear all registrations
   */
  clear(): void {
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();

    if (this.debug) {
      this.logger.debug('Cleared all registrations');
    }
  }

  /**
   * Get statistics
   */
  getStats(): { tools: number; resources: number; prompts: number } {
    return {
      tools: this.tools.size,
      resources: this.resources.size,
      prompts: this.prompts.size,
    };
  }
}

/**
 * Create a browser scope
 *
 * @example
 * ```typescript
 * const scope = createBrowserScope({
 *   serverInfo: { name: 'my-app', version: '1.0.0' },
 *   debug: true,
 * });
 *
 * scope.registerTool({
 *   name: 'greet',
 *   description: 'Greet a user',
 *   handler: ({ name }) => `Hello, ${name}!`,
 * });
 *
 * await scope.start();
 * ```
 */
export function createBrowserScope(options: BrowserScopeOptions): BrowserScope {
  return new BrowserScope(options);
}
