/**
 * Graph visualization types for FrontMCP server structure.
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
 * A node in the MCP server graph.
 */
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  data: {
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
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
    // Auth-specific
    authType?: string;
  };
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
 * React Flow node position.
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * React Flow compatible node.
 */
export interface ReactFlowNode extends GraphNode {
  position: NodePosition;
}

/**
 * React Flow compatible edge.
 */
export interface ReactFlowEdge extends GraphEdge {
  animated?: boolean;
  style?: Record<string, unknown>;
}

/**
 * React Flow compatible graph data.
 */
export interface ReactFlowGraphData {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  metadata: GraphMetadata;
}
