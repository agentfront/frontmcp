/**
 * Dashboard event types - shared between CLI and SDK
 *
 * These types mirror the SDK's DevEvent types but are defined here
 * to avoid a direct dependency on the SDK in the CLI package.
 */

// Re-export the magic prefix constant
export const DEV_EVENT_MAGIC = '__FRONTMCP_DEV_EVENT__' as const;

// ─────────────────────────────────────────────────────────────────────────────
// Event Categories
// ─────────────────────────────────────────────────────────────────────────────

export type DevEventCategory = 'session' | 'request' | 'registry' | 'config' | 'server';

// ─────────────────────────────────────────────────────────────────────────────
// Base Event Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface DevEventBase {
  id: string;
  timestamp: number;
  category: DevEventCategory;
  type: string;
  scopeId: string;
  sessionId?: string;
  requestId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Events
// ─────────────────────────────────────────────────────────────────────────────

export type SessionEventType = 'session:connect' | 'session:disconnect' | 'session:idle' | 'session:active';

export interface SessionEventData {
  sessionId: string;
  transportType?: string;
  clientInfo?: { name: string; version: string };
  platformType?: string;
  reason?: string;
  durationMs?: number;
}

export interface SessionEvent extends DevEventBase {
  category: 'session';
  type: SessionEventType;
  data: SessionEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Events
// ─────────────────────────────────────────────────────────────────────────────

export type RequestEventType = 'request:start' | 'request:complete' | 'request:error';

export interface RequestEventData {
  flowName: string;
  method?: string;
  entryName?: string;
  entryOwner?: { kind: string; id: string };
  requestBody?: unknown;
  headers?: Record<string, string>;
  responseBody?: unknown;
  durationMs?: number;
  isError?: boolean;
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
  registryType: 'tool' | 'resource' | 'prompt' | 'agent';
  entryNames?: string[];
  changeKind: 'added' | 'removed' | 'updated' | 'reset';
  changeScope: 'global' | 'session';
  owner?: { kind: string; id: string };
  snapshotCount: number;
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
  configPath?: string;
  errors?: Array<{ path: string; message: string }>;
  missingKeys?: string[];
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
  serverInfo?: { name: string; version: string };
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
  };
  address?: string;
  uptimeMs?: number;
  error?: string;
}

export interface ServerEvent extends DevEventBase {
  category: 'server';
  type: ServerEventType;
  data: ServerEventData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Graph Event
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
// IPC Message
// ─────────────────────────────────────────────────────────────────────────────

export interface DevEventMessage {
  type: typeof DEV_EVENT_MAGIC;
  event: DevEvent;
}

export function isDevEventMessage(msg: unknown): msg is DevEventMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === DEV_EVENT_MAGIC &&
    'event' in msg
  );
}
