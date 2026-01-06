// Main plugin export
export { default, default as DashboardPlugin } from './dashboard.plugin';

// App export for direct usage
export { DashboardApp } from './app';

// Types and schemas
export {
  DashboardPluginOptions,
  DashboardPluginOptionsInput,
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  isDashboardEnabled,
} from './dashboard.types';

// Symbols for advanced DI usage
export { DashboardConfigToken, GraphDataProviderToken, ParentScopeToken } from './dashboard.symbol';

// Shared types
export type { GraphData, GraphNode, GraphEdge, GraphMetadata } from './shared/types';

// Provider for advanced usage
export { GraphDataProvider } from './providers';

// Tools for advanced usage
export { default as GraphTool } from './tools/graph.tool';
export { default as ListToolsTool } from './tools/list-tools.tool';
export { default as ListResourcesTool } from './tools/list-resources.tool';
