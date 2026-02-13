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

import {
  withRetry,
  isTransientError,
  isConnectionError,
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitOpenError,
  HealthChecker,
  HealthCheckManager,
  type RetryOptions,
  type CircuitBreakerOptions,
  type HealthCheckOptions,
  type HealthStatus,
} from './resilience';

import {
  MethodNotImplementedError,
  UnsupportedTransportTypeError,
  TransportNotConnectedError,
} from '../errors/transport.errors';

// Default retry options for self-healing
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

// Default circuit breaker options
const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 2,
  failureWindowMs: 60000,
};

// Default health check options
const DEFAULT_HEALTH_CHECK_OPTIONS: HealthCheckOptions = {
  intervalMs: 30000,
  timeoutMs: 5000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
};

// Default service options
const DEFAULT_OPTIONS: Required<McpClientServiceOptions> = {
  capabilityRefreshInterval: 0,
  clientName: 'frontmcp-gateway',
  clientVersion: '1.0.0',
  debug: false,
  // Resilience options
  enableRetry: true,
  retryOptions: DEFAULT_RETRY_OPTIONS,
  enableCircuitBreaker: true,
  circuitBreakerOptions: DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  enableHealthCheck: true,
  healthCheckOptions: DEFAULT_HEALTH_CHECK_OPTIONS,
  enableAutoReconnect: true,
  autoReconnectDelayMs: 5000,
  maxAutoReconnectAttempts: 3,
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

  // Track refresh-in-progress to prevent overlapping refreshes
  private readonly refreshInProgress: Set<string> = new Set();

  // Resilience components
  private readonly circuitBreakerManager: CircuitBreakerManager;
  private readonly healthCheckManager: HealthCheckManager;
  private readonly reconnectAttempts: Map<string, number> = new Map();
  private readonly reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(logger: FrontMcpLogger, options: McpClientServiceOptions = {}) {
    this.logger = logger.child('McpClientService');
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize resilience components
    this.circuitBreakerManager = new CircuitBreakerManager({
      ...this.options.circuitBreakerOptions,
      onStateChange: (state, prev) => {
        this.logger.info(`Circuit breaker state changed: ${prev} -> ${state}`);
      },
    });

    this.healthCheckManager = new HealthCheckManager({
      ...this.options.healthCheckOptions,
      onStatusChange: (appId, status, prev) => {
        this.logger.info(`Health status changed for ${appId}: ${prev} -> ${status}`);
        this.handleHealthStatusChange(appId, status, prev);
      },
    });
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
      let transport = this.createTransport(request);

      // Create MCP client with configurable name/version
      const client = new Client(
        {
          name: this.options.clientName,
          version: this.options.clientVersion,
        },
        {
          capabilities: {
            // We support receiving notifications
          },
        },
      );

      // Connect to server with fallback support for HTTP transport
      try {
        await client.connect(transport);
      } catch (connectError) {
        // If Streamable HTTP fails and fallback is enabled, try SSE
        if (this.shouldFallbackToSSE(request)) {
          this.logger.debug(
            `Streamable HTTP connection failed for ${appId}: ${(connectError as Error).message}. ` +
              `Falling back to SSE transport.`,
          );
          transport = this.createFallbackSSETransport(request);
          await client.connect(transport);
        } else {
          throw connectError;
        }
      }

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

      // Start health checking
      this.startHealthCheck(appId);

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts.delete(appId);
      this.cancelAutoReconnect(appId);

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

    // Stop health check
    this.stopHealthCheck(appId);

    // Cancel any pending auto-reconnect
    this.cancelAutoReconnect(appId);

    // Remove circuit breaker
    this.circuitBreakerManager.removeBreaker(appId);

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
      // Fetch all capabilities in parallel (including resource templates)
      const [toolsResult, resourcesResult, resourceTemplatesResult, promptsResult] = await Promise.all([
        this.listToolsInternal(connection),
        this.listResourcesInternal(connection),
        this.listResourceTemplatesInternal(connection),
        this.listPromptsInternal(connection),
      ]);

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
   * Call a tool on a remote server with self-healing
   */
  async callTool(
    appId: string,
    toolName: string,
    args: Record<string, unknown>,
    authContext?: McpRemoteAuthContext,
  ): Promise<CallToolResult> {
    this.logger.debug(`Calling tool ${toolName} on ${appId}`);

    // Check circuit breaker
    if (this.options.enableCircuitBreaker) {
      const breaker = this.circuitBreakerManager.getBreaker(appId);
      if (!breaker.canExecute()) {
        const stats = breaker.getStats();
        throw new CircuitOpenError(appId, stats.nextAttemptTime);
      }
    }

    // Log if authContext is provided - headers are set at transport level during connect
    if (authContext?.headers && Object.keys(authContext.headers).length > 0) {
      this.logger.debug(
        `authContext.headers provided for tool ${toolName} on ${appId}. ` +
          `Note: Auth headers are configured at connection time via transportOptions.headers`,
      );
    }

    const operation = async (): Promise<CallToolResult> => {
      const connection = this.getConnection(appId);
      const startTime = Date.now();

      // Get timeout from stored config
      const config = this.configs.get(appId);
      const timeout = (config?.transportOptions as McpHttpTransportOptions | undefined)?.timeout ?? 30000;

      try {
        // Verify tool exists
        const capabilities = this.capabilities.get(appId);
        const tool = capabilities?.tools.find((t) => t.name === toolName);
        if (!tool) {
          throw new RemoteToolNotFoundError(appId, toolName);
        }

        // Call the tool with timeout
        const toolCallPromise = connection.client.callTool(
          { name: toolName, arguments: args },
          undefined, // resultSchema - let the server handle it
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new RemoteTimeoutError(appId, toolName, timeout)), timeout);
        });

        const result = await Promise.race([toolCallPromise, timeoutPromise]);

        // Update heartbeat
        connection.lastHeartbeat = new Date();

        const durationMs = Date.now() - startTime;
        this.logger.debug(`Tool ${toolName} on ${appId} completed in ${durationMs}ms`);

        // Record success for circuit breaker and health check
        if (this.options.enableCircuitBreaker) {
          this.circuitBreakerManager.getBreaker(appId).recordSuccess();
        }
        this.healthCheckManager.getChecker(appId)?.markHealthy();

        // The result can be either CallToolResult with content, or a CompatibilityCallToolResult with toolResult
        // We normalize it to CallToolResult format
        return result as unknown as CallToolResult;
      } catch (error) {
        // Record failure for circuit breaker
        if (this.options.enableCircuitBreaker) {
          this.circuitBreakerManager.getBreaker(appId).recordFailure(error as Error);
        }
        this.healthCheckManager.getChecker(appId)?.markUnhealthy(error as Error);

        // Check if this is a connection error that needs auto-reconnect
        if (isConnectionError(error as Error) && this.options.enableAutoReconnect) {
          this.scheduleAutoReconnect(appId);
        }

        if (error instanceof RemoteToolNotFoundError) {
          throw error;
        }
        if (error instanceof RemoteTimeoutError) {
          throw error;
        }
        throw new RemoteToolExecutionError(appId, toolName, error as Error);
      }
    };

    // Execute with retry if enabled
    if (this.options.enableRetry) {
      return withRetry(operation, {
        ...this.options.retryOptions,
        isRetryable: (error) => {
          // Don't retry non-transient errors
          if (error instanceof RemoteToolNotFoundError) return false;
          if (error instanceof CircuitOpenError) return false;
          if (error instanceof RemoteTimeoutError) return false;
          return isTransientError(error);
        },
        onRetry: (attempt, error, delayMs) => {
          this.logger.warn(`Retry ${attempt} for tool ${toolName} on ${appId} after ${delayMs}ms: ${error.message}`);
        },
      });
    }

    return operation();
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

      case 'forward': {
        if (!gatewayAuthInfo?.token) {
          this.logger.warn(`No gateway auth token to forward for ${appId}`);
          return {};
        }
        const headerName = authConfig.headerName || 'Authorization';
        return { [headerName]: `Bearer ${gatewayAuthInfo.token}` };
      }

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

    // Cancel all auto-reconnect timers
    for (const appId of this.reconnectTimers.keys()) {
      this.cancelAutoReconnect(appId);
    }

    // Dispose health check manager
    this.healthCheckManager.dispose();

    // Reset all circuit breakers
    this.circuitBreakerManager.resetAll();

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

  /**
   * Create transport for a remote connection.
   *
   * Note: For HTTP transport with fallback, the initial transport is Streamable HTTP.
   * If connection fails with Streamable HTTP, use createFallbackTransport() to get SSE.
   */
  private createTransport(request: McpConnectRequest): Transport {
    const { transportType, url, transportOptions } = request;
    const httpOptions = transportOptions as McpHttpTransportOptions | undefined;

    switch (transportType) {
      case 'http': {
        // Start with Streamable HTTP - fallback to SSE happens during connect() if needed
        const headers = httpOptions?.headers;
        return new StreamableHTTPClientTransport(new URL(url), {
          requestInit: headers ? { headers } : undefined,
        });
      }

      case 'sse': {
        const headers = httpOptions?.headers;
        return new SSEClientTransport(new URL(url), {
          requestInit: headers ? { headers } : undefined,
        });
      }

      case 'worker':
      case 'npm':
      case 'esm':
        // TODO: Implement these transports
        throw new MethodNotImplementedError('McpClientService', `createTransport[${transportType}]`);

      default:
        throw new UnsupportedTransportTypeError(transportType);
    }
  }

  /**
   * Create fallback SSE transport when Streamable HTTP fails
   */
  private createFallbackSSETransport(request: McpConnectRequest): Transport {
    const httpOptions = request.transportOptions as McpHttpTransportOptions | undefined;
    const headers = httpOptions?.headers;
    return new SSEClientTransport(new URL(request.url), {
      requestInit: headers ? { headers } : undefined,
    });
  }

  /**
   * Check if fallback to SSE is enabled for a request
   */
  private shouldFallbackToSSE(request: McpConnectRequest): boolean {
    if (request.transportType !== 'http') return false;
    const httpOptions = request.transportOptions as McpHttpTransportOptions | undefined;
    return httpOptions?.fallbackToSSE ?? true;
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
      // Prevent overlapping refreshes
      if (this.refreshInProgress.has(appId)) {
        this.logger.debug(`Skipping capability refresh for ${appId} - already in progress`);
        return;
      }

      this.refreshInProgress.add(appId);
      try {
        await this.discoverCapabilities(appId);
      } catch (error) {
        this.logger.warn(`Capability refresh failed for ${appId}: ${(error as Error).message}`);
      } finally {
        this.refreshInProgress.delete(appId);
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

  // ═══════════════════════════════════════════════════════════════════
  // SELF-HEALING HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Schedule an auto-reconnect attempt for an app
   */
  private scheduleAutoReconnect(appId: string): void {
    // Don't schedule if already scheduled
    if (this.reconnectTimers.has(appId)) {
      return;
    }

    const attempts = this.reconnectAttempts.get(appId) || 0;
    if (attempts >= this.options.maxAutoReconnectAttempts) {
      this.logger.warn(`Max auto-reconnect attempts (${this.options.maxAutoReconnectAttempts}) reached for ${appId}`);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = this.options.autoReconnectDelayMs * Math.pow(2, attempts);
    this.logger.info(`Scheduling auto-reconnect for ${appId} in ${delay}ms (attempt ${attempts + 1})`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(appId);
      this.reconnectAttempts.set(appId, attempts + 1);

      try {
        await this.reconnect(appId);
        this.logger.info(`Auto-reconnect successful for ${appId}`);
        this.reconnectAttempts.delete(appId);

        // Reset circuit breaker on successful reconnect
        if (this.options.enableCircuitBreaker) {
          this.circuitBreakerManager.getBreaker(appId).reset();
        }
      } catch (error) {
        this.logger.error(`Auto-reconnect failed for ${appId}: ${(error as Error).message}`);
        // Schedule next attempt
        this.scheduleAutoReconnect(appId);
      }
    }, delay);

    this.reconnectTimers.set(appId, timer);
  }

  /**
   * Cancel scheduled auto-reconnect for an app
   */
  private cancelAutoReconnect(appId: string): void {
    const timer = this.reconnectTimers.get(appId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(appId);
    }
    this.reconnectAttempts.delete(appId);
  }

  /**
   * Handle health status changes for proactive healing
   */
  private handleHealthStatusChange(appId: string, status: HealthStatus, previousStatus: HealthStatus): void {
    if (status === 'unhealthy' && previousStatus !== 'unhealthy') {
      // Connection became unhealthy - try to reconnect
      this.logger.warn(`Connection to ${appId} became unhealthy, attempting recovery`);

      if (this.options.enableAutoReconnect) {
        this.scheduleAutoReconnect(appId);
      }
    } else if (status === 'healthy' && previousStatus === 'unhealthy') {
      // Connection recovered
      this.logger.info(`Connection to ${appId} recovered`);
      this.cancelAutoReconnect(appId);

      // Reset circuit breaker
      if (this.options.enableCircuitBreaker) {
        this.circuitBreakerManager.getBreaker(appId).reset();
      }
    }
  }

  /**
   * Start health checking for an app
   */
  private startHealthCheck(appId: string): void {
    if (!this.options.enableHealthCheck) return;

    // Create a health check function that pings the server
    const checkFn = async () => {
      const connection = this.connections.get(appId);
      if (!connection || connection.status !== 'connected') {
        throw new TransportNotConnectedError();
      }
      // Simple ping - list tools as a health check
      await connection.client.listTools();
    };

    this.healthCheckManager.addChecker(appId, checkFn, this.options.healthCheckOptions);
  }

  /**
   * Stop health checking for an app
   */
  private stopHealthCheck(appId: string): void {
    this.healthCheckManager.removeChecker(appId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESILIENCE STATUS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get circuit breaker status for an app
   */
  getCircuitBreakerStatus(appId: string): ReturnType<CircuitBreaker['getStats']> | undefined {
    if (!this.options.enableCircuitBreaker) return undefined;
    return this.circuitBreakerManager.getBreaker(appId).getStats();
  }

  /**
   * Get health check status for an app
   */
  getHealthStatus(appId: string): ReturnType<HealthChecker['getLastResult']> | undefined {
    return this.healthCheckManager.getChecker(appId)?.getLastResult();
  }

  /**
   * Manually reset circuit breaker for an app
   */
  resetCircuitBreaker(appId: string): void {
    if (this.options.enableCircuitBreaker) {
      this.circuitBreakerManager.getBreaker(appId).reset();
    }
  }

  /**
   * Force a health check for an app
   */
  async forceHealthCheck(appId: string): Promise<void> {
    const checker = this.healthCheckManager.getChecker(appId);
    if (checker) {
      await checker.check();
    }
  }
}
