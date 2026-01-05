/**
 * @file app.remote.instance.ts
 * @description Remote MCP app instance that proxies to a remote MCP server
 */

import {
  AdapterRegistryInterface,
  AppEntry,
  AppRecord,
  PluginRegistryInterface,
  PromptRegistryInterface,
  ProviderRegistryInterface,
  RemoteAppMetadata,
  RemoteAuthConfig,
  ResourceRegistryInterface,
  ToolRegistryInterface,
  EntryOwnerRef,
  ToolEntry,
  ResourceEntry,
  PromptEntry,
  PluginEntry,
  AdapterEntry,
  FrontMcpLogger,
} from '../../common';
import { idFromString } from '@frontmcp/utils';
import ProviderRegistry from '../../provider/provider.registry';
import { McpClientService } from '../../remote';
import type { McpConnectRequest, McpTransportType, McpRemoteAuthConfig } from '../../remote/mcp-client.types';
import { createProxyToolEntry, ProxyToolEntry } from '../../remote/entries/proxy-tool.entry';
import { createProxyResourceEntry, ProxyResourceEntry } from '../../remote/entries/proxy-resource.entry';
import { createProxyPromptEntry, ProxyPromptEntry } from '../../remote/entries/proxy-prompt.entry';
import type { ToolChangeEvent, ToolChangeKind, ToolChangeScope } from '../../tool/tool.events';
import type { ToolInstance } from '../../tool/tool.instance';

/**
 * Interface for scope with optional MCP client service cache.
 * Used for proper typing in getOrCreateMcpClientService.
 */
interface ScopeWithMcpClient {
  logger: FrontMcpLogger;
  mcpClientService?: McpClientService;
}

// ═══════════════════════════════════════════════════════════════════
// PROXY REGISTRY IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Lightweight tool registry that exposes proxy tools from a remote server
 */
class RemoteToolRegistry implements ToolRegistryInterface {
  readonly owner: EntryOwnerRef;
  private readonly tools: Map<string, ProxyToolEntry> = new Map();
  private readonly subscribers: Set<(evt: ToolChangeEvent) => void> = new Set();
  private version = 0;

  constructor(owner: EntryOwnerRef) {
    this.owner = owner;
  }

  addTool(tool: ProxyToolEntry): void {
    this.tools.set(tool.name, tool);
    this.notifySubscribers('added');
  }

  removeTool(name: string): void {
    if (this.tools.has(name)) {
      this.tools.delete(name);
      this.notifySubscribers('removed');
    }
  }

  clear(): void {
    this.tools.clear();
    this.notifySubscribers('reset');
  }

  getTools(_includeHidden?: boolean): ToolEntry[] {
    return Array.from(this.tools.values());
  }

  getInlineTools(): ToolEntry[] {
    return this.getTools();
  }

  subscribe(
    opts: { immediate?: boolean; filter?: (i: ToolEntry) => boolean },
    cb: (evt: ToolChangeEvent) => void,
  ): () => void {
    this.subscribers.add(cb);

    if (opts.immediate) {
      // Emit a single 'reset' event with all matching tools as snapshot
      const matchingTools = Array.from(this.tools.values()).filter((t) => !opts.filter || opts.filter(t));
      if (matchingTools.length > 0) {
        cb(this.createEvent('reset', matchingTools));
      }
    }

    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notifySubscribers(kind: ToolChangeKind): void {
    const snapshot = Array.from(this.tools.values());
    const event = this.createEvent(kind, snapshot);
    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private createEvent(kind: ToolChangeKind, snapshot: ProxyToolEntry[]): ToolChangeEvent {
    this.version++;
    return {
      kind,
      changeScope: 'global' as ToolChangeScope,
      version: this.version,
      // Cast proxy entries as ToolInstance - they implement the same interface
      snapshot: snapshot as unknown as readonly ToolInstance[],
    };
  }
}

/**
 * Lightweight resource registry that exposes proxy resources from a remote server
 */
class RemoteResourceRegistry implements ResourceRegistryInterface {
  readonly owner: EntryOwnerRef;
  private readonly resources: Map<string, ProxyResourceEntry> = new Map();
  private readonly templates: Map<string, ProxyResourceEntry> = new Map();

  constructor(owner: EntryOwnerRef) {
    this.owner = owner;
  }

  addResource(resource: ProxyResourceEntry): void {
    if (resource.isTemplate) {
      this.templates.set(resource.name, resource);
    } else {
      this.resources.set(resource.name, resource);
    }
  }

  clear(): void {
    this.resources.clear();
    this.templates.clear();
  }

  getResources(_includeHidden?: boolean): ResourceEntry[] {
    return Array.from(this.resources.values());
  }

  getResourceTemplates(): ResourceEntry[] {
    return Array.from(this.templates.values());
  }

  getInlineResources(): ResourceEntry[] {
    return [...this.getResources(), ...this.getResourceTemplates()];
  }

  findResourceForUri(uri: string): { instance: ResourceEntry; params: Record<string, string> } | undefined {
    // Check exact match first
    for (const resource of this.resources.values()) {
      const { matches, params } = resource.matchUri(uri);
      if (matches) {
        return { instance: resource, params };
      }
    }

    // Check templates
    for (const template of this.templates.values()) {
      const { matches, params } = template.matchUri(uri);
      if (matches) {
        return { instance: template, params };
      }
    }

    return undefined;
  }
}

/**
 * Lightweight prompt registry that exposes proxy prompts from a remote server
 */
class RemotePromptRegistry implements PromptRegistryInterface {
  readonly owner: EntryOwnerRef;
  private readonly prompts: Map<string, ProxyPromptEntry> = new Map();

  constructor(owner: EntryOwnerRef) {
    this.owner = owner;
  }

  addPrompt(prompt: ProxyPromptEntry): void {
    this.prompts.set(prompt.name, prompt);
  }

  clear(): void {
    this.prompts.clear();
  }

  getPrompts(_includeHidden?: boolean): PromptEntry[] {
    return Array.from(this.prompts.values());
  }

  getInlinePrompts(): PromptEntry[] {
    return this.getPrompts();
  }

  findByName(name: string): PromptEntry | undefined {
    return this.prompts.get(name);
  }
}

/**
 * Empty plugin registry for remote apps (remote apps don't have local plugins)
 */
class EmptyPluginRegistry implements PluginRegistryInterface {
  getPlugins(): PluginEntry[] {
    return [];
  }
}

/**
 * Empty adapter registry for remote apps (remote apps don't have local adapters)
 */
class EmptyAdapterRegistry implements AdapterRegistryInterface {
  getAdapters(): AdapterEntry[] {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// APP REMOTE INSTANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Remote MCP app instance that connects to and proxies a remote MCP server.
 *
 * This class:
 * - Connects to a remote MCP server using McpClientService
 * - Discovers remote capabilities (tools, resources, prompts)
 * - Creates proxy entries that forward execution to the remote server
 * - Exposes remote capabilities as first-class entries to the gateway
 * - Integrates with gateway hooks (cache, auth, audit)
 */
export class AppRemoteInstance extends AppEntry<RemoteAppMetadata> {
  override readonly id: string;

  private readonly scopeProviders: ProviderRegistry;
  private readonly mcpClient: McpClientService;
  private readonly appOwner: EntryOwnerRef;

  // Proxy registries
  private readonly _tools: RemoteToolRegistry;
  private readonly _resources: RemoteResourceRegistry;
  private readonly _prompts: RemotePromptRegistry;
  private readonly _plugins: EmptyPluginRegistry;
  private readonly _adapters: EmptyAdapterRegistry;

  // Connection state
  private isConnected = false;

  // Capability change subscription cleanup
  private _unsubscribeCapability?: () => void;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.id = this.metadata.id ?? idFromString(this.metadata.name);
    this.scopeProviders = scopeProviders;

    // Create app owner reference
    this.appOwner = {
      kind: 'app',
      id: this.id,
      ref: this.token,
    };

    // Initialize proxy registries
    this._tools = new RemoteToolRegistry(this.appOwner);
    this._resources = new RemoteResourceRegistry(this.appOwner);
    this._prompts = new RemotePromptRegistry(this.appOwner);
    this._plugins = new EmptyPluginRegistry();
    this._adapters = new EmptyAdapterRegistry();

    // Get or create MCP client service
    const scope = this.scopeProviders.getActiveScope();
    this.mcpClient = this.getOrCreateMcpClientService(scope);

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    logger.info(`Initializing remote app: ${this.id} (${this.metadata.url})`);

    try {
      // Build connection request
      const connectRequest = this.buildConnectRequest();

      // Connect to remote server
      await this.mcpClient.connect(connectRequest);
      this.isConnected = true;

      // Discover and create proxy entries
      await this.discoverAndCreateProxies();

      // Subscribe to capability changes and store unsubscribe function to prevent memory leak
      this._unsubscribeCapability = this.mcpClient.onCapabilityChange((event) => {
        if (event.appId === this.id) {
          logger.info(`Remote capabilities changed for ${this.id}: ${event.kind}`);
          // Refresh proxies when capabilities change
          this.discoverAndCreateProxies().catch((err) => {
            logger.error(`Failed to refresh proxies for ${this.id}: ${err.message}`);
          });
        }
      });

      logger.info(
        `Remote app ${this.id} initialized: ${this._tools.getTools().length} tools, ` +
          `${this._resources.getResources().length} resources, ${this._prompts.getPrompts().length} prompts`,
      );
    } catch (error) {
      logger.error(`Failed to initialize remote app ${this.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  override get providers(): ProviderRegistryInterface {
    return this.scopeProviders;
  }

  override get adapters(): AdapterRegistryInterface {
    return this._adapters;
  }

  override get plugins(): PluginRegistryInterface {
    return this._plugins;
  }

  override get tools(): ToolRegistryInterface {
    return this._tools;
  }

  override get resources(): ResourceRegistryInterface {
    return this._resources;
  }

  override get prompts(): PromptRegistryInterface {
    return this._prompts;
  }

  /**
   * Get the MCP client service for this remote app
   */
  getMcpClient(): McpClientService {
    return this.mcpClient;
  }

  /**
   * Check if this remote app is connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from the remote server
   */
  async disconnect(): Promise<void> {
    // Unsubscribe from capability changes to prevent memory leak
    if (this._unsubscribeCapability) {
      this._unsubscribeCapability();
      this._unsubscribeCapability = undefined;
    }

    if (this.isConnected) {
      await this.mcpClient.disconnect(this.id);
      this.isConnected = false;
      this._tools.clear();
      this._resources.clear();
      this._prompts.clear();
    }
  }

  /**
   * Reconnect to the remote server
   */
  async reconnect(): Promise<void> {
    await this.mcpClient.reconnect(this.id);
    this.isConnected = true;
    await this.discoverAndCreateProxies();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get or create the MCP client service from scope
   */
  private getOrCreateMcpClientService(scope: ScopeWithMcpClient): McpClientService {
    // Try to get existing service from scope
    const existingService = scope.mcpClientService;
    if (existingService) {
      return existingService;
    }

    // Create new service
    const service = new McpClientService(scope.logger, {
      capabilityRefreshInterval: this.metadata.refreshInterval ?? 0,
    });

    // Store on scope for reuse
    scope.mcpClientService = service;

    return service;
  }

  /**
   * Build the connection request from metadata
   */
  private buildConnectRequest(): McpConnectRequest {
    const transportType = this.mapUrlTypeToTransportType(this.metadata.urlType);

    return {
      appId: this.id,
      name: this.metadata.name,
      transportType,
      url: this.metadata.url,
      transportOptions: {
        timeout: this.metadata.transportOptions?.timeout,
        retryAttempts: this.metadata.transportOptions?.retryAttempts,
        retryDelayMs: this.metadata.transportOptions?.retryDelayMs,
        fallbackToSSE: this.metadata.transportOptions?.fallbackToSSE,
        headers: this.metadata.transportOptions?.headers,
      },
      auth: this.mapRemoteAuth(this.metadata.remoteAuth),
      namespace: this.metadata.namespace,
    };
  }

  /**
   * Map urlType to transport type
   */
  private mapUrlTypeToTransportType(urlType: 'worker' | 'url' | 'npm' | 'esm'): McpTransportType {
    switch (urlType) {
      case 'url':
        return 'http';
      case 'worker':
        return 'worker';
      case 'npm':
        return 'npm';
      case 'esm':
        return 'esm';
      default:
        return 'http';
    }
  }

  /**
   * Map remote auth config from metadata format to MCP client format
   */
  private mapRemoteAuth(remoteAuth?: RemoteAuthConfig): McpRemoteAuthConfig | undefined {
    if (!remoteAuth) {
      return undefined;
    }
    // RemoteAuthConfig and McpRemoteAuthConfig have the same structure
    return remoteAuth as McpRemoteAuthConfig;
  }

  /**
   * Discover remote capabilities and create proxy entries
   */
  private async discoverAndCreateProxies(): Promise<void> {
    // Clear existing proxies
    this._tools.clear();
    this._resources.clear();
    this._prompts.clear();

    // Discover capabilities
    const capabilities = await this.mcpClient.discoverCapabilities(this.id);
    const namespace = this.metadata.namespace || this.metadata.name;

    // Create proxy tools
    for (const remoteTool of capabilities.tools) {
      const proxyTool = createProxyToolEntry(
        remoteTool,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await proxyTool.ready;
      this._tools.addTool(proxyTool);
    }

    // Create proxy resources
    for (const remoteResource of capabilities.resources) {
      const proxyResource = createProxyResourceEntry(
        remoteResource,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await proxyResource.ready;
      this._resources.addResource(proxyResource);
    }

    // Create proxy resource templates
    for (const remoteTemplate of capabilities.resourceTemplates) {
      const proxyTemplate = createProxyResourceEntry(
        remoteTemplate,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await proxyTemplate.ready;
      this._resources.addResource(proxyTemplate);
    }

    // Create proxy prompts
    for (const remotePrompt of capabilities.prompts) {
      const proxyPrompt = createProxyPromptEntry(
        remotePrompt,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await proxyPrompt.ready;
      this._prompts.addPrompt(proxyPrompt);
    }
  }
}
