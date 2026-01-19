/**
 * Manager Service - Event and Message type definitions
 *
 * The Manager enables remote observation and control of FrontMCP servers
 * via socket-based communication (Unix, TCP, WebSocket).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Event Categories
// ─────────────────────────────────────────────────────────────────────────────

export type ManagerEventCategory = 'session' | 'request' | 'registry' | 'log' | 'server' | 'scope';

// ─────────────────────────────────────────────────────────────────────────────
// Base Event Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerEventBase {
  /** Unique event ID */
  id: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Event category for filtering */
  category: ManagerEventCategory;
  /** Event type within category */
  type: string;
  /** Scope ID where event occurred */
  scopeId: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** Request ID if applicable */
  requestId?: string;
  /** W3C trace context for distributed tracing */
  traceContext?: {
    traceId: string;
    parentId?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Events
// ─────────────────────────────────────────────────────────────────────────────

export type SessionEventType = 'session:connect' | 'session:disconnect' | 'session:idle' | 'session:active';

export interface SessionEventData {
  sessionId: string;
  transportType?: 'streamable-http' | 'sse' | 'stdio' | 'in-memory' | 'http' | 'stateless-http';
  clientInfo?: { name: string; version: string };
  platformType?: string;
  reason?: string;
  /** Duration in ms for idle/active transitions */
  durationMs?: number;
  /** Auth mode (public, transparent, orchestrated) */
  authMode?: 'public' | 'transparent' | 'orchestrated';
  /** Authenticated user info */
  authUser?: { name?: string; email?: string };
  /** Whether the session is anonymous */
  isAnonymous?: boolean;
  /** Token expiration timestamp */
  tokenExpiresAt?: number;
}

export interface SessionEvent extends ManagerEventBase {
  category: 'session';
  type: SessionEventType;
  data: SessionEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Events (Tool calls, Resource reads, Prompt gets)
// ─────────────────────────────────────────────────────────────────────────────

export type RequestEventType = 'request:start' | 'request:complete' | 'request:error';

export type RequestFlowType =
  | 'tools:call-tool'
  | 'tools:list-tools'
  | 'resources:read-resource'
  | 'resources:list-resources'
  | 'resources:list-resource-templates'
  | 'prompts:get-prompt'
  | 'prompts:list-prompts'
  | 'agents:call-agent'
  | 'initialize'
  | 'completion:complete'
  | 'logging:set-level'
  | 'http:request';

export interface RequestEventData {
  /** Flow name (tools:call-tool, resources:read-resource, etc.) */
  flowName: RequestFlowType | string;
  /** MCP method name */
  method?: string;
  /** Entry name (tool name, resource URI, prompt name) */
  entryName?: string;
  /** Entry owner for tracing */
  entryOwner?: { kind: string; id: string };
  /** Request body (optional, may be omitted for privacy) */
  requestBody?: unknown;
  /** Request headers (sanitized) */
  headers?: Record<string, string>;
  /** Response data (optional) */
  responseBody?: unknown;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the response was an error */
  isError?: boolean;
  /** Error details if failed */
  error?: {
    name: string;
    message: string;
    code?: number;
  };
}

export interface RequestEvent extends ManagerEventBase {
  category: 'request';
  type: RequestEventType;
  data: RequestEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Events
// ─────────────────────────────────────────────────────────────────────────────

export type RegistryEventType =
  | 'registry:tool:added'
  | 'registry:tool:removed'
  | 'registry:tool:updated'
  | 'registry:tool:reset'
  | 'registry:resource:added'
  | 'registry:resource:removed'
  | 'registry:resource:updated'
  | 'registry:resource:reset'
  | 'registry:prompt:added'
  | 'registry:prompt:removed'
  | 'registry:prompt:updated'
  | 'registry:prompt:reset'
  | 'registry:agent:added'
  | 'registry:agent:removed'
  | 'registry:agent:updated'
  | 'registry:agent:reset'
  | 'registry:plugin:added'
  | 'registry:plugin:removed'
  | 'registry:plugin:updated'
  | 'registry:plugin:reset'
  | 'registry:adapter:added'
  | 'registry:adapter:removed'
  | 'registry:adapter:updated'
  | 'registry:adapter:reset';

/** Entry details for registry events */
export interface RegistryEntryInfo {
  /** Entry name */
  name: string;
  /** Entry description */
  description?: string;
  /** Owner info */
  owner?: { kind: string; id: string };
  /** Tool-specific: input schema */
  inputSchema?: unknown;
  /** Resource-specific: URI or URI template */
  uri?: string;
  /** Plugin-specific: version */
  version?: string;
}

export interface RegistryEventData {
  /** Registry type */
  registryType: 'tool' | 'resource' | 'prompt' | 'agent' | 'plugin' | 'adapter';
  /** Entry name(s) affected */
  entryNames?: string[];
  /** Change kind */
  changeKind: 'added' | 'removed' | 'updated' | 'reset';
  /** Change scope */
  changeScope: 'global' | 'session';
  /** Owner info */
  owner?: { kind: string; id: string };
  /** Current snapshot count */
  snapshotCount: number;
  /** Version number after change */
  version: number;
  /** Full entry details (for added/updated/reset events) */
  entries?: RegistryEntryInfo[];
}

export interface RegistryEvent extends ManagerEventBase {
  category: 'registry';
  type: RegistryEventType;
  data: RegistryEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Events
// ─────────────────────────────────────────────────────────────────────────────

export type LogEventType = 'log:debug' | 'log:info' | 'log:warn' | 'log:error' | 'log:verbose';

export interface LogEventData {
  /** Log level name */
  level: string;
  /** Log message */
  message: string;
  /** Additional arguments */
  args?: unknown[];
  /** Logger prefix/namespace */
  prefix: string;
}

export interface LogEvent extends ManagerEventBase {
  category: 'log';
  type: LogEventType;
  data: LogEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Events
// ─────────────────────────────────────────────────────────────────────────────

export type ServerEventType = 'server:starting' | 'server:ready' | 'server:error' | 'server:shutdown';

export interface ServerEventData {
  /** Server info */
  serverInfo?: { name: string; version: string };
  /** Server capabilities */
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
  };
  /** Listen port/address */
  address?: string;
  /** Uptime in milliseconds */
  uptimeMs?: number;
  /** Error message if failed */
  error?: string;
}

export interface ServerEvent extends ManagerEventBase {
  category: 'server';
  type: ServerEventType;
  data: ServerEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Graph Event (for visualization)
// ─────────────────────────────────────────────────────────────────────────────

export type ScopeGraphEventType = 'scope:graph:update';

export interface ScopeGraphNode {
  id: string;
  type: 'scope' | 'app' | 'plugin' | 'tool' | 'resource' | 'prompt' | 'agent';
  name: string;
  children: ScopeGraphNode[];
  metadata?: Record<string, unknown>;
}

export interface ScopeGraphEventData {
  /** Root node of the scope graph */
  root: ScopeGraphNode;
}

export interface ScopeGraphEvent extends ManagerEventBase {
  category: 'scope';
  type: ScopeGraphEventType;
  data: ScopeGraphEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace Event Data Map (for type-safe logging)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps trace event types to their corresponding data shapes.
 * Used to provide type safety in the trace logging pipeline.
 */
export type TraceEventDataMap = {
  'session:connect': SessionEventData;
  'session:disconnect': SessionEventData;
  'session:idle': SessionEventData;
  'session:active': SessionEventData;
  'request:start': RequestEventData;
  'request:complete': RequestEventData;
  'request:error': RequestEventData;
  'server:starting': ServerEventData;
  'server:ready': ServerEventData;
  'server:error': ServerEventData;
  'server:shutdown': ServerEventData;
};

// ─────────────────────────────────────────────────────────────────────────────
// Union Event Type
// ─────────────────────────────────────────────────────────────────────────────

export type ManagerEvent = SessionEvent | RequestEvent | RegistryEvent | LogEvent | ServerEvent | ScopeGraphEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Message Protocol (Socket Communication)
// ─────────────────────────────────────────────────────────────────────────────

/** Event message from server to client */
export interface ManagerEventMessage {
  type: 'event';
  id: string;
  timestamp: number;
  event: ManagerEvent;
}

/** Initial state snapshot sent to new clients */
export interface ManagerStateSnapshot {
  /** All active scopes */
  scopes: Array<{
    id: string;
    tools: Array<{ name: string; description?: string; owner?: { kind: string; id: string } }>;
    resources: Array<{ uri: string; name: string; description?: string; owner?: { kind: string; id: string } }>;
    prompts: Array<{ name: string; description?: string; owner?: { kind: string; id: string } }>;
    agents: Array<{ name: string; description?: string; owner?: { kind: string; id: string } }>;
    /** Plugins registered in this scope */
    plugins?: Array<{ name: string; version?: string; owner?: { kind: string; id: string } }>;
    /** Adapters registered in this scope */
    adapters?: Array<{ name: string; description?: string; owner?: { kind: string; id: string } }>;
  }>;
  /** Active sessions per scope */
  sessions: Array<{
    scopeId: string;
    sessionId: string;
    transportType: string;
    clientInfo?: { name: string; version: string };
    connectedAt: number;
    /** Auth mode (public, transparent, orchestrated) */
    authMode?: string;
    /** Authenticated user info */
    authUser?: { name?: string; email?: string };
    /** Whether the session is anonymous */
    isAnonymous?: boolean;
  }>;
  /** Server info */
  server: {
    name: string;
    version: string;
    startedAt: number;
    capabilities: Record<string, unknown>;
  };
}

/** State snapshot message */
export interface ManagerStateMessage {
  type: 'state';
  id: string;
  timestamp: number;
  state: ManagerStateSnapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Protocol (Client to Server)
// ─────────────────────────────────────────────────────────────────────────────

/** Base command interface */
export interface ManagerCommandBase {
  name: string;
}

/** Get current state snapshot */
export interface GetStateCommand extends ManagerCommandBase {
  name: 'getState';
}

/** Subscribe to specific event types */
export interface SubscribeCommand extends ManagerCommandBase {
  name: 'subscribe';
  eventCategories?: ManagerEventCategory[];
  eventTypes?: string[];
}

/** Unsubscribe from events */
export interface UnsubscribeCommand extends ManagerCommandBase {
  name: 'unsubscribe';
}

/** Health check */
export interface PingCommand extends ManagerCommandBase {
  name: 'ping';
}

/** Simulate MCP client connection */
export interface SimulateClientCommand extends ManagerCommandBase {
  name: 'simulateClient';
  scopeId: string;
  options?: {
    clientName?: string;
    clientVersion?: string;
  };
}

/** List available tools in a scope */
export interface ListToolsCommand extends ManagerCommandBase {
  name: 'listTools';
  scopeId: string;
}

/** Call a tool in a scope */
export interface CallToolCommand extends ManagerCommandBase {
  name: 'callTool';
  scopeId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export type ManagerCommand =
  | GetStateCommand
  | SubscribeCommand
  | UnsubscribeCommand
  | PingCommand
  | SimulateClientCommand
  | ListToolsCommand
  | CallToolCommand;

/** Command message from client to server */
export interface ManagerCommandMessage {
  type: 'command';
  id: string;
  command: ManagerCommand;
}

/** Response message from server to client */
export interface ManagerResponseMessage {
  type: 'response';
  commandId: string;
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/** Welcome message sent on connection */
export interface ManagerWelcomeMessage {
  type: 'welcome';
  serverId: string;
  serverVersion: string;
  protocolVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// All Message Types
// ─────────────────────────────────────────────────────────────────────────────

export type ManagerServerMessage =
  | ManagerEventMessage
  | ManagerStateMessage
  | ManagerResponseMessage
  | ManagerWelcomeMessage;

export type ManagerClientMessage = ManagerCommandMessage;

// ─────────────────────────────────────────────────────────────────────────────
// Client Connection Info
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerClientInfo {
  /** Unique client ID */
  id: string;
  /** Transport type (unix, tcp, websocket) */
  transport: 'unix' | 'tcp' | 'websocket';
  /** Connected at timestamp */
  connectedAt: number;
  /** Remote address if available */
  remoteAddress?: string;
  /** Subscribed event categories */
  subscribedCategories: Set<ManagerEventCategory>;
  /** Subscribed event types (more granular) */
  subscribedTypes: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MANAGER_PROTOCOL_VERSION = '1.0.0';
