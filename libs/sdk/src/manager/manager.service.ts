import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getRawContextStorage } from '../context';
import type { Scope } from '../scope';
import { TransportManager, UnixSocketTransport, TcpSocketTransport, WebSocketTransport } from './transports';
import {
  parseManagerOptions,
  isManagerEnabled,
  type ManagerOptions,
  type ManagerOptionsInput,
} from './manager.options';
import type {
  ManagerEvent,
  ManagerEventMessage,
  ManagerStateMessage,
  ManagerStateSnapshot,
  ManagerResponseMessage,
  ManagerWelcomeMessage,
  ManagerCommandMessage,
  ManagerClientInfo,
  ManagerEventCategory,
  SessionEventData,
  RequestEventData,
  RequestEventType,
  RegistryEventData,
  RegistryEventType,
  RegistryEntryInfo,
  LogEventData,
  LogEventType,
  ServerEventData,
  ScopeGraphNode,
} from './manager.types';

// ─────────────────────────────────────────────────────────────────────────────
// Ring Buffer for Event History
// ─────────────────────────────────────────────────────────────────────────────

class RingBuffer<T> {
  private buffer: T[] = [];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    let index = this.head;
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[index]!);
      index = (index + 1) % this.capacity;
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  size(): number {
    return this.count;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ManagerService provides remote observation and control of FrontMCP servers.
 *
 * Features:
 * - Socket-based communication (Unix, TCP, WebSocket)
 * - Real-time event streaming to connected clients
 * - Command handling for remote control
 * - State snapshots for new clients
 * - Event history ring buffer for late subscribers
 */
/**
 * Tracked session information for state snapshots.
 */
interface TrackedSession {
  scopeId: string;
  sessionId: string;
  transportType: string;
  clientInfo?: { name: string; version: string };
  connectedAt: number;
  /** Auth mode (public, transparent, orchestrated) */
  authMode?: 'public' | 'transparent' | 'orchestrated';
  /** Authenticated user info */
  authUser?: { name?: string; email?: string };
  /** Whether the session is anonymous */
  isAnonymous?: boolean;
}

export class ManagerService extends EventEmitter {
  private readonly options: ManagerOptions;
  private readonly transports: TransportManager;
  private readonly eventBuffer: RingBuffer<ManagerEvent>;
  private readonly subscriptions: Array<() => void> = [];
  private readonly serverId: string;
  private readonly startedAt: number;

  /** Active sessions tracked for state snapshots */
  private readonly activeSessions: Map<string, TrackedSession> = new Map();

  private scopes: Scope[] = [];
  private running = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options?: ManagerOptionsInput) {
    super();
    this.options = parseManagerOptions(options);
    this.transports = new TransportManager();
    this.eventBuffer = new RingBuffer(this.options.bufferSize);
    this.serverId = nanoid(8);
    this.startedAt = Date.now();

    this.setupTransports();
    this.setupEventHandlers();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────────────────────

  private setupTransports(): void {
    const { transports } = this.options;

    // Unix socket transport (for TUI)
    if (transports.unix?.enabled) {
      this.transports.addTransport(new UnixSocketTransport(transports.unix));
    }

    // TCP socket transport (for orchestrator)
    if (transports.tcp?.enabled) {
      this.transports.addTransport(new TcpSocketTransport(transports.tcp));
    }

    // WebSocket transport (for web dashboard)
    if (transports.websocket?.enabled) {
      this.transports.addTransport(new WebSocketTransport(transports.websocket));
    }
  }

  private setupEventHandlers(): void {
    // Handle new client connections
    this.transports.on('clientConnect', (client: ManagerClientInfo) => {
      this.handleClientConnect(client);
    });

    // Handle client disconnections
    this.transports.on('clientDisconnect', (clientId: string, reason?: string) => {
      this.handleClientDisconnect(clientId, reason);
    });

    // Handle incoming commands
    this.transports.on('command', (clientId: string, message: ManagerCommandMessage) => {
      this.handleCommand(clientId, message);
    });

    // Handle transport errors
    this.transports.on('error', (type: string, error: Error) => {
      this.emit('error', { transport: type, error });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the manager service and all configured transports.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.transports.start();
    this.running = true;

    // Start heartbeat timer
    if (this.options.heartbeatInterval > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, this.options.heartbeatInterval);
    }

    this.emit('started', this.getAddresses());
  }

  /**
   * Stop the manager service and all transports.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Unsubscribe from all registries
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions.length = 0;

    await this.transports.stop();
    this.running = false;

    this.emit('stopped');
  }

  /**
   * Check if the manager is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get addresses of all listening transports.
   */
  getAddresses(): Record<string, string> {
    return this.transports.getAddresses();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scope Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a scope for monitoring.
   * Subscribes to all registry changes in the scope.
   */
  registerScope(scope: Scope): void {
    this.scopes.push(scope);

    // Subscribe to tool registry changes
    const unsubTools = scope.tools.subscribe({ immediate: false }, (evt) => {
      this.emitRegistryEvent(scope.id, 'tool', evt);
    });
    this.subscriptions.push(unsubTools);

    // Subscribe to resource registry changes
    const unsubResources = scope.resources.subscribe({ immediate: false }, (evt) => {
      this.emitRegistryEvent(scope.id, 'resource', evt);
    });
    this.subscriptions.push(unsubResources);

    // Subscribe to prompt registry changes
    const unsubPrompts = scope.prompts.subscribe({ immediate: false }, (evt) => {
      this.emitRegistryEvent(scope.id, 'prompt', evt);
    });
    this.subscriptions.push(unsubPrompts);

    // Subscribe to agent registry changes
    const unsubAgents = scope.agents.subscribe({ immediate: false }, (evt) => {
      this.emitRegistryEvent(scope.id, 'agent', evt);
    });
    this.subscriptions.push(unsubAgents);

    // Emit scope graph update
    this.emitScopeGraphUpdate();
  }

  /**
   * Get all registered scopes.
   */
  getScopes(): Scope[] {
    return [...this.scopes];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Emission
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a session event.
   * Also tracks active sessions for state snapshots.
   */
  emitSessionEvent(
    scopeId: string,
    type: 'session:connect' | 'session:disconnect' | 'session:idle' | 'session:active',
    data: SessionEventData,
  ): void {
    // Track session state for snapshots
    if (type === 'session:connect') {
      this.activeSessions.set(data.sessionId, {
        scopeId,
        sessionId: data.sessionId,
        transportType: data.transportType ?? 'unknown',
        clientInfo: data.clientInfo,
        connectedAt: Date.now(),
        authMode: data.authMode,
        authUser: data.authUser,
        isAnonymous: data.isAnonymous,
      });
    } else if (type === 'session:disconnect') {
      this.activeSessions.delete(data.sessionId);
    }

    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'session',
      type,
      scopeId,
      sessionId: data.sessionId,
      data,
    };
    this.broadcast(event);
  }

  /**
   * Emit a request event.
   */
  emitRequestEvent(
    scopeId: string,
    type: 'request:start' | 'request:complete' | 'request:error',
    data: RequestEventData,
    sessionId?: string,
    requestId?: string,
  ): void {
    const ctx = getRawContextStorage().getStore();
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'request',
      type,
      scopeId,
      sessionId: sessionId ?? ctx?.sessionId,
      requestId: requestId ?? ctx?.requestId,
      traceContext: ctx?.traceContext
        ? {
            traceId: ctx.traceContext.traceId,
            parentId: ctx.traceContext.parentId,
          }
        : undefined,
      data,
    };
    this.broadcast(event);
  }

  /**
   * Emit a trace event with custom type (for tool:execute, tool:complete, etc.)
   * This allows forwarding trace events that don't fit the standard categories.
   */
  emitTraceEvent(scopeId: string, type: string, data: unknown, sessionId?: string, requestId?: string): void {
    const ctx = getRawContextStorage().getStore();
    // Use 'request' category since tool events are request-like
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'request',
      type: type as RequestEventType, // Cast to allow custom types
      scopeId,
      sessionId: sessionId ?? ctx?.sessionId,
      requestId: requestId ?? ctx?.requestId,
      traceContext: ctx?.traceContext
        ? {
            traceId: ctx.traceContext.traceId,
            parentId: ctx.traceContext.parentId,
          }
        : undefined,
      data: data as RequestEventData,
    };
    this.broadcast(event);
  }

  /**
   * Emit a registry event with full entry details.
   */
  private emitRegistryEvent(
    scopeId: string,
    registryType: 'tool' | 'resource' | 'prompt' | 'agent',
    evt: { kind: string; changeScope: string; version: number; snapshot: readonly unknown[] },
  ): void {
    const type = `registry:${registryType}:${evt.kind}` as RegistryEventType;

    // Extract entry details from snapshot based on registry type
    const entries = this.extractEntryDetails(registryType, evt.snapshot);

    const data: RegistryEventData = {
      registryType,
      changeKind: evt.kind as 'added' | 'removed' | 'updated' | 'reset',
      changeScope: evt.changeScope as 'global' | 'session',
      snapshotCount: evt.snapshot.length,
      version: evt.version,
      entries,
    };
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'registry',
      type,
      scopeId,
      data,
    };
    this.broadcast(event);
  }

  /**
   * Extract entry details from registry snapshot for enhanced events.
   */
  private extractEntryDetails(
    registryType: 'tool' | 'resource' | 'prompt' | 'agent',
    snapshot: readonly unknown[],
  ): RegistryEntryInfo[] {
    return snapshot.map((entry: any) => {
      const base: { name: string; description?: string; owner?: { kind: string; id: string } } = {
        name: entry.name ?? entry.metadata?.name ?? 'unknown',
        description: entry.metadata?.description,
      };

      // Add owner info if available
      if (entry.owner) {
        base.owner = { kind: entry.owner.kind, id: entry.owner.id };
      }

      // Add type-specific fields
      if (registryType === 'tool') {
        return {
          ...base,
          inputSchema: entry.rawInputSchema ?? entry.metadata?.inputSchema,
        };
      } else if (registryType === 'resource') {
        return {
          ...base,
          uri: entry.uri ?? entry.uriTemplate,
        };
      }

      return base;
    });
  }

  /**
   * Emit a plugin registry event.
   *
   * Plugin registry uses trace events instead of subscriptions, so this method
   * is called from the log transport when a registry:plugin:* trace is received.
   */
  emitPluginRegistryEvent(scopeId: string, eventType: string, data: RegistryEventData): void {
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'registry',
      type: eventType as RegistryEventType,
      scopeId,
      data: {
        ...data,
        registryType: 'plugin',
      },
    };
    this.broadcast(event);
  }

  /**
   * Emit an adapter registry event.
   *
   * Adapter registry uses trace events instead of subscriptions, so this method
   * is called from the log transport when a registry:adapter:* trace is received.
   */
  emitAdapterRegistryEvent(scopeId: string, eventType: string, data: RegistryEventData): void {
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'registry',
      type: eventType as RegistryEventType,
      scopeId,
      data: {
        ...data,
        registryType: 'adapter',
      },
    };
    this.broadcast(event);
  }

  /**
   * Emit a log event.
   */
  emitLogEvent(scopeId: string, level: string, message: string, prefix: string, args?: unknown[]): void {
    // Check if this log level should be included
    const levelLower = level.toLowerCase();
    if (!this.options.includeLogLevels.includes(levelLower as (typeof this.options.includeLogLevels)[number])) {
      return;
    }

    const ctx = getRawContextStorage().getStore();
    const type = `log:${levelLower}` as LogEventType;
    const data: LogEventData = {
      level,
      message,
      prefix,
      args: args && args.length > 0 ? args : undefined,
    };
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'log',
      type,
      scopeId,
      sessionId: ctx?.sessionId,
      requestId: ctx?.requestId,
      data,
    };
    this.broadcast(event);
  }

  /**
   * Emit a server event.
   */
  emitServerEvent(
    type: 'server:starting' | 'server:ready' | 'server:error' | 'server:shutdown',
    data: ServerEventData,
  ): void {
    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'server',
      type,
      scopeId: '*', // Server events are global
      data,
    };
    this.broadcast(event);
  }

  /**
   * Emit a scope graph update.
   */
  private emitScopeGraphUpdate(): void {
    const root: ScopeGraphNode = {
      id: 'server',
      type: 'scope',
      name: 'FrontMCP Server',
      children: this.scopes.map((scope) => this.buildScopeGraph(scope)),
    };

    const event: ManagerEvent = {
      id: nanoid(12),
      timestamp: Date.now(),
      category: 'scope',
      type: 'scope:graph:update',
      scopeId: '*',
      data: { root },
    };
    this.broadcast(event);
  }

  private buildScopeGraph(scope: Scope): ScopeGraphNode {
    const tools = scope.tools.listAllInstances();
    const resources = scope.resources.listAllInstances();
    const prompts = scope.prompts.listAllInstances();
    const agents = scope.agents.listAllInstances();

    return {
      id: scope.id,
      type: 'scope',
      name: scope.id,
      children: [
        ...tools.map((t) => ({
          id: `${scope.id}/tool/${t.name}`,
          type: 'tool' as const,
          name: t.name,
          children: [],
          metadata: { description: t.metadata?.description },
        })),
        ...resources.map((r) => ({
          id: `${scope.id}/resource/${r.uri}`,
          type: 'resource' as const,
          name: r.name,
          children: [],
          metadata: { description: r.metadata?.description },
        })),
        ...prompts.map((p) => ({
          id: `${scope.id}/prompt/${p.name}`,
          type: 'prompt' as const,
          name: p.name,
          children: [],
          metadata: { description: p.metadata?.description },
        })),
        ...agents.map((a) => ({
          id: `${scope.id}/agent/${a.name}`,
          type: 'agent' as const,
          name: a.name,
          children: [],
          metadata: { description: a.metadata?.description },
        })),
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Broadcasting
  // ─────────────────────────────────────────────────────────────────────────

  private broadcast(event: ManagerEvent): void {
    // Add to ring buffer
    this.eventBuffer.push(event);

    // Broadcast to connected clients
    const message: ManagerEventMessage = {
      type: 'event',
      id: event.id,
      timestamp: event.timestamp,
      event,
    };
    this.transports.broadcastToSubscribed(message, event.category);

    // Emit locally for internal listeners
    this.emit('event', event);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Client Handling
  // ─────────────────────────────────────────────────────────────────────────

  private handleClientConnect(client: ManagerClientInfo): void {
    // Send welcome message
    const welcome: ManagerWelcomeMessage = {
      type: 'welcome',
      serverId: this.serverId,
      serverVersion: '1.0.0', // TODO: Get from package.json
      protocolVersion: '1.0.0',
    };
    this.transports.send(client.id, welcome);

    // Send current state snapshot
    const state = this.buildStateSnapshot();
    const stateMessage: ManagerStateMessage = {
      type: 'state',
      id: nanoid(12),
      timestamp: Date.now(),
      state,
    };
    this.transports.send(client.id, stateMessage);

    // Send buffered events
    const bufferedEvents = this.eventBuffer.getAll();
    for (const event of bufferedEvents) {
      const message: ManagerEventMessage = {
        type: 'event',
        id: event.id,
        timestamp: event.timestamp,
        event,
      };
      this.transports.send(client.id, message);
    }

    this.emit('clientConnect', client);
  }

  private handleClientDisconnect(clientId: string, reason?: string): void {
    this.emit('clientDisconnect', clientId, reason);
  }

  private async handleCommand(clientId: string, message: ManagerCommandMessage): Promise<void> {
    const { command } = message;
    let response: ManagerResponseMessage;

    try {
      switch (command.name) {
        case 'ping':
          response = this.handlePingCommand(message.id);
          break;
        case 'getState':
          response = this.handleGetStateCommand(message.id);
          break;
        case 'subscribe':
          response = this.handleSubscribeCommand(clientId, message.id, command);
          break;
        case 'unsubscribe':
          response = this.handleUnsubscribeCommand(clientId, message.id);
          break;
        case 'listTools':
          response = this.handleListToolsCommand(message.id, command);
          break;
        case 'callTool':
          response = await this.handleCallToolCommand(message.id, command);
          break;
        case 'simulateClient':
          response = this.handleSimulateClientCommand(message.id, command);
          break;
        default:
          // Cast to any to access name property on exhaustive switch
          response = {
            type: 'response',
            commandId: message.id,
            success: false,
            error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${(command as { name: string }).name}` },
          };
      }
    } catch (err) {
      response = {
        type: 'response',
        commandId: message.id,
        success: false,
        error: {
          code: 'COMMAND_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    this.transports.send(clientId, response);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command Handlers
  // ─────────────────────────────────────────────────────────────────────────

  private handlePingCommand(commandId: string): ManagerResponseMessage {
    return {
      type: 'response',
      commandId,
      success: true,
      data: {
        pong: true,
        timestamp: Date.now(),
        uptime: Date.now() - this.startedAt,
        clients: this.transports.getTotalClientCount(),
      },
    };
  }

  private handleGetStateCommand(commandId: string): ManagerResponseMessage {
    return {
      type: 'response',
      commandId,
      success: true,
      data: this.buildStateSnapshot(),
    };
  }

  private handleSubscribeCommand(
    clientId: string,
    commandId: string,
    command: { eventCategories?: ManagerEventCategory[]; eventTypes?: string[] },
  ): ManagerResponseMessage {
    this.transports.updateClientSubscription(clientId, command.eventCategories, command.eventTypes);
    return {
      type: 'response',
      commandId,
      success: true,
      data: {
        subscribed: true,
        categories: command.eventCategories ?? [],
        types: command.eventTypes ?? [],
      },
    };
  }

  private handleUnsubscribeCommand(clientId: string, commandId: string): ManagerResponseMessage {
    this.transports.updateClientSubscription(clientId, [], []);
    return {
      type: 'response',
      commandId,
      success: true,
      data: { unsubscribed: true },
    };
  }

  private handleListToolsCommand(commandId: string, command: { scopeId: string }): ManagerResponseMessage {
    const scope = this.scopes.find((s) => s.id === command.scopeId);
    if (!scope) {
      return {
        type: 'response',
        commandId,
        success: false,
        error: { code: 'SCOPE_NOT_FOUND', message: `Scope not found: ${command.scopeId}` },
      };
    }

    const tools = scope.tools.listAllInstances().map((t) => ({
      name: t.name,
      description: t.metadata?.description,
    }));

    return {
      type: 'response',
      commandId,
      success: true,
      data: { tools },
    };
  }

  /**
   * Handle callTool command - execute a tool in a scope.
   *
   * Note: Full tool execution requires the MCP flow system with proper session context.
   * This currently returns tool information for inspection. For actual tool execution,
   * use the MCP client interface (SSE/stdio transport).
   *
   * TODO: Implement full tool execution via ManagerService when sessions are properly tracked.
   */
  private async handleCallToolCommand(
    commandId: string,
    command: { scopeId: string; toolName: string; arguments?: Record<string, unknown> },
  ): Promise<ManagerResponseMessage> {
    const scope = this.scopes.find((s) => s.id === command.scopeId);
    if (!scope) {
      return {
        type: 'response',
        commandId,
        success: false,
        error: { code: 'SCOPE_NOT_FOUND', message: `Scope not found: ${command.scopeId}` },
      };
    }

    const tool = scope.tools.listAllInstances().find((t) => t.name === command.toolName);
    if (!tool) {
      return {
        type: 'response',
        commandId,
        success: false,
        error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${command.toolName}` },
      };
    }

    // Return tool information for inspection
    // Full execution requires MCP flow system with proper session context
    return {
      type: 'response',
      commandId,
      success: true,
      data: {
        toolName: tool.name,
        description: tool.metadata?.description,
        inputSchema: tool.metadata?.inputSchema,
        providedArguments: command.arguments,
        message:
          'Tool found. Direct execution from ManagerService is not yet supported. ' +
          'Use MCP client (SSE/stdio) to execute tools with proper session context.',
      },
    };
  }

  /**
   * Handle simulateClient command - create a simulated MCP session for testing.
   *
   * This is a placeholder for future implementation.
   */
  private handleSimulateClientCommand(
    commandId: string,
    command: { scopeId: string; options?: { clientName?: string; clientVersion?: string } },
  ): ManagerResponseMessage {
    const scope = this.scopes.find((s) => s.id === command.scopeId);
    if (!scope) {
      return {
        type: 'response',
        commandId,
        success: false,
        error: { code: 'SCOPE_NOT_FOUND', message: `Scope not found: ${command.scopeId}` },
      };
    }

    // Generate a simulated session ID
    const sessionId = `sim-${nanoid(8)}`;
    const clientName = command.options?.clientName ?? 'TUI Simulator';
    const clientVersion = command.options?.clientVersion ?? '1.0.0';

    // Track the simulated session
    this.activeSessions.set(sessionId, {
      scopeId: command.scopeId,
      sessionId,
      transportType: 'simulated',
      clientInfo: { name: clientName, version: clientVersion },
      connectedAt: Date.now(),
    });

    // Emit session connect event
    this.emitSessionEvent(command.scopeId, 'session:connect', {
      sessionId,
      transportType: 'simulated' as any,
      clientInfo: { name: clientName, version: clientVersion },
    });

    return {
      type: 'response',
      commandId,
      success: true,
      data: {
        sessionId,
        clientInfo: { name: clientName, version: clientVersion },
        message: 'Simulated session created. Use this sessionId for tool calls.',
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Snapshots
  // ─────────────────────────────────────────────────────────────────────────

  private buildStateSnapshot(): ManagerStateSnapshot {
    return {
      scopes: this.scopes.map((scope) => {
        // Collect plugins from all apps in this scope
        const plugins: Array<{ name: string; version?: string; owner?: { kind: string; id: string } }> = [];
        const adapters: Array<{ name: string; description?: string; owner?: { kind: string; id: string } }> = [];

        for (const app of scope.apps.getApps()) {
          // Get plugins from this app
          const appPlugins = app.plugins.getPlugins();
          for (const p of appPlugins) {
            // Skip plugins without metadata (shouldn't happen, but be defensive)
            if (!p.metadata?.name) continue;
            plugins.push({
              name: p.metadata.name,
              owner: { kind: 'app', id: app.id },
            });
          }

          // Get adapters from this app
          const appAdapters = app.adapters.getAdapters();
          for (const a of appAdapters) {
            // Skip adapters without metadata
            if (!a.metadata?.name) continue;
            adapters.push({
              name: a.metadata.name,
              description: a.metadata?.description,
              owner: { kind: 'app', id: app.id },
            });
          }
        }

        return {
          id: scope.id,
          tools: scope.tools.listAllInstances().map((t) => ({
            name: t.name,
            description: t.metadata?.description,
            owner: t.owner ? { kind: t.owner.kind, id: t.owner.id } : undefined,
          })),
          resources: scope.resources.listAllInstances().map((r) => ({
            uri: r.uri ?? r.uriTemplate ?? '',
            name: r.name,
            description: r.metadata?.description,
            owner: r.owner ? { kind: r.owner.kind, id: r.owner.id } : undefined,
          })),
          prompts: scope.prompts.listAllInstances().map((p) => ({
            name: p.name,
            description: p.metadata?.description,
            owner: p.owner ? { kind: p.owner.kind, id: p.owner.id } : undefined,
          })),
          agents: scope.agents.listAllInstances().map((a) => ({
            name: a.name,
            description: a.metadata?.description,
            owner: a.owner ? { kind: a.owner.kind, id: a.owner.id } : undefined,
          })),
          plugins,
          adapters,
        };
      }),
      sessions: Array.from(this.activeSessions.values()),
      server: {
        name: 'FrontMCP',
        version: '1.0.0', // TODO: Get from package.json
        startedAt: this.startedAt,
        capabilities: {},
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat
  // ─────────────────────────────────────────────────────────────────────────

  private sendHeartbeat(): void {
    // Ping WebSocket clients to detect dead connections
    for (const transport of this.transports.getTransports()) {
      if (transport.type === 'websocket' && 'pingAll' in transport) {
        (transport as WebSocketTransport).pingAll();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static Factory
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if manager should be enabled based on options/environment.
   */
  static isEnabled(options?: ManagerOptionsInput): boolean {
    return isManagerEnabled(options);
  }
}
