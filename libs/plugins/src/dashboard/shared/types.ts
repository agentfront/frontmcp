/**
 * Shared types for dashboard plugin.
 */

/**
 * Node types in the MCP server graph.
 */
export type GraphNodeType =
  | 'server'
  | 'scope'
  | 'app'
  | 'plugin'
  | 'adapter'
  | 'tool'
  | 'resource'
  | 'resource-template'
  | 'prompt'
  | 'auth';

/**
 * Owner reference for lineage tracking.
 */
export interface GraphOwnerRef {
  kind: string;
  id: string;
}

/**
 * Prompt argument definition.
 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Node data containing metadata.
 */
export interface GraphNodeData {
  name: string;
  description?: string;
  owner?: GraphOwnerRef;
  lineage?: GraphOwnerRef[];
  // Tool-specific
  inputSchema?: unknown;
  outputSchema?: unknown;
  tags?: string[];
  annotations?: Record<string, unknown>;
  // Resource-specific
  uri?: string;
  mimeType?: string;
  // Prompt-specific
  arguments?: PromptArgument[];
  // Auth-specific
  authType?: string;
}

/**
 * A node in the MCP server graph.
 */
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  data: GraphNodeData;
}

/**
 * Edge types in the graph.
 */
export type GraphEdgeType = 'contains' | 'provides' | 'uses';

/**
 * An edge connecting two nodes in the graph.
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  label?: string;
}

/**
 * Metadata about the graph generation.
 */
export interface GraphMetadata {
  serverName: string;
  serverVersion?: string;
  generatedAt: string;
  entryFile: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Complete graph data structure.
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

/**
 * Registry change event types.
 */
export type RegistryChangeKind = 'added' | 'removed' | 'updated';

/**
 * Registry type.
 */
export type RegistryType = 'tools' | 'resources' | 'prompts' | 'adapters' | 'plugins' | 'apps';

/**
 * Registry change event payload.
 */
export interface RegistryChangeEvent {
  registry: RegistryType;
  kind: RegistryChangeKind;
  id: string;
  name?: string;
  timestamp: string;
}

/**
 * Traffic request event payload.
 */
export interface TrafficEvent {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: string;
  clientId?: string;
}

/**
 * Log entry event payload.
 */
export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Metric update event payload.
 */
export interface MetricEvent {
  name: string;
  value: number;
  unit?: string;
  timestamp: string;
  labels?: Record<string, string>;
}

/**
 * Dashboard event types for SSE.
 */
export type DashboardEvent =
  | { type: 'registry:change'; payload: RegistryChangeEvent }
  | { type: 'traffic:request'; payload: TrafficEvent }
  | { type: 'log:entry'; payload: LogEntry }
  | { type: 'metric:update'; payload: MetricEvent }
  | { type: 'graph:update'; payload: GraphData }
  | { type: 'connected'; payload: { clientId: string; timestamp: string } };

/**
 * Connection status for dashboard.
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Server info for dashboard.
 */
export interface ServerInfo {
  name: string;
  version?: string;
  url: string;
  status: ConnectionStatus;
}
