/**
 * Dev Event Bus - Event type definitions for development dashboard
 *
 * These events are emitted by the SDK when devBus is enabled, allowing
 * the CLI dashboard to display real-time information about:
 * - Session lifecycle (connect, disconnect)
 * - API requests (tool calls, resource reads, prompts)
 * - Registry changes (tools/resources/prompts added/removed)
 * - Server status
 */

// ─────────────────────────────────────────────────────────────────────────────
// Event Categories
// ─────────────────────────────────────────────────────────────────────────────

export type DevEventCategory = 'session' | 'request' | 'registry' | 'config' | 'server';

// ─────────────────────────────────────────────────────────────────────────────
// Base Event Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface DevEventBase {
  /** Unique event ID */
  id: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Event category for filtering */
  category: DevEventCategory;
  /** Event type within category */
  type: string;
  /** Scope ID where event occurred */
  scopeId: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** Request ID if applicable */
  requestId?: string;
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
}

export interface SessionEvent extends DevEventBase {
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

export interface RequestEvent extends DevEventBase {
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
  | 'registry:agent:reset';

export interface RegistryEventData {
  /** Registry type */
  registryType: 'tool' | 'resource' | 'prompt' | 'agent';
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
}

export interface RegistryEvent extends DevEventBase {
  category: 'registry';
  type: RegistryEventType;
  data: RegistryEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Events
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigEventType = 'config:loaded' | 'config:error' | 'config:missing';

export interface ConfigEventData {
  /** Configuration path or name */
  configPath?: string;
  /** Validation errors */
  errors?: Array<{ path: string; message: string }>;
  /** Missing required config keys */
  missingKeys?: string[];
  /** Loaded config summary (keys only, no values) */
  loadedKeys?: string[];
}

export interface ConfigEvent extends DevEventBase {
  category: 'config';
  type: ConfigEventType;
  data: ConfigEventData;
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

export interface ServerEvent extends DevEventBase {
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

export interface ScopeGraphEvent extends DevEventBase {
  category: 'server';
  type: ScopeGraphEventType;
  data: ScopeGraphEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union Type
// ─────────────────────────────────────────────────────────────────────────────

export type DevEvent = SessionEvent | RequestEvent | RegistryEvent | ConfigEvent | ServerEvent | ScopeGraphEvent;

// ─────────────────────────────────────────────────────────────────────────────
// IPC Message Format
// ─────────────────────────────────────────────────────────────────────────────

/** Magic prefix for stderr-based event transport */
export const DEV_EVENT_MAGIC = '__FRONTMCP_DEV_EVENT__' as const;

/** IPC message wrapper */
export interface DevEventMessage {
  type: typeof DEV_EVENT_MAGIC;
  event: DevEvent;
}

/** Check if a message is a DevEventMessage */
export function isDevEventMessage(msg: unknown): msg is DevEventMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === DEV_EVENT_MAGIC &&
    'event' in msg
  );
}
