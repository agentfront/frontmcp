// file: libs/sdk/src/notification/notification.service.ts

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { ListRootsResultSchema, type LoggingLevel, type Root } from '@modelcontextprotocol/sdk/types.js';
import { FrontMcpLogger } from '../common';
import type { Scope } from '../scope';
import type { AIPlatformType } from '../common/types/auth/session.types';
import type { PlatformDetectionConfig, PlatformMappingEntry } from '../common/types/options/session.options';

/**
 * Re-export Root from MCP SDK for convenience.
 * Per MCP 2025-11-25 specification.
 */
export type { Root };

/**
 * Re-export AIPlatformType from session types for backwards compatibility.
 */
export type { AIPlatformType } from '../common/types/auth/session.types';

/**
 * Alias for MCP SDK's LoggingLevel for backwards compatibility.
 * @deprecated Use LoggingLevel from @modelcontextprotocol/sdk/types.js directly
 */
export type McpLoggingLevel = LoggingLevel;

/**
 * Client capabilities from the initialize request.
 * Stored per session to understand what the client supports.
 */
export interface ClientCapabilities {
  /** Whether the client supports roots and root change notifications */
  roots?: {
    listChanged?: boolean;
  };
  /** Other capabilities can be added here as needed */
  sampling?: Record<string, unknown>;
}

/**
 * Client info from the MCP initialize request.
 * Contains the name and version of the calling client.
 */
export interface ClientInfo {
  /** Client application name (e.g., "claude-desktop", "chatgpt", "cursor") */
  name: string;
  /** Client version string */
  version: string;
}

/**
 * Match client name against custom mapping patterns.
 * @param clientName - The client name to match
 * @param mappings - Array of custom mapping entries
 * @returns The matched platform type, or undefined if no match
 */
function matchCustomMappings(clientName: string, mappings?: PlatformMappingEntry[]): AIPlatformType | undefined {
  if (!mappings || mappings.length === 0) {
    return undefined;
  }

  const lowerClientName = clientName.toLowerCase();

  for (const mapping of mappings) {
    if (typeof mapping.pattern === 'string') {
      // Exact match (case-insensitive) - use RegExp for substring matching
      if (lowerClientName === mapping.pattern.toLowerCase()) {
        return mapping.platform;
      }
    } else {
      // RegExp match
      if (mapping.pattern.test(clientName)) {
        return mapping.platform;
      }
    }
  }

  return undefined;
}

/**
 * Default keyword-based platform detection.
 * Works with client names, user-agent strings, or any identifier.
 * @param identifier - The identifier to detect (clientInfo.name, user-agent, etc.)
 * @returns The detected platform type
 */
function defaultPlatformDetection(identifier: string): AIPlatformType {
  const lowerIdentifier = identifier.toLowerCase();

  // OpenAI/ChatGPT clients (includes user-agent like 'openai-mcp/1.0.0')
  if (lowerIdentifier.includes('chatgpt') || lowerIdentifier.includes('openai') || lowerIdentifier.includes('gpt')) {
    return 'openai';
  }

  // Claude clients
  if (lowerIdentifier.includes('claude') || lowerIdentifier.includes('anthropic')) {
    return 'claude';
  }

  // Google Gemini clients (use specific patterns to prevent false positives like "google-drive-connector")
  if (
    lowerIdentifier.includes('gemini') ||
    lowerIdentifier.includes('bard') ||
    lowerIdentifier.includes('google-ai') ||
    lowerIdentifier.includes('google ai')
  ) {
    return 'gemini';
  }

  // Cursor IDE
  if (lowerIdentifier.includes('cursor')) {
    return 'cursor';
  }

  // Continue.dev
  if (lowerIdentifier.includes('continue')) {
    return 'continue';
  }

  // Sourcegraph Cody
  if (lowerIdentifier.includes('cody') || lowerIdentifier.includes('sourcegraph')) {
    return 'cody';
  }

  // Generic MCP client (fallback for known MCP implementations)
  if (lowerIdentifier.includes('mcp')) {
    return 'generic-mcp';
  }

  return 'unknown';
}

/**
 * Detect platform from user-agent header.
 * Called during session creation before MCP initialize.
 *
 * @param userAgent - The User-Agent header value
 * @param config - Optional platform detection configuration
 * @returns The detected platform type
 */
export function detectPlatformFromUserAgent(userAgent?: string, config?: PlatformDetectionConfig): AIPlatformType {
  if (!userAgent) {
    return 'unknown';
  }

  // Check custom mappings first
  const customMatch = matchCustomMappings(userAgent, config?.mappings);
  if (customMatch) {
    return customMatch;
  }

  // If customOnly, don't use default detection
  if (config?.customOnly) {
    return 'unknown';
  }

  // Use default detection on user-agent
  return defaultPlatformDetection(userAgent);
}

/**
 * Detect the AI platform type from client info.
 * Supports custom mappings that are checked before default detection.
 *
 * @param clientInfo - Client info from MCP initialize request
 * @param config - Optional platform detection configuration with custom mappings
 * @returns The detected platform type
 */
export function detectAIPlatform(clientInfo?: ClientInfo, config?: PlatformDetectionConfig): AIPlatformType {
  if (!clientInfo?.name) {
    return 'unknown';
  }

  // First, check custom mappings if provided
  const customMatch = matchCustomMappings(clientInfo.name, config?.mappings);
  if (customMatch) {
    return customMatch;
  }

  // If customOnly is true, don't fall back to default detection
  if (config?.customOnly) {
    return 'unknown';
  }

  // Fall back to default keyword-based detection
  return defaultPlatformDetection(clientInfo.name);
}

/**
 * MCP logging level priority (lower number = more verbose).
 * Uses LoggingLevel from MCP SDK for type safety.
 */
export const MCP_LOGGING_LEVEL_PRIORITY: Record<LoggingLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

/**
 * MCP notification method types per the 2025-11-25 specification.
 */
export type McpNotificationMethod =
  | 'notifications/resources/list_changed'
  | 'notifications/tools/list_changed'
  | 'notifications/prompts/list_changed'
  | 'notifications/resources/updated'
  | 'notifications/message';

/**
 * Information about a registered MCP server/transport connection.
 */
export interface RegisteredServer {
  /** Unique session identifier */
  sessionId: string;
  /** The MCP server instance */
  server: McpServer;
  /** Timestamp when the server was registered */
  registeredAt: number;
  /** Client capabilities from the initialize request */
  clientCapabilities?: ClientCapabilities;
  /** Client info (name/version) from the initialize request */
  clientInfo?: ClientInfo;
  /** Detected AI platform type based on client info */
  platformType?: AIPlatformType;
  /** Cached roots from the client (invalidated on roots/list_changed) */
  cachedRoots?: Root[];
  /** Timestamp when roots were last fetched */
  rootsFetchedAt?: number;
}

/**
 * NotificationService manages server→client notifications per MCP 2025-11-25 spec.
 *
 * It tracks all active MCP server instances and broadcasts notifications when
 * registries (resources, tools, prompts) change.
 *
 * It also manages resource subscriptions per session, allowing clients to
 * subscribe to specific resource URIs and receive notifications when they change.
 *
 * @example
 * ```typescript
 * // In LocalTransportAdapter after server.connect()
 * scope.notifications.registerServer(sessionId, this.server);
 *
 * // On session close
 * scope.notifications.unregisterServer(sessionId);
 *
 * // Resource subscriptions
 * scope.notifications.subscribeResource(sessionId, 'file://path/to/file');
 * scope.notifications.unsubscribeResource(sessionId, 'file://path/to/file');
 * ```
 */
export class NotificationService {
  private readonly logger: FrontMcpLogger;
  private readonly servers = new Map<string, RegisteredServer>();
  private readonly unsubscribers: Array<() => void> = [];
  /** Maps session ID to set of subscribed resource URIs */
  private readonly subscriptions = new Map<string, Set<string>>();
  /** Maps session ID to minimum log level for that session */
  private readonly logLevels = new Map<string, McpLoggingLevel>();
  /**
   * Set of terminated session IDs (for session invalidation on DELETE).
   * Uses LRU-style eviction to prevent unbounded memory growth.
   */
  private readonly terminatedSessions = new Set<string>();
  /** Maximum number of terminated sessions to track before eviction */
  private static readonly MAX_TERMINATED_SESSIONS = 10000;

  constructor(private readonly scope: Scope) {
    this.logger = scope.logger.child('NotificationService');
  }

  /**
   * Initialize the notification service and subscribe to registry changes.
   * Called after all registries are ready.
   */
  async initialize(): Promise<void> {
    this.logger.verbose('Initializing notification service');

    // Subscribe to resource changes
    const unsubResources = this.scope.resources.subscribe({ immediate: false }, (event) => {
      if (event.changeScope === 'global') {
        this.broadcastNotification('notifications/resources/list_changed');
      }
    });
    this.unsubscribers.push(unsubResources);

    // Subscribe to tool changes
    const unsubTools = this.scope.tools.subscribe({ immediate: false }, (event) => {
      if (event.changeScope === 'global') {
        this.broadcastNotification('notifications/tools/list_changed');
      }
    });
    this.unsubscribers.push(unsubTools);

    // Subscribe to prompt changes
    const unsubPrompts = this.scope.prompts.subscribe({ immediate: false }, (event) => {
      if (event.changeScope === 'global') {
        this.broadcastNotification('notifications/prompts/list_changed');
      }
    });
    this.unsubscribers.push(unsubPrompts);

    this.logger.info('Notification service initialized with registry subscriptions');
  }

  /**
   * Register an MCP server instance for receiving notifications.
   * Call this when a transport connection is established.
   *
   * @param sessionId - Unique session identifier
   * @param server - The MCP server instance
   */
  registerServer(sessionId: string, server: McpServer): void {
    if (this.servers.has(sessionId)) {
      this.logger.warn(`Server already registered for session: ${sessionId.slice(0, 20)}...`);
      return;
    }

    this.servers.set(sessionId, {
      sessionId,
      server,
      registeredAt: Date.now(),
    });

    this.logger.verbose(`Registered server for session: ${sessionId.slice(0, 20)}... (total: ${this.servers.size})`);
  }

  /**
   * Unregister an MCP server instance.
   * Call this when a transport connection is closed.
   * Also cleans up any resource subscriptions for this session.
   *
   * @param sessionId - The session identifier to unregister
   * @returns true if the server was registered and is now unregistered, false if not found
   */
  unregisterServer(sessionId: string): boolean {
    const deleted = this.servers.delete(sessionId);

    // Clean up resource subscriptions for this session
    const subCount = this.subscriptions.get(sessionId)?.size ?? 0;
    this.subscriptions.delete(sessionId);

    // Clean up log level setting for this session
    const hadLogLevel = this.logLevels.delete(sessionId);

    if (deleted) {
      this.logger.verbose(
        `Unregistered server for session: ${sessionId.slice(0, 20)}... (remaining: ${
          this.servers.size
        }, cleaned ${subCount} subscription(s)${hadLogLevel ? ', removed log level' : ''})`,
      );
    }
    return deleted;
  }

  /**
   * Terminate a session. This adds the session ID to the terminated set,
   * preventing further use of this session ID. This is called during DELETE
   * session handling per MCP 2025-11-25 spec.
   *
   * Note: For stateless sessions (encrypted JWTs), the session ID cannot be
   * truly "invalidated" cryptographically, but we track it in memory to reject
   * future requests with this session ID on this server instance.
   *
   * @param sessionId - The session ID to terminate
   * @returns true if the session was registered and is now terminated
   */
  terminateSession(sessionId: string): boolean {
    // First unregister the server (cleans up subscriptions, log levels, etc.)
    const wasRegistered = this.unregisterServer(sessionId);

    // Add to terminated sessions set (even if not registered, to handle edge cases)
    // Implement LRU-style eviction to prevent unbounded memory growth
    if (this.terminatedSessions.size >= NotificationService.MAX_TERMINATED_SESSIONS) {
      // Remove the oldest entry (first item in Set maintains insertion order)
      const oldest = this.terminatedSessions.values().next().value;
      if (oldest) {
        this.terminatedSessions.delete(oldest);
        this.logger.verbose(`Evicted oldest terminated session to make room: ${oldest.slice(0, 20)}...`);
      }
    }
    this.terminatedSessions.add(sessionId);
    this.logger.verbose(
      `Terminated session: ${sessionId.slice(0, 20)}... (total terminated: ${this.terminatedSessions.size})`,
    );

    return wasRegistered;
  }

  /**
   * Check if a session has been terminated.
   * Used during session verification to reject requests with terminated session IDs.
   *
   * @param sessionId - The session ID to check
   * @returns true if the session has been terminated
   */
  isSessionTerminated(sessionId: string): boolean {
    return this.terminatedSessions.has(sessionId);
  }

  /**
   * Broadcast a notification to all registered servers.
   *
   * @param method - The MCP notification method
   * @param params - Optional notification parameters
   */
  broadcastNotification(method: McpNotificationMethod, params?: Record<string, unknown>): void {
    if (this.servers.size === 0) {
      this.logger.verbose(`No servers registered for notification: ${method}`);
      return;
    }

    this.logger.verbose(`Broadcasting ${method} to ${this.servers.size} server(s)`);

    for (const [sessionId, { server }] of this.servers) {
      this.sendNotificationToServer(server, sessionId, method, params);
    }
  }

  /**
   * Send a notification to a specific session.
   *
   * @param sessionId - The target session
   * @param method - The MCP notification method
   * @param params - Optional notification parameters
   */
  sendNotificationToSession(sessionId: string, method: McpNotificationMethod, params?: Record<string, unknown>): void {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      this.logger.warn(`Cannot send notification to unregistered session: ${sessionId.slice(0, 20)}...`);
      return;
    }

    this.sendNotificationToServer(registered.server, sessionId, method, params);
  }

  /**
   * Subscribe a session to receive notifications when a specific resource changes.
   *
   * @param sessionId - The session to subscribe
   * @param uri - The resource URI to subscribe to
   * @returns true if this is a new subscription, false if already subscribed
   */
  subscribeResource(sessionId: string, uri: string): boolean {
    if (!this.servers.has(sessionId)) {
      this.logger.warn(`Cannot subscribe unregistered session ${sessionId.slice(0, 20)}... to resource ${uri}`);
      return false;
    }

    let sessionSubs = this.subscriptions.get(sessionId);
    if (!sessionSubs) {
      sessionSubs = new Set();
      this.subscriptions.set(sessionId, sessionSubs);
    }

    const isNew = !sessionSubs.has(uri);
    sessionSubs.add(uri);

    if (isNew) {
      this.logger.verbose(`Session ${sessionId.slice(0, 20)}... subscribed to resource ${uri}`);
    }

    return isNew;
  }

  /**
   * Unsubscribe a session from a specific resource.
   *
   * @param sessionId - The session to unsubscribe
   * @param uri - The resource URI to unsubscribe from
   * @returns true if the subscription was removed, false if not subscribed
   */
  unsubscribeResource(sessionId: string, uri: string): boolean {
    const sessionSubs = this.subscriptions.get(sessionId);
    if (!sessionSubs) {
      return false;
    }

    const wasSubscribed = sessionSubs.delete(uri);

    // Clean up empty subscription sets
    if (sessionSubs.size === 0) {
      this.subscriptions.delete(sessionId);
    }

    if (wasSubscribed) {
      this.logger.verbose(`Session ${sessionId.slice(0, 20)}... unsubscribed from resource ${uri}`);
    }

    return wasSubscribed;
  }

  /**
   * Check if a session is subscribed to a specific resource.
   *
   * @param sessionId - The session to check
   * @param uri - The resource URI
   * @returns true if subscribed
   */
  isSubscribed(sessionId: string, uri: string): boolean {
    return this.subscriptions.get(sessionId)?.has(uri) ?? false;
  }

  /**
   * Get all sessions subscribed to a specific resource.
   *
   * @param uri - The resource URI
   * @returns Array of session IDs subscribed to this resource
   */
  getSubscribersForResource(uri: string): string[] {
    const subscribers: string[] = [];
    for (const [sessionId, uris] of this.subscriptions) {
      if (uris.has(uri)) {
        subscribers.push(sessionId);
      }
    }
    return subscribers;
  }

  /**
   * Send a resource update notification to subscribed sessions only.
   * Per MCP 2025-11-25 spec, only sessions that have subscribed to this
   * resource via `resources/subscribe` will receive the notification.
   *
   * @param uri - The resource URI that was updated
   */
  notifyResourceUpdated(uri: string): void {
    const subscribers = this.getSubscribersForResource(uri);

    if (subscribers.length === 0) {
      this.logger.verbose(`No subscribers for resource ${uri}, skipping notification`);
      return;
    }

    this.logger.verbose(`Notifying ${subscribers.length} subscriber(s) of resource update: ${uri}`);

    for (const sessionId of subscribers) {
      this.sendNotificationToSession(sessionId, 'notifications/resources/updated', { uri });
    }
  }

  /**
   * Get the number of registered servers.
   */
  get serverCount(): number {
    return this.servers.size;
  }

  /**
   * Set the minimum log level for a session.
   * Only log messages at or above this level will be sent to the session.
   * Per MCP spec, the default level when not set is determined by the server.
   *
   * @param sessionId - The session to configure
   * @param level - The minimum log level
   * @returns true if the session was found and level was set
   */
  setLogLevel(sessionId: string, level: McpLoggingLevel): boolean {
    if (!this.servers.has(sessionId)) {
      this.logger.warn(`Cannot set log level for unregistered session: ${sessionId.slice(0, 20)}...`);
      return false;
    }

    this.logLevels.set(sessionId, level);
    this.logger.verbose(`Set log level to '${level}' for session ${sessionId.slice(0, 20)}...`);
    return true;
  }

  /**
   * Get the current log level for a session.
   *
   * @param sessionId - The session to query
   * @returns The log level, or undefined if not set
   */
  getLogLevel(sessionId: string): McpLoggingLevel | undefined {
    return this.logLevels.get(sessionId);
  }

  /**
   * Send a log message to all sessions that have enabled the given level.
   * Per MCP 2025-11-25 spec, this sends a 'notifications/message' notification
   * to sessions whose configured minimum level allows this message through.
   *
   * @param level - The log level of this message
   * @param loggerName - Optional logger name/component identifier
   * @param data - The log message data (string or structured data)
   */
  sendLogMessage(level: McpLoggingLevel, loggerName: string | undefined, data: unknown): void {
    const messagePriority = MCP_LOGGING_LEVEL_PRIORITY[level];

    for (const [sessionId, { server }] of this.servers) {
      const sessionLevel = this.logLevels.get(sessionId);

      // If session hasn't set a level, skip (server decides default behavior)
      // Here we default to NOT sending unless explicitly subscribed
      if (!sessionLevel) {
        continue;
      }

      const sessionPriority = MCP_LOGGING_LEVEL_PRIORITY[sessionLevel];

      // Only send if message level >= session's minimum level
      if (messagePriority >= sessionPriority) {
        const params: Record<string, unknown> = {
          level,
          data,
        };
        if (loggerName) {
          params['logger'] = loggerName;
        }

        this.sendNotificationToServer(server, sessionId, 'notifications/message', params);
      }
    }
  }

  /**
   * Send a log message to a specific session, respecting its log level.
   *
   * @param sessionId - The target session
   * @param level - The log level of this message
   * @param loggerName - Optional logger name/component identifier
   * @param data - The log message data
   * @returns true if the message was sent (session exists and level allows)
   */
  sendLogMessageToSession(
    sessionId: string,
    level: McpLoggingLevel,
    loggerName: string | undefined,
    data: unknown,
  ): boolean {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      return false;
    }

    const sessionLevel = this.logLevels.get(sessionId);
    if (!sessionLevel) {
      // Session hasn't enabled logging
      return false;
    }

    const messagePriority = MCP_LOGGING_LEVEL_PRIORITY[level];
    const sessionPriority = MCP_LOGGING_LEVEL_PRIORITY[sessionLevel];

    if (messagePriority < sessionPriority) {
      // Message level is too verbose for this session
      return false;
    }

    const params: Record<string, unknown> = {
      level,
      data,
    };
    if (loggerName) {
      params['logger'] = loggerName;
    }

    this.sendNotificationToServer(registered.server, sessionId, 'notifications/message', params);
    return true;
  }

  // =====================================================
  // Client Capabilities & Roots API (MCP 2025-11-25)
  // =====================================================

  /**
   * Set client capabilities for a session.
   * Called during initialization to store what the client supports.
   *
   * @param sessionId - The session to configure
   * @param capabilities - The client's capabilities from the initialize request
   * @returns true if the session was found and capabilities were set
   */
  setClientCapabilities(sessionId: string, capabilities: ClientCapabilities): boolean {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      this.logger.warn(`Cannot set client capabilities for unregistered session: ${sessionId.slice(0, 20)}...`);
      return false;
    }

    registered.clientCapabilities = capabilities;
    this.logger.verbose(
      `Set client capabilities for session ${sessionId.slice(0, 20)}...: roots.listChanged=${
        capabilities.roots?.listChanged ?? false
      }`,
    );
    return true;
  }

  /**
   * Get client capabilities for a session.
   *
   * @param sessionId - The session to query
   * @returns The client's capabilities, or undefined if not set
   */
  getClientCapabilities(sessionId: string): ClientCapabilities | undefined {
    return this.servers.get(sessionId)?.clientCapabilities;
  }

  /**
   * Set client info for a session and auto-detect the AI platform type.
   * Called during initialization to store who the client is.
   * Uses the scope's platform detection configuration for custom mappings.
   *
   * @param sessionId - The session to configure
   * @param clientInfo - The client's info (name/version) from the initialize request
   * @returns The detected platform type, or undefined if the session was not found
   */
  setClientInfo(sessionId: string, clientInfo: ClientInfo): AIPlatformType | undefined {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      this.logger.warn(`Cannot set client info for unregistered session: ${sessionId.slice(0, 20)}...`);
      return undefined;
    }

    registered.clientInfo = clientInfo;
    // Use platform detection config from scope if available
    const platformDetectionConfig = this.scope.metadata?.session?.platformDetection;
    registered.platformType = detectAIPlatform(clientInfo, platformDetectionConfig);
    this.logger.verbose(
      `Set client info for session ${sessionId.slice(0, 20)}...: name=${clientInfo.name}, version=${
        clientInfo.version
      }, platform=${registered.platformType}`,
    );
    return registered.platformType;
  }

  /**
   * Get client info for a session.
   *
   * @param sessionId - The session to query
   * @returns The client's info, or undefined if not set
   */
  getClientInfo(sessionId: string): ClientInfo | undefined {
    return this.servers.get(sessionId)?.clientInfo;
  }

  /**
   * Get the detected AI platform type for a session.
   * This is auto-detected from client info during initialization.
   *
   * @param sessionId - The session to query
   * @returns The detected platform type, or 'unknown' if not detected
   */
  getPlatformType(sessionId: string): AIPlatformType {
    const session = this.servers.get(sessionId);
    return session?.platformType ?? 'unknown';
  }

  /**
   * Check if a session's client supports roots listing.
   *
   * @param sessionId - The session to check
   * @returns true if the client supports roots
   */
  supportsRoots(sessionId: string): boolean {
    const capabilities = this.getClientCapabilities(sessionId);
    return capabilities?.roots !== undefined;
  }

  /**
   * List roots from the client for a session.
   * This sends a `roots/list` request to the client and returns the roots.
   *
   * If the client doesn't support roots, returns an empty array.
   * Results are cached and invalidated when `notifications/roots/list_changed` is received.
   *
   * @param sessionId - The session to request roots from
   * @param options - Options for the request
   * @param options.forceRefresh - If true, bypass the cache and fetch fresh roots
   * @param options.timeout - Timeout in milliseconds (default: 30000)
   * @returns Array of roots from the client
   */
  async listRoots(sessionId: string, options?: { forceRefresh?: boolean; timeout?: number }): Promise<Root[]> {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      this.logger.warn(`Cannot list roots for unregistered session: ${sessionId.slice(0, 20)}...`);
      return [];
    }

    // Check if client supports roots
    if (!this.supportsRoots(sessionId)) {
      this.logger.verbose(`Client for session ${sessionId.slice(0, 20)}... does not support roots`);
      return [];
    }

    // Return cached roots if available and not forcing refresh
    if (!options?.forceRefresh && registered.cachedRoots !== undefined) {
      this.logger.verbose(
        `Returning cached roots for session ${sessionId.slice(0, 20)}... (${registered.cachedRoots.length} roots)`,
      );
      return registered.cachedRoots;
    }

    try {
      this.logger.verbose(`Requesting roots from client for session ${sessionId.slice(0, 20)}...`);

      // Send roots/list request to client
      const result = await registered.server.request({ method: 'roots/list' }, ListRootsResultSchema, {
        timeout: options?.timeout ?? 30000,
      });

      // Cache the result
      registered.cachedRoots = result.roots as Root[];
      registered.rootsFetchedAt = Date.now();

      this.logger.verbose(
        `Received ${registered.cachedRoots.length} root(s) from client for session ${sessionId.slice(0, 20)}...`,
      );
      return registered.cachedRoots;
    } catch (error) {
      this.logger.warn(
        `Failed to list roots for session ${sessionId.slice(0, 20)}...: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      // Return cached roots if available, otherwise empty array
      return registered.cachedRoots ?? [];
    }
  }

  /**
   * Invalidate cached roots for a session.
   * Call this when receiving `notifications/roots/list_changed` from the client.
   *
   * @param sessionId - The session whose roots cache should be invalidated
   * @returns true if the session was found and cache was invalidated
   */
  invalidateRootsCache(sessionId: string): boolean {
    const registered = this.servers.get(sessionId);
    if (!registered) {
      return false;
    }

    const hadCache = registered.cachedRoots !== undefined;
    registered.cachedRoots = undefined;
    registered.rootsFetchedAt = undefined;

    if (hadCache) {
      this.logger.verbose(`Invalidated roots cache for session ${sessionId.slice(0, 20)}...`);
    }
    return hadCache;
  }

  /**
   * Get the cached roots for a session without fetching from the client.
   *
   * @param sessionId - The session to query
   * @returns Cached roots, or undefined if not cached
   */
  getCachedRoots(sessionId: string): Root[] | undefined {
    return this.servers.get(sessionId)?.cachedRoots;
  }

  /**
   * Clean up subscriptions and resources.
   */
  async destroy(): Promise<void> {
    this.logger.verbose('Destroying notification service');

    // Unsubscribe from all registry listeners
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    // Clear server registrations, resource subscriptions, log levels, and terminated sessions
    this.servers.clear();
    this.subscriptions.clear();
    this.logLevels.clear();
    this.terminatedSessions.clear();

    this.logger.info('Notification service destroyed');
  }

  private sendNotificationToServer(
    server: McpServer,
    sessionId: string,
    method: McpNotificationMethod,
    params?: Record<string, unknown>,
  ): void {
    try {
      // MCP SDK's server.notification() sends a JSON-RPC notification
      server.notification({ method, params: params ?? {} });
      this.logger.verbose(`Sent ${method} to session ${sessionId.slice(0, 20)}...`);
    } catch (error) {
      // Connection may have closed; log and continue
      this.logger.warn(
        `Failed to send notification ${method} to session ${sessionId.slice(0, 20)}...: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      // Optionally unregister dead sessions
      this.unregisterServer(sessionId);
    }
  }
}
