import 'reflect-metadata';
import { FlowHooksOf } from './common';

export { FrontMcpInstance } from './front-mcp';
export {
  getServerlessHandler,
  getServerlessHandlerAsync,
  setServerlessHandler,
  setServerlessHandlerPromise,
  setServerlessHandlerError,
} from './front-mcp/serverless-handler';
export * from './common';
export * from './errors';

// Re-export MCP types commonly needed
export { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// Unified context for production-ready request handling
export {
  // Primary exports (new unified context)
  FrontMcpContext,
  Context,
  FrontMcpContextArgs,
  FrontMcpContextConfig,
  FrontMcpContextStorage,
  ContextStorage,
  FRONTMCP_CONTEXT,
  FrontMcpContextProvider,
  // Request metadata
  RequestMetadata,
  TransportAccessor,
  // Trace context
  TraceContext,
  parseTraceContext,
  generateTraceContext,
  createChildSpanContext,
} from './context';

// Tool change events for subscription
export { ToolChangeEvent, ToolChangeKind, ToolChangeScope } from './tool/tool.events';

export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');

// Resource hooks
export const ResourceHook = FlowHooksOf('resources:read-resource');
export const ListResourcesHook = FlowHooksOf('resources:list-resources');
export const ListResourceTemplatesHook = FlowHooksOf('resources:list-resource-templates');
