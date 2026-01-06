/**
 * @file app.remote.instance.ts
 * @description Remote MCP app instance that proxies to a remote MCP server
 *
 * This implementation uses standard registries (ToolRegistry, ResourceRegistry, PromptRegistry)
 * like local apps, but with lazy capability discovery and TTL-based caching.
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
  PluginEntry,
  AdapterEntry,
  FrontMcpLogger,
} from '../../common';
import { idFromString } from '@frontmcp/utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import { McpClientService } from '../../remote-mcp';
import { CapabilityCache } from '../../remote-mcp/cache';
import {
  createRemoteToolInstance,
  createRemoteResourceInstance,
  createRemoteResourceTemplateInstance,
  createRemotePromptInstance,
} from '../../remote-mcp/factories';
import type { McpConnectRequest, McpTransportType, McpRemoteAuthConfig } from '../../remote-mcp/mcp-client.types';

/**
 * Interface for scope with optional MCP client service cache.
 * Used for proper typing in getOrCreateMcpClientService.
 */
interface ScopeWithMcpClient {
  logger: FrontMcpLogger;
  mcpClientService?: McpClientService;
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
 * This class uses standard registries (ToolRegistry, ResourceRegistry, PromptRegistry)
 * like local apps, providing consistent behavior for:
 * - Hook lifecycle (beforeExec, afterExec)
 * - Tool/resource/prompt discovery
 * - Change event notifications
 *
 * Key features:
 * - Lazy capability discovery: Capabilities are discovered on first access
 * - TTL-based caching: Capabilities are cached with configurable TTL
 * - Full hook support: Remote tools participate in the hook lifecycle
 */
export class AppRemoteInstance extends AppEntry<RemoteAppMetadata> {
  override readonly id: string;

  /**
   * Remote apps return true to indicate entries should be adopted directly
   * from the app's registries rather than through child registry hierarchy.
   */
  override get isRemote(): boolean {
    return true;
  }

  private readonly scopeProviders: ProviderRegistry;
  private readonly mcpClient: McpClientService;
  private readonly appOwner: EntryOwnerRef;
  private readonly capabilityCache: CapabilityCache;

  // Standard registries (like local apps)
  private readonly _tools: ToolRegistry;
  private readonly _resources: ResourceRegistry;
  private readonly _prompts: PromptRegistry;
  private readonly _plugins: EmptyPluginRegistry;
  private readonly _adapters: EmptyAdapterRegistry;

  // Connection state
  private isConnected = false;

  // Lazy loading state
  private capabilitiesLoaded = false;
  private loadingPromise: Promise<void> | null = null;

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

    // Initialize capability cache with configurable TTL
    const cacheTTL = (this.metadata as any).cacheTTL ?? 60000; // Default 60 seconds
    this.capabilityCache = new CapabilityCache({ defaultTTL: cacheTTL });

    // Initialize standard registries (empty initially - populated lazily)
    this._tools = new ToolRegistry(this.scopeProviders, [], this.appOwner);
    this._resources = new ResourceRegistry(this.scopeProviders, [], this.appOwner);
    this._prompts = new PromptRegistry(this.scopeProviders, [], this.appOwner);
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
      // Wait for registries to be ready
      await Promise.all([this._tools.ready, this._resources.ready, this._prompts.ready]);

      // Build connection request
      const connectRequest = this.buildConnectRequest();

      // Connect to remote server
      await this.mcpClient.connect(connectRequest);
      this.isConnected = true;

      // Subscribe to capability changes
      this._unsubscribeCapability = this.mcpClient.onCapabilityChange((event) => {
        if (event.appId === this.id) {
          logger.info(`Remote capabilities changed for ${this.id}: ${event.kind}`);
          // Invalidate cache and trigger reload on next access
          this.capabilityCache.invalidate(this.id);
          this.capabilitiesLoaded = false;
        }
      });

      logger.info(`Remote app ${this.id} connected. Capabilities will be loaded lazily.`);
    } catch (error) {
      logger.error(`Failed to initialize remote app ${this.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LAZY CAPABILITY LOADING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Ensure capabilities are loaded, using cache if available.
   * This is called lazily when tools/resources/prompts are accessed.
   */
  async ensureCapabilitiesLoaded(): Promise<void> {
    // Check if already loaded and cache is valid
    if (this.capabilitiesLoaded && !this.capabilityCache.isExpired(this.id)) {
      return;
    }

    // Check if a loading operation is already in progress
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    // Start loading
    this.loadingPromise = this.discoverAndRegisterCapabilities();
    try {
      await this.loadingPromise;
      this.capabilitiesLoaded = true;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Force refresh capabilities from the remote server.
   */
  async refreshCapabilities(): Promise<void> {
    this.capabilityCache.invalidate(this.id);
    this.capabilitiesLoaded = false;
    await this.ensureCapabilitiesLoaded();
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
   * Check if capabilities have been loaded
   */
  getCapabilitiesLoaded(): boolean {
    return this.capabilitiesLoaded;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalEntries: number; activeEntries: number; expiredEntries: number } {
    return this.capabilityCache.getStats();
  }

  /**
   * Disconnect from the remote server
   */
  async disconnect(): Promise<void> {
    // Unsubscribe from capability changes
    if (this._unsubscribeCapability) {
      this._unsubscribeCapability();
      this._unsubscribeCapability = undefined;
    }

    if (this.isConnected) {
      await this.mcpClient.disconnect(this.id);
      this.isConnected = false;
      this.capabilitiesLoaded = false;
      this.capabilityCache.invalidate(this.id);
    }
  }

  /**
   * Reconnect to the remote server
   */
  async reconnect(): Promise<void> {
    await this.mcpClient.reconnect(this.id);
    this.isConnected = true;
    this.capabilitiesLoaded = false;
    this.capabilityCache.invalidate(this.id);
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
    return remoteAuth as McpRemoteAuthConfig;
  }

  /**
   * Discover remote capabilities and register them in standard registries.
   */
  private async discoverAndRegisterCapabilities(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    const namespace = this.metadata.namespace || this.metadata.name;

    // Try to use cached capabilities
    let capabilities = this.capabilityCache.get(this.id);

    if (!capabilities) {
      // Fetch from remote server
      logger.debug(`Fetching capabilities for remote app ${this.id}`);
      capabilities = await this.mcpClient.discoverCapabilities(this.id);

      // Cache the capabilities
      const cacheTTL = (this.metadata as any).cacheTTL ?? 60000;
      this.capabilityCache.set(this.id, capabilities, cacheTTL);
    } else {
      logger.debug(`Using cached capabilities for remote app ${this.id}`);
    }

    // Register tools using standard ToolInstance with dynamic context class
    for (const remoteTool of capabilities.tools) {
      const toolInstance = createRemoteToolInstance(
        remoteTool,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await toolInstance.ready;
      this._tools.registerToolInstance(toolInstance);
    }

    // Register resources using standard ResourceInstance with dynamic context class
    for (const remoteResource of capabilities.resources) {
      const resourceInstance = createRemoteResourceInstance(
        remoteResource,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await resourceInstance.ready;
      this._resources.registerResourceInstance(resourceInstance);
    }

    // Register resource templates using standard ResourceInstance
    for (const remoteTemplate of capabilities.resourceTemplates) {
      const templateInstance = createRemoteResourceTemplateInstance(
        remoteTemplate,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await templateInstance.ready;
      this._resources.registerResourceInstance(templateInstance);
    }

    // Register prompts using standard PromptInstance with dynamic context class
    for (const remotePrompt of capabilities.prompts) {
      const promptInstance = createRemotePromptInstance(
        remotePrompt,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        this.appOwner,
        namespace,
      );
      await promptInstance.ready;
      this._prompts.registerPromptInstance(promptInstance);
    }

    logger.info(
      `Remote app ${this.id} capabilities loaded: ${capabilities.tools.length} tools, ` +
        `${capabilities.resources.length} resources, ${capabilities.prompts.length} prompts`,
    );
  }
}
