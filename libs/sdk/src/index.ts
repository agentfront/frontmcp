import 'reflect-metadata';

// Suppress Express req.host deprecation warning triggered by Zod v4 during object validation
// Zod v4 internally accesses .host on objects which triggers Express's deprecation warning
// This is harmless but noisy - see: https://github.com/colinhacks/zod/issues
(function suppressZodExpressWarning() {
  const originalEmitWarning = process.emitWarning.bind(process);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).emitWarning = (warning: string | Error, ...args: any[]) => {
    const message = typeof warning === 'string' ? warning : warning?.message;
    if (message?.includes('req.host') && message?.includes('req.hostname')) {
      return; // Suppress the Express req.host deprecation warning from Zod v4
    }
    return originalEmitWarning(warning, ...args);
  };
})();

import { FlowHooksOf } from './common';

export { FrontMcpInstance, FrontMcpConfig } from './front-mcp';
export {
  getServerlessHandler,
  getServerlessHandlerAsync,
  setServerlessHandler,
  setServerlessHandlerPromise,
  setServerlessHandlerError,
} from './front-mcp/serverless-handler';
export * from './common';
export * from './errors';
export * from './remote-mcp';

// Re-export MCP types commonly needed
export type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

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

// Agent exports - only user-facing APIs
export {
  // Decorator and builder
  Agent,
  FrontMcpAgent,
  agent,
  frontMcpAgent,
  // Context class
  AgentContext,
  // Types
  AgentMetadata,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentSwarmConfig,
  AgentExecutionConfig,
  AgentType,
  WithConfig,
  withConfig,
  // Adapter interface (for custom adapters)
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentToolCall,
  AgentToolDefinition,
} from './agent';

export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');

// Resource hooks
export const ResourceHook = FlowHooksOf('resources:read-resource');
export const ListResourcesHook = FlowHooksOf('resources:list-resources');
export const ListResourceTemplatesHook = FlowHooksOf('resources:list-resource-templates');

// Agent hooks
export const AgentCallHook = FlowHooksOf('agents:call-agent');
