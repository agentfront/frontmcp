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

// Request context for production-ready request handling
export {
  RequestContext,
  RequestContextArgs,
  RequestMetadata,
  RequestContextStorage,
  REQUEST_CONTEXT,
  TraceContext,
  parseTraceContext,
  generateTraceContext,
  createChildSpanContext,
  SessionKey,
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
