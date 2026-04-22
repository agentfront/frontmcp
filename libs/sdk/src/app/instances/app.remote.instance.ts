/**
 * @file app.remote.instance.ts
 * @description Remote MCP app instance that proxies to a remote MCP server
 *
 * This implementation uses standard registries (ToolRegistry, ResourceRegistry, PromptRegistry)
 * like local apps, but with lazy capability discovery and TTL-based caching.
 */

import { idFromString } from '@frontmcp/utils';

import {
  AppEntry,
  type AdapterEntry,
  type AdapterRegistryInterface,
  type AppRecord,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type PluginEntry,
  type PluginRegistryInterface,
  type ProviderRegistryInterface,
  type RemoteAppMetadata,
  type RemoteAuthConfig,
  type SkillEntry,
} from '../../common';
import PromptRegistry from '../../prompt/prompt.registry';
import type ProviderRegistry from '../../provider/provider.registry';
import { McpClientService } from '../../remote-mcp';
import { CapabilityCache } from '../../remote-mcp/cache';
import {
  createRemotePromptInstance,
  createRemoteResourceInstance,
  createRemoteResourceTemplateInstance,
  createRemoteToolInstance,
} from '../../remote-mcp/factories';
import type { McpConnectRequest, McpRemoteAuthConfig, McpTransportType } from '../../remote-mcp/mcp-client.types';
import ResourceRegistry from '../../resource/resource.registry';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import ToolRegistry from '../../tool/tool.registry';
import { diffRemoved } from './diff-remote-capabilities';
import { resolveRemoteAppOwner, type ResolveAppsLike } from './resolve-remote-app-owner';

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

  getPluginNames(): string[] {
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

/**
 * Empty skill registry for remote apps (remote apps don't support skills yet)
 */
class EmptySkillRegistry implements SkillRegistryInterface {
  readonly owner = { kind: 'app' as const, id: '_remote', ref: EmptySkillRegistry };
  getSkills(): SkillEntry[] {
    return [];
  }
  findByName(): SkillEntry | undefined {
    return undefined;
  }
  findByQualifiedName(): SkillEntry | undefined {
    return undefined;
  }
  async search(): Promise<[]> {
    return [];
  }
  async loadSkill(): Promise<undefined> {
    return undefined;
  }
  async listSkills() {
    return { skills: [], total: 0, hasMore: false };
  }
  hasAny(): boolean {
    return false;
  }
  async count(): Promise<number> {
    return 0;
  }
  subscribe(): () => void {
    return () => {};
  }
  getCapabilities() {
    return {};
  }
  async validateAllTools() {
    // Empty registry - no skills to validate
    return {
      results: [],
      isValid: true,
      totalSkills: 0,
      failedCount: 0,
      warningCount: 0,
    };
  }
  async syncToExternal() {
    // Empty registry - no skills to sync
    return null;
  }
  getExternalProvider() {
    return undefined;
  }
  hasExternalProvider() {
    return false;
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
  private readonly _skills: EmptySkillRegistry;

  // Connection state
  private isConnected = false;

  // Lazy loading state
  private capabilitiesLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  // Capability change subscription cleanup
  private _unsubscribeCapability?: () => void;

  // Connection change subscription cleanup — fires clearCapabilities
  // when the MCP client reports our appId as disconnected, so registry
  // state stays in sync with connection lifecycle without waiting for
  // the next capability refresh cycle.
  private _unsubscribeConnection?: () => void;

  // Previous-capability snapshots per kind, keyed by qualified name
  // (namespace + remote name). Used by the diff-on-refresh path to
  // detect removals between refreshes so the registry drops tools the
  // remote server no longer advertises. Tokens are stored so unregister
  // can be called directly without re-deriving from metadata.
  private previousToolTokens: Map<string, unknown> = new Map();
  private previousResourceTokens: Map<string, unknown> = new Map();
  private previousPromptTokens: Map<string, unknown> = new Map();

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
    const cacheTTL = this.metadata.cacheTTL ?? 60000; // Default 60 seconds
    this.capabilityCache = new CapabilityCache({ defaultTTL: cacheTTL });

    // Initialize standard registries (empty initially - populated lazily)
    this._tools = new ToolRegistry(this.scopeProviders, [], this.appOwner);
    this._resources = new ResourceRegistry(this.scopeProviders, [], this.appOwner);
    this._prompts = new PromptRegistry(this.scopeProviders, [], this.appOwner);
    this._plugins = new EmptyPluginRegistry();
    this._adapters = new EmptyAdapterRegistry();
    this._skills = new EmptySkillRegistry();

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

      // Subscribe to connection lifecycle so a `disconnected` event drops
      // this app's capabilities from the local registry without waiting
      // for a capability refresh cycle. Keeps local state in sync with
      // the MCP client's connection state.
      this._unsubscribeConnection = this.mcpClient.onConnectionChange((appId, status) => {
        if (appId !== this.id) return;
        if (status === 'disconnected' || status === 'error') {
          logger.info(`Remote app ${this.id} ${status} — clearing capabilities from registry`);
          this.clearCapabilities();
          this.capabilityCache.invalidate(this.id);
          this.capabilitiesLoaded = false;
          this.isConnected = false;
        } else if (status === 'connected') {
          this.isConnected = true;
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

  override get tools(): ToolRegistry {
    return this._tools;
  }

  override get resources(): ResourceRegistry {
    return this._resources;
  }

  override get prompts(): PromptRegistry {
    return this._prompts;
  }

  override get skills(): SkillRegistryInterface {
    return this._skills;
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
   * Resolve the effective owner for registered capabilities. Delegates to
   * the pure `resolveRemoteAppOwner` helper so the lookup logic stays
   * unit-testable without spinning up a full remote-app instance.
   */
  private resolveEffectiveOwner(): EntryOwnerRef {
    const scope = this.scopeProviders.getActiveScope();
    return resolveRemoteAppOwner({
      ownerAppName: this.metadata.ownerAppName,
      fallback: this.appOwner,
      apps: (scope as unknown as { apps?: ResolveAppsLike }).apps,
      logger: scope.logger,
      remoteId: this.id,
    });
  }

  /**
   * Discover remote capabilities and register them in standard registries.
   */
  private async discoverAndRegisterCapabilities(): Promise<void> {
    const logger = this.scopeProviders.getActiveScope().logger;
    const namespace = this.metadata.namespace || this.metadata.name;
    const effectiveOwner = this.resolveEffectiveOwner();

    // Try to use cached capabilities
    let capabilities = this.capabilityCache.get(this.id);

    if (!capabilities) {
      // Fetch from remote server
      logger.debug(`Fetching capabilities for remote app ${this.id}`);
      capabilities = await this.mcpClient.discoverCapabilities(this.id);

      // Cache the capabilities
      const cacheTTL = this.metadata.cacheTTL ?? 60000;
      this.capabilityCache.set(this.id, capabilities, cacheTTL);
    } else {
      logger.debug(`Using cached capabilities for remote app ${this.id}`);
    }

    // Diff-on-refresh: compute the fresh snapshot (qualifiedName → token)
    // BEFORE registering so we can decide which previously-registered
    // entries are now stale. Registrations themselves are idempotent by
    // token, so re-registering the unchanged ones is free.
    const nextToolTokens = new Map<string, unknown>();
    const nextResourceTokens = new Map<string, unknown>();
    const nextPromptTokens = new Map<string, unknown>();

    // Register tools using standard ToolInstance with dynamic context class
    for (const remoteTool of capabilities.tools) {
      const toolInstance = createRemoteToolInstance(
        remoteTool,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        effectiveOwner,
        namespace,
      );
      await toolInstance.ready;
      this._tools.registerToolInstance(toolInstance);
      nextToolTokens.set(toolInstance.fullName ?? toolInstance.name, toolInstance.record.provide);
    }

    // Register resources using standard ResourceInstance with dynamic context class
    for (const remoteResource of capabilities.resources) {
      const resourceInstance = createRemoteResourceInstance(
        remoteResource,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        effectiveOwner,
        namespace,
      );
      await resourceInstance.ready;
      this._resources.registerResourceInstance(resourceInstance);
      nextResourceTokens.set(resourceInstance.fullName ?? resourceInstance.name, resourceInstance.record.provide);
    }

    // Register resource templates using standard ResourceInstance
    for (const remoteTemplate of capabilities.resourceTemplates) {
      const templateInstance = createRemoteResourceTemplateInstance(
        remoteTemplate,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        effectiveOwner,
        namespace,
      );
      await templateInstance.ready;
      this._resources.registerResourceInstance(templateInstance);
      nextResourceTokens.set(templateInstance.fullName ?? templateInstance.name, templateInstance.record.provide);
    }

    // Register prompts using standard PromptInstance with dynamic context class
    for (const remotePrompt of capabilities.prompts) {
      const promptInstance = createRemotePromptInstance(
        remotePrompt,
        this.mcpClient,
        this.id,
        this.scopeProviders,
        effectiveOwner,
        namespace,
      );
      await promptInstance.ready;
      this._prompts.registerPromptInstance(promptInstance);
      nextPromptTokens.set(promptInstance.fullName ?? promptInstance.name, promptInstance.record.provide);
    }

    // Diff: for every kind, anything in the previous snapshot missing
    // from the fresh one is an admin-side removal (or a remote rename).
    // Unregister it — the registries emit `bump('removed')` and any
    // subscriber (plugin sync coordinator, tool list responses) sees it.
    const removedTools = diffRemoved(this.previousToolTokens, nextToolTokens);
    for (const [qualifiedName, token] of removedTools) {
      this._tools.unregisterToolInstance(token as never);
      logger.debug(`Remote app ${this.id}: unregistered tool '${qualifiedName}' (no longer advertised)`);
    }
    const removedResources = diffRemoved(this.previousResourceTokens, nextResourceTokens);
    for (const [qualifiedName, token] of removedResources) {
      this._resources.unregisterResourceInstance(token as never);
      logger.debug(`Remote app ${this.id}: unregistered resource '${qualifiedName}' (no longer advertised)`);
    }
    const removedPrompts = diffRemoved(this.previousPromptTokens, nextPromptTokens);
    for (const [qualifiedName, token] of removedPrompts) {
      this._prompts.unregisterPromptInstance(token as never);
      logger.debug(`Remote app ${this.id}: unregistered prompt '${qualifiedName}' (no longer advertised)`);
    }

    this.previousToolTokens = nextToolTokens;
    this.previousResourceTokens = nextResourceTokens;
    this.previousPromptTokens = nextPromptTokens;

    logger.info(
      `Remote app ${this.id} capabilities loaded: ${capabilities.tools.length} tools, ` +
        `${capabilities.resources.length} resources, ${capabilities.prompts.length} prompts ` +
        `(removed ${removedTools.length}/${removedResources.length}/${removedPrompts.length})`,
    );
  }

  /**
   * Unregister every capability this remote app previously registered and
   * forget its snapshots. Called by `McpClientService.disconnect` so a
   * whole-app disconnect drops the app's tools from the local registry
   * without waiting for the next capability-refresh cycle. Idempotent —
   * running again after a clean disconnect is a no-op.
   */
  clearCapabilities(): void {
    for (const [, token] of this.previousToolTokens) {
      this._tools.unregisterToolInstance(token as never);
    }
    for (const [, token] of this.previousResourceTokens) {
      this._resources.unregisterResourceInstance(token as never);
    }
    for (const [, token] of this.previousPromptTokens) {
      this._prompts.unregisterPromptInstance(token as never);
    }
    this.previousToolTokens = new Map();
    this.previousResourceTokens = new Map();
    this.previousPromptTokens = new Map();
  }
}
