import 'reflect-metadata';

// NOTE: Importing `@frontmcp/sdk` installs a small global `process.emitWarning` filter.
// It suppresses a noisy Express deprecation warning ("req.host has been replaced by req.hostname")
// that can be triggered when validating request-like objects with Zod v4.
// Express docs: https://expressjs.com/en/4x/api.html#req.hostname
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

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Plugins
// ─────────────────────────────────────────────────────────────────────────────

// ConfigPlugin - Environment variable management (built-in, no separate install required)
export {
  ConfigPlugin,
  ConfigService,
  ConfigMissingError,
  ConfigValidationError,
  ConfigPluginConfigToken,
  getConfig,
  tryGetConfig,
  // Env loader utilities
  loadEnvFiles,
  parseEnvContent,
  parseEnvContentSync,
  populateProcessEnv,
  // Schema-based env mapping utilities
  pathToEnvKey,
  setNestedValue,
  getNestedValue,
  extractSchemaPaths,
  mapEnvToNestedConfig,
  // Config loader
  loadConfig,
  deepMerge,
} from './builtin/config';
export type {
  ConfigPluginOptions,
  ConfigPluginOptionsInput,
  ParsedEnvConfig,
  ConfigLoaderOptions,
  // Config resolver types
  ConfigEntityType,
  ConfigResolutionContext,
  ConfigResolver,
} from './builtin/config';

// Config resolver functions
export {
  normalizeNameForEnv,
  normalizePathSegment,
  generateFallbacks,
  generateEnvFallbacks,
  resolveWithFallbacks,
  createContextResolver,
  createDirectResolver,
} from './builtin/config';

// ─────────────────────────────────────────────────────────────────────────────
// Direct Server Access (Programmatic / In-Memory / Stdio)
// ─────────────────────────────────────────────────────────────────────────────

// Direct MCP Server - programmatic access without HTTP transport
export type { DirectMcpServer, DirectAuthContext, DirectCallOptions, DirectRequestMetadata } from './direct';

// In-memory server for MCP SDK Client integration
export { createInMemoryServer } from './transport';
export type { CreateInMemoryServerOptions, InMemoryServerResult } from './transport';

// Transport types
export type { TransportType, TransportKey } from './transport';

// ─────────────────────────────────────────────────────────────────────────────
// Manager Service (Remote Observation & Control)
// ─────────────────────────────────────────────────────────────────────────────

// Manager service for socket-based TUI/dashboard integration
export {
  ManagerService,
  isManagerEnabled,
  parseManagerOptions,
  managerOptionsSchema,
  getManagerLogTransport,
  ManagerLogTransport,
  MANAGER_PROTOCOL_VERSION,
} from './manager';
export type {
  ManagerEvent,
  ManagerEventBase,
  ManagerEventCategory,
  ManagerOptions,
  ManagerOptionsInput,
  SessionEvent,
  RequestEvent,
  RegistryEvent,
  LogEvent,
  ServerEvent,
  ScopeGraphEvent,
  ScopeGraphNode,
  ManagerEventMessage,
  ManagerStateMessage,
  ManagerStateSnapshot,
  ManagerCommand,
  ManagerCommandMessage,
  ManagerResponseMessage,
  ManagerClientInfo,
} from './manager';
