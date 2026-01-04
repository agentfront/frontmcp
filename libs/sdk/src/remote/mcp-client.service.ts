/**
 * @file mcp-client.service.ts
 * @description Service for managing connections to remote MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';

import type { FrontMcpLogger } from '../common';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  McpClientConnection,
  McpConnectionStatus,
  McpConnectionInfo,
  McpClientServiceOptions,
  McpConnectRequest,
  McpRemoteCapabilities,
  McpCapabilityChangeEvent,
  McpCapabilityChangeCallback,
  McpConnectionChangeCallback,
  McpUnsubscribeFn,
  McpRemoteAuthConfig,
  McpRemoteAuthContext,
  McpStaticCredentials,
  McpHttpTransportOptions,
} from './mcp-client.types';

import {
  RemoteConnectionError,
  RemoteDisconnectError,
  RemoteTimeoutError,
  RemoteToolNotFoundError,
  RemoteResourceNotFoundError,
  RemotePromptNotFoundError,
  RemoteToolExecutionError,
  RemoteResourceReadError,
  RemotePromptGetError,
  RemoteCapabilityDiscoveryError,
  RemoteNotConnectedError,
  RemoteAuthError,
} from '../errors/remote.errors';

// Default service options
const DEFAULT_OPTIONS: Required<McpClientServiceOptions> = {
  defaultTimeout: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
  capabilityRefreshInterval: 0,
  debug: false,
};

/**
 * Service for managing connections to remote MCP servers.
 *
 * This service handles:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Capability discovery (tools, resources, prompts)
 * - Proxy execution (callTool, readResource, getPrompt)
 * - Authentication context forwarding
 * - Event subscriptions for capability and connection changes
 */
export class McpClientService {
  private readonly connections: Map<string, McpClientConnection> = new Map();
  private readonly capabilities: Map<string, McpRemoteCapabilities> = new Map();
  private readonly configs: Map<string, McpConnectRequest> = new Map();
  private readonly options: Required<McpClientServiceOptions>;
  private readonly logger: FrontMcpLogger;

  // Event callbacks
  private readonly capabilityChangeCallbacks: Set<McpCapabilityChangeCallback> = new Set();
  private readonly connectionChangeCallbacks: Set<McpConnectionChangeCallback> = new Set();

  // Refresh timers
  private readonly refreshTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(logger: FrontMcpLogger, options: McpClientServiceOptions = {}) {
    this.logger = logger.child('McpClientService');
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Connect to a remote MCP server
   */
  async connect(request: McpConnectRequest): Promise<McpClientConnection> {
    const { appId, name, url, transportType } = request;

    this.logger.info(`Connecting to remote MCP server: ${appId} at ${url}`);

    // Check if already connected
    const existing = this.connections.get(appId);
    if (existing && existing.status === 'connected') {
      this.logger.debug(`Already connected to ${appId}`);
      return existing;
    }

    // Store config for reconnection
    this.configs.set(appId, request);

    // Update status
    this.updateConnectionStatus(appId, 'connecting');

    try {
      // Create transport based on type
      const transport = await this.createTransport(request);

      // Create MCP client
      const client = new Client(
        {
          name: `frontmcp-gateway`,
          version: '1.0.0',
        },
        {
          capabilities: {
            // We support receiving notifications
          },
        },
      );

      // Connect to server
      await client.connect(transport);

      // Create connection object
      const connection: McpClientConnection = {
        client,
        transport,
        status: 'connected',
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        capabilities: client.getServerCapabilities(),
      };

      // Store connection
      this.connections.set(appId, connection);

      // Discover capabilities
      await this.discoverCapabilities(appId);

      // Set up capability refresh if configured
      if (this.options.capabilityRefreshInterval > 0) {
        this.startCapabilityRefresh(appId);
      }

      // Notify listeners
      this.updateConnectionStatus(appId, 'connected');

      this.logger.info(`Connected to remote MCP server: ${appId}`);

      return connection;
    } catch (error) {
      this.updateConnectionStatus(appId, 'error', error as Error);
      throw new RemoteConnectionError(appId, url, error as Error);
    }
  }

  /**
   * Disconnect from a remote MCP server
   */
  async disconnect(appId: string): Promise<void> {
    this.logger.info(`Disconnecting from remote MCP server: ${appId}`);

    // Stop refresh timer
    this.stopCapabilityRefresh(appId);

    const connection = this.connections.get(appId);
    if (!connection) {
      this.logger.debug(`No connection found for ${appId}`);
      return;
    }

    try {
      await connection.client.close();
    } catch (error) {
      this.logger.warn(`Error closing connection to ${appId}: ${(error as Error).message}`);
    }

    // Clean up
    this.connections.delete(appId);
    this.capabilities.delete(appId);
    this.configs.delete(appId);

    this.updateConnectionStatus(appId, 'disconnected');

    this.logger.info(`Disconnected from remote MCP server: ${appId}`);
  }

  /**
   * Reconnect to a remote MCP server
   */
  async reconnect(appId: string): Promise<McpClientConnection> {
    this.logger.info(`Reconnecting to remote MCP server: ${appId}`);

    const config = this.configs.get(appId);
    if (!config) {
      throw new RemoteNotConnectedError(appId);
    }

    // Disconnect first
    await this.disconnect(appId);

    // Reconnect
    return this.connect(config);
  }

  /**
   * Get connection status for an app
   */
  getConnectionStatus(appId: string): McpConnectionInfo | undefined {
    const connection = this.connections.get(appId);
    if (!connection) {
      return undefined;
    }

    return {
      appId,
      status: connection.status,
      sessionId: connection.sessionId,
      connectedAt: connection.connectedAt,
      lastHeartbeat: connection.lastHeartbeat,
      capabilities: connection.capabilities,
      error: connection.lastError?.message,
    };
  }

  /**
   * Check if connected to an app
   */
  isConnected(appId: string): boolean {
    const connection = this.connections.get(appId);
    return connection?.status === 'connected';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAPABILITY DISCOVERY
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Discover capabilities from a remote server
   */
  async discoverCapabilities(appId: string): Promise<McpRemoteCapabilities> {
    this.logger.debug(`Discovering capabilities for ${appId}`);

    const connection = this.getConnection(appId);

    try {
      // Fetch all capabilities in parallel
      const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
        this.listToolsInternal(connection),
        this.listResourcesInternal(connection),
        this.listPromptsInternal(connection),
      ]);

      // Also fetch resource templates
      const resourceTemplatesResult = await this.listResourceTemplatesInternal(connection);

      const capabilities: McpRemoteCapabilities = {
        tools: toolsResult,
        resources: resourcesResult,
        resourceTemplates: resourceTemplatesResult,
        prompts: promptsResult,
        fetchedAt: new Date(),
      };

      // Store capabilities
      const previousCapabilities = this.capabilities.get(appId);
      this.capabilities.set(appId, capabilities);

      // Emit change event if capabilities changed
      if (previousCapabilities) {
        this.emitCapabilityChangeIfNeeded(appId, previousCapabilities, capabilities);
      }

      this.logger.info(
        `Discovered capabilities for ${appId}: ${capabilities.tools.length} tools, ` +
          `${capabilities.resources.length} resources, ${capabilities.prompts.length} prompts`,
      );

      return capabilities;
    } catch (error) {
      throw new RemoteCapabilityDiscoveryError(appId, error as Error);
    }
  }

  /**
   * Get cached capabilities for an app
   */
  getCapabilities(appId: string): McpRemoteCapabilities | undefined {
    return this.capabilities.get(appId);
  }

  /**
   * List tools from a remote server
   */
  async listTools(appId: string): Promise<Tool[]> {
    const cached = this.capabilities.get(appId);
    if (cached) {
      return cached.tools;
    }

    const capabilities = await this.discoverCapabilities(appId);
    return capabilities.tools;
  }

  /**
   * List resources from a remote server
   */
  async listResources(appId: string): Promise<Resource[]> {
    const cached = this.capabilities.get(appId);
    if (cached) {
      return cached.resources;
    }

    const capabilities = await this.discoverCapabilities(appId);
    return capabilities.resources;
  }

  /**
   * List resource templates from a remote server
   */
  async listResourceTemplates(appId: string): Promise<ResourceTemplate[]> {
    const cached = this.capabilities.get(appId);
    if (cached) {
      return cached.resourceTemplates;
    }

    const capabilities = await this.discoverCapabilities(appId);
    return capabilities.resourceTemplates;
  }

  /**
   * List prompts from a remote server
   */
  async listPrompts(appId: string): Promise<Prompt[]> {
    const cached = this.capabilities.get(appId);
    if (cached) {
      return cached.prompts;
    }

    const capabilities = await this.discoverCapabilities(appId);
    return capabilities.prompts;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROXY EXECUTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Call a tool on a remote server
   */
  async callTool(
    appId: string,
    toolName: string,
    args: Record<string, unknown>,
    authContext?: McpRemoteAuthContext,
  ): Promise<CallToolResult> {
    this.logger.debug(`Calling tool ${toolName} on ${appId}`);

    const connection = this.getConnection(appId);
    const startTime = Date.now();

    try {
      // Verify tool exists
      const capabilities = this.capabilities.get(appId);
      const tool = capabilities?.tools.find((t) => t.name === toolName);
      if (!tool) {
        throw new RemoteToolNotFoundError(appId, toolName);
      }

      // Call the tool
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined, // resultSchema - let the server handle it
      );

      // Update heartbeat
      connection.lastHeartbeat = new Date();

      const durationMs = Date.now() - startTime;
      this.logger.debug(`Tool ${toolName} on ${appId} completed in ${durationMs}ms`);

      // The result can be either CallToolResult with content, or a CompatibilityCallToolResult with toolResult
      // We normalize it to CallToolResult format
      return result as unknown as CallToolResult;
    } catch (error) {
      if (error instanceof RemoteToolNotFoundError) {
        throw error;
      }
      throw new RemoteToolExecutionError(appId, toolName, error as Error);
    }
  }

  /**
   * Read a resource from a remote server
   */
  async readResource(appId: string, uri: string, authContext?: McpRemoteAuthContext): Promise<ReadResourceResult> {
    this.logger.debug(`Reading resource ${uri} from ${appId}`);

    const connection = this.getConnection(appId);
    const startTime = Date.now();

    try {
      const result = await connection.client.readResource({ uri });

      // Update heartbeat
      connection.lastHeartbeat = new Date();

      const durationMs = Date.now() - startTime;
      this.logger.debug(`Resource ${uri} from ${appId} read in ${durationMs}ms`);

      return result;
    } catch (error) {
      // Check if it's a not found error
      const errorMessage = (error as Error).message?.toLowerCase() || '';
      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        throw new RemoteResourceNotFoundError(appId, uri);
      }
      throw new RemoteResourceReadError(appId, uri, error as Error);
    }
  }

  /**
   * Get a prompt from a remote server
   */
  async getPrompt(
    appId: string,
    promptName: string,
    args: Record<string, string>,
    authContext?: McpRemoteAuthContext,
  ): Promise<GetPromptResult> {
    this.logger.debug(`Getting prompt ${promptName} from ${appId}`);

    const connection = this.getConnection(appId);
    const startTime = Date.now();

    try {
      // Verify prompt exists
      const capabilities = this.capabilities.get(appId);
      const prompt = capabilities?.prompts.find((p) => p.name === promptName);
      if (!prompt) {
        throw new RemotePromptNotFoundError(appId, promptName);
      }

      const result = await connection.client.getPrompt({ name: promptName, arguments: args });

      // Update heartbeat
      connection.lastHeartbeat = new Date();

      const durationMs = Date.now() - startTime;
      this.logger.debug(`Prompt ${promptName} from ${appId} retrieved in ${durationMs}ms`);

      return result;
    } catch (error) {
      if (error instanceof RemotePromptNotFoundError) {
        throw error;
      }
      throw new RemotePromptGetError(appId, promptName, error as Error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Subscribe to capability change events
   */
  onCapabilityChange(callback: McpCapabilityChangeCallback): McpUnsubscribeFn {
    this.capabilityChangeCallbacks.add(callback);
    return () => {
      this.capabilityChangeCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to connection status change events
   */
  onConnectionChange(callback: McpConnectionChangeCallback): McpUnsubscribeFn {
    this.connectionChangeCallbacks.add(callback);
    return () => {
      this.connectionChangeCallbacks.delete(callback);
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH RESOLUTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Resolve authentication headers for a remote request
   */
  async resolveAuthHeaders(
    appId: string,
    authConfig: McpRemoteAuthConfig | undefined,
    gatewayAuthInfo?: AuthInfo,
  ): Promise<Record<string, string>> {
    if (!authConfig) {
      return {};
    }

    switch (authConfig.mode) {
      case 'static':
        return this.buildAuthHeaders(authConfig.credentials);

      case 'forward':
        if (!gatewayAuthInfo?.token) {
          this.logger.warn(`No gateway auth token to forward for ${appId}`);
          return {};
        }
        const headerName = authConfig.headerName || 'Authorization';
        return { [headerName]: `Bearer ${gatewayAuthInfo.token}` };

      case 'mapped':
        try {
          const credentials = await authConfig.mapper(gatewayAuthInfo);
          return this.buildAuthHeaders(credentials);
        } catch (error) {
          throw new RemoteAuthError(appId, `Auth mapping failed: ${(error as Error).message}`);
        }

      case 'oauth':
        // Remote server handles OAuth - no headers needed from gateway
        return {};

      default:
        return {};
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Disconnect from all remote servers and clean up
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing McpClientService');

    // Stop all refresh timers
    for (const appId of this.refreshTimers.keys()) {
      this.stopCapabilityRefresh(appId);
    }

    // Disconnect from all servers
    const disconnectPromises: Promise<void>[] = [];
    for (const appId of this.connections.keys()) {
      disconnectPromises.push(this.disconnect(appId));
    }
    await Promise.all(disconnectPromises);

    // Clear all callbacks
    this.capabilityChangeCallbacks.clear();
    this.connectionChangeCallbacks.clear();

    this.logger.info('McpClientService disposed');
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private getConnection(appId: string): McpClientConnection {
    const connection = this.connections.get(appId);
    if (!connection || connection.status !== 'connected') {
      throw new RemoteNotConnectedError(appId);
    }
    return connection;
  }

  private async createTransport(request: McpConnectRequest): Promise<Transport> {
    const { transportType, url, transportOptions } = request;
    const httpOptions = transportOptions as McpHttpTransportOptions | undefined;

    switch (transportType) {
      case 'http': {
        const fallbackToSSE = httpOptions?.fallbackToSSE ?? true;

        try {
          // Try Streamable HTTP first
          return new StreamableHTTPClientTransport(new URL(url));
        } catch (error) {
          if (fallbackToSSE) {
            this.logger.debug(`Streamable HTTP failed for ${request.appId}, falling back to SSE`);
            return new SSEClientTransport(new URL(url));
          }
          throw error;
        }
      }

      case 'sse':
        return new SSEClientTransport(new URL(url));

      case 'worker':
      case 'npm':
      case 'esm':
        // TODO: Implement these transports
        throw new Error(`Transport type "${transportType}" not yet implemented`);

      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  private async listToolsInternal(connection: McpClientConnection): Promise<Tool[]> {
    try {
      const result = await connection.client.listTools();
      return result.tools || [];
    } catch (error) {
      this.logger.warn(`Failed to list tools: ${(error as Error).message}`);
      return [];
    }
  }

  private async listResourcesInternal(connection: McpClientConnection): Promise<Resource[]> {
    try {
      const result = await connection.client.listResources();
      return result.resources || [];
    } catch (error) {
      this.logger.warn(`Failed to list resources: ${(error as Error).message}`);
      return [];
    }
  }

  private async listResourceTemplatesInternal(connection: McpClientConnection): Promise<ResourceTemplate[]> {
    try {
      const result = await connection.client.listResourceTemplates();
      return result.resourceTemplates || [];
    } catch (error) {
      this.logger.warn(`Failed to list resource templates: ${(error as Error).message}`);
      return [];
    }
  }

  private async listPromptsInternal(connection: McpClientConnection): Promise<Prompt[]> {
    try {
      const result = await connection.client.listPrompts();
      return result.prompts || [];
    } catch (error) {
      this.logger.warn(`Failed to list prompts: ${(error as Error).message}`);
      return [];
    }
  }

  private updateConnectionStatus(appId: string, status: McpConnectionStatus, error?: Error): void {
    const connection = this.connections.get(appId);
    if (connection) {
      connection.status = status;
      connection.lastError = error;
    }

    // Notify listeners
    for (const callback of this.connectionChangeCallbacks) {
      try {
        callback(appId, status, error);
      } catch (e) {
        this.logger.error(`Connection change callback error: ${(e as Error).message}`);
      }
    }
  }

  private emitCapabilityChangeIfNeeded(
    appId: string,
    previous: McpRemoteCapabilities,
    current: McpRemoteCapabilities,
  ): void {
    const changes: McpCapabilityChangeEvent[] = [];

    if (previous.tools.length !== current.tools.length) {
      changes.push({
        appId,
        kind: 'tools',
        previousCount: previous.tools.length,
        newCount: current.tools.length,
        timestamp: new Date(),
      });
    }

    if (previous.resources.length !== current.resources.length) {
      changes.push({
        appId,
        kind: 'resources',
        previousCount: previous.resources.length,
        newCount: current.resources.length,
        timestamp: new Date(),
      });
    }

    if (previous.prompts.length !== current.prompts.length) {
      changes.push({
        appId,
        kind: 'prompts',
        previousCount: previous.prompts.length,
        newCount: current.prompts.length,
        timestamp: new Date(),
      });
    }

    // Emit events
    for (const event of changes) {
      for (const callback of this.capabilityChangeCallbacks) {
        try {
          callback(event);
        } catch (e) {
          this.logger.error(`Capability change callback error: ${(e as Error).message}`);
        }
      }
    }
  }

  private startCapabilityRefresh(appId: string): void {
    if (this.options.capabilityRefreshInterval <= 0) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.discoverCapabilities(appId);
      } catch (error) {
        this.logger.warn(`Capability refresh failed for ${appId}: ${(error as Error).message}`);
      }
    }, this.options.capabilityRefreshInterval);

    this.refreshTimers.set(appId, timer);
  }

  private stopCapabilityRefresh(appId: string): void {
    const timer = this.refreshTimers.get(appId);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(appId);
    }
  }

  private buildAuthHeaders(credentials: McpStaticCredentials): Record<string, string> {
    switch (credentials.type) {
      case 'bearer':
        return { Authorization: `Bearer ${credentials.value}` };
      case 'basic':
        return { Authorization: `Basic ${credentials.value}` };
      case 'apiKey':
        return { [credentials.headerName || 'X-API-Key']: credentials.value };
      default:
        return {};
    }
  }
}
