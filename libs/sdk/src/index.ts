import 'reflect-metadata';

import { FlowHooksOf } from './common';

// NOTE: Importing `@frontmcp/sdk` installs a small global `process.emitWarning` filter.
// It suppresses a noisy Express deprecation warning ("req.host has been replaced by req.hostname")
// that can be triggered when validating request-like objects with Zod v4.
// Express docs: https://expressjs.com/en/4x/api.html#req.hostname
(function suppressZodExpressWarning() {
  if (typeof process === 'undefined' || typeof process.emitWarning !== 'function') return;
  const originalEmitWarning = process.emitWarning.bind(process);

  (process as any).emitWarning = (warning: string | Error, ...args: any[]) => {
    const message = typeof warning === 'string' ? warning : warning?.message;
    if (message?.includes('req.host') && message?.includes('req.hostname')) {
      return; // Suppress the Express req.host deprecation warning from Zod v4
    }
    return originalEmitWarning(warning, ...args);
  };
})();

export { FrontMcpInstance, FrontMcpConfig } from './front-mcp';
export type { ConfigOrServerClass } from './front-mcp';
export {
  getServerlessHandler,
  getServerlessHandlerAsync,
  setServerlessHandler,
  setServerlessHandlerPromise,
  setServerlessHandlerError,
} from './front-mcp/serverless-handler';
export * from './common';
export * from './errors';
export * from './elicitation';
export * from './task';
export { default as LoggerRegistry } from './logger/logger.registry';
export * from '@frontmcp/guard';
export * from './remote-mcp';
export * from './esm-loader';

// Lazy-zod: `z` is lazy by default for cold-start wins, `eagerZ` is the
// straight zod pass-through, `lazyZ` is the explicit factory form.
// See libs/lazy-zod/README.md for the rationale and POC numbers.
// Also mirror zod's `export default z` so `import z from '@frontmcp/lazy-zod'`
// (the namespace-default form) keeps working after migration.
export { default } from '@frontmcp/lazy-zod';
export {
  z,
  eagerZ,
  lazyZ,
  isLazy,
  forceMaterialize,
  LazyZodSchema,
  type InferLazy,
  // JSON-Schema helpers re-exported through the single zod boundary.
  toJSONSchema,
  type JSONSchema,
  // Zod v4 class values + type aliases, re-exported so consumers never
  // import from `zod` directly (per project convention).
  NEVER,
  ZodAny,
  ZodArray,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEnum,
  ZodError,
  ZodIntersection,
  ZodLiteral,
  ZodNever,
  ZodNull,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodString,
  ZodSymbol,
  ZodTuple,
  ZodType,
  ZodUndefined,
  ZodUnion,
  ZodUnknown,
  ZodVoid,
  type ZodTypeAny,
  type ZodRawShape,
  // Utility type aliases (z.infer / z.input / z.output)
  type infer,
  type input,
  type output,
} from '@frontmcp/lazy-zod';

// Re-export MCP types commonly needed by consumers
export type {
  // Result types (used as return type annotations in execute() methods)
  GetPromptResult,
  ReadResourceResult,
  CallToolResult,
  ListToolsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  // Server/Client metadata (used by DirectClient interface)
  ServerCapabilities,
  Implementation,
  ClientCapabilities,
  // Content types (used in tool/prompt results)
  TextContent,
  ImageContent,
  PromptMessage,
} from '@frontmcp/protocol';

// Unified context for production-ready request handling
export {
  // Primary exports (new unified context)
  FrontMcpContext,
  Context,
  FrontMcpContextStorage,
  FRONTMCP_CONTEXT,
  FrontMcpContextProvider,
  // Trace context
  parseTraceContext,
  generateTraceContext,
  createChildSpanContext,
} from './context';
export type {
  FrontMcpContextArgs,
  FrontMcpContextConfig,
  RequestMetadata,
  TransportAccessor,
  TraceContext,
} from './context';

// Tool change events for subscription
export type { ToolChangeEvent, ToolChangeKind, ToolChangeScope } from './tool/tool.events';

// Tool registry / instance / provider registry — exposed so plugins can
// register synthetic tools at runtime (e.g. plugin-skilled-openapi's
// internal-tool adapter for OpenAPI operations).
export { default as ToolRegistry } from './tool/tool.registry';
export { ToolInstance } from './tool/tool.instance';
export { default as ProviderRegistry } from './provider/provider.registry';

// Job exports - saved, discoverable, triggerable executions
export { JobRegistry, JobInstance, JobPermissionGuard, JobExecutionManager, JobEmitter } from './job';
export type {
  JobRegistryInterface,
  IndexedJob,
  JobChangeEvent,
  JobChangeKind,
  JobChangeScope,
  ExecuteJobOptions,
  ExecuteWorkflowOptions,
  InlineJobResult,
  BackgroundJobResult,
} from './job';
export type { JobStateStore, JobRunRecord, WorkflowRunRecord, JobExecutionState, JobDefinitionStore } from './job';

// Job-management tool classes (issue #408 — opt-in manual registration via
// @App({ tools: [...] }) when finer-grained control than auto-registration
// is needed, e.g. to omit register_job / remove_job in production).
export { ExecuteJobTool, GetJobStatusTool, ListJobsTool, RegisterJobTool, RemoveJobTool } from './job/tools';

// Workflow exports - managed multi-step job pipelines
export { WorkflowRegistry, WorkflowInstance, WorkflowEngine, WorkflowStepExecutor, WorkflowEmitter } from './workflow';
export type {
  WorkflowRegistryInterface,
  IndexedWorkflow,
  WorkflowChangeEvent,
  WorkflowChangeKind,
  WorkflowChangeScope,
} from './workflow';

// Workflow-management tool classes (issue #408)
export {
  ExecuteWorkflowTool,
  GetWorkflowStatusTool,
  ListWorkflowsTool,
  RegisterWorkflowTool,
  RemoveWorkflowTool,
} from './workflow/tools';

// Channel exports - push-based notification channels for Claude Code
export {
  ChannelInstance,
  ChannelRegistry,
  ChannelEmitter,
  ChannelNotificationService,
  ChannelEventBus,
  ChannelReplyTool,
} from './channel';
export type {
  ChannelRegistryInterface,
  IndexedChannel,
  ChannelChangeEvent,
  ChannelChangeKind,
  ChannelChangeScope,
  ChannelReplyInput,
  RegisterChannelCapabilitiesArgs,
  ChannelCapabilitiesResult,
} from './channel';

// Skill exports - skills are knowledge/workflow packages for multi-step tasks
export {
  // Registry
  SkillRegistry,
  // Instance
  SkillInstance,
  createSkillInstance,
  // Events
  SkillEmitter,
  // Providers
  MemorySkillProvider,
  // Validator
  SkillToolValidator,
  // Factory
  createSkillStorageProvider,
  createMemorySkillProvider,
  // Utilities
  normalizeSkill,
  isSkillRecord,
  formatSkillForLLM,
  // Directory loader (used by user-defined directory-based skills)
  loadSkillDirectory,
  scanSkillResources,
  skillDir,
  // Initialize-instructions composition
  buildSkillsCatalogSummary,
  composeInitializeInstructions,
  buildChannelInstructions,
  // Skill audit log helper (Edge-runtime-safe factory injection)
  setSkillAuditFactory,
  hasSkillAuditFactory,
} from './skill';
export type { SkillAuditFactory, AuditModuleShape } from './skill';
export type {
  SkillRegistryInterface,
  IndexedSkill,
  SkillChangeEvent,
  SkillChangeKind,
  SkillChangeScope,
  SkillStorageProvider,
  SkillStorageProviderType,
  SkillSearchOptions,
  SkillSearchResult,
  SkillLoadResult,
  SkillListOptions,
  SkillListResult,
  ToolValidationResult,
  SkillStorageFactoryOptions,
  SkillStorageFactoryResult,
  InjectInstructionsPolicy,
  SkillIndexCache,
  SkillIndexScoring,
} from './skill';

// Agent exports - only user-facing APIs
export {
  // Decorator and builder
  Agent,
  FrontMcpAgent,
  agent,
  frontMcpAgent,
  // Context class
  AgentContext,
  withConfig,
} from './agent';
export type {
  AgentMetadata,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentSwarmConfig,
  AgentExecutionConfig,
  AgentType,
  WithConfig,
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentToolCall,
  AgentToolDefinition,
} from './agent';

// LLM Adapters (direct SDK wrappers)
export { OpenAIAdapter, AnthropicAdapter } from './agent/adapters';
export type { OpenAIAdapterConfig, OpenAIApiMode, AnthropicAdapterConfig } from './agent/adapters';

export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');

// Custom authorization-UI primitives (#469) are configured via the `auth.ui`
// slot→file map + `auth.extras` name→handler map on the auth config — there is
// no decorator and no class. The `AuthSlot` / `AuthUiMap` / `AuthExtraHandler` /
// `AuthExtraContext` / `AuthExtraResult` types are surfaced via the auth options
// re-export (`@frontmcp/auth` → `./common`), and the SSR machinery (registry,
// page assembly) is internal.

// OAuth flow hooks (local-mode authorization server). Exported so the OAuth AS
// flow augmentations land in the public type graph and `FlowHooksOf('oauth:*')`
// typechecks for consumers — no more `as any` to hook login/callback/token (#460).
export const OAuthAuthorizeHook = FlowHooksOf('oauth:authorize');
export const OAuthCallbackHook = FlowHooksOf('oauth:callback');
export const OAuthTokenHook = FlowHooksOf('oauth:token');
export const OAuthRegisterHook = FlowHooksOf('oauth:register');

// Resource hooks
export const ResourceHook = FlowHooksOf('resources:read-resource');
export const ListResourcesHook = FlowHooksOf('resources:list-resources');
export const ListResourceTemplatesHook = FlowHooksOf('resources:list-resource-templates');

// Agent hooks
export const AgentCallHook = FlowHooksOf('agents:call-agent');

// Channel hooks
export const ChannelSendHook = FlowHooksOf('channels:send-notification');
export const ChannelListHook = FlowHooksOf('channels:list');

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

// Connect utilities - create DirectClient connections with LLM-aware formatting
export { connect, connectOpenAI, connectClaude, connectLangChain, connectVercelAI } from './direct';
export type {
  DirectClient,
  ConnectOptions,
  LLMConnectOptions,
  SessionOptions,
  ClientInfo,
  LLMPlatform,
} from './direct';

// LLM platform utilities (for advanced use)
export { detectPlatform, formatToolsForPlatform, formatResultForPlatform, PLATFORM_CLIENT_INFO } from './direct';
export type {
  OpenAITool,
  ClaudeTool,
  LangChainTool,
  VercelAITool,
  VercelAITools,
  FormattedToolResult,
  FormattedTools,
} from './direct';

// DirectClient Job/Workflow types (for client-side operations)
export type {
  ListJobsOptions,
  ListJobsResult,
  JobExecutionResult,
  JobStatusResult,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  WorkflowExecutionResult,
  WorkflowStatusResult,
} from './direct';

// Direct MCP Server - legacy programmatic access without HTTP transport
export type { DirectMcpServer, DirectAuthContext, DirectCallOptions, DirectRequestMetadata } from './direct';

// create() factory — flat-config direct server creation
export { create, clearCreateCache } from './direct';
export type { CreateConfig } from './direct';

// In-memory server for MCP SDK Client integration
export { createInMemoryServer } from './transport';
export type { CreateInMemoryServerOptions, InMemoryServerResult } from './transport';

// Web-standard fetch handler (Cloudflare Workers / Deno / Bun) — no Express/Node shim
export { createWebFetchHandler, runHttpRequestFlowWeb } from './transport';
export type {
  WebFetchHandler,
  CreateWebFetchHandlerOptions,
  WebFetchCorsOptions,
  WebFetchSessionRouter,
  FetchHandlerCtx,
} from './transport';

// Web-standard MCP transport helpers — stateless runner + persistent (Durable
// Object) session builder, for the Cloudflare DO session host.
export { runWebStandardMcp, buildPersistentWebStandardMcp } from './transport';
export type { WebStandardMcpPair, RunWebStandardMcpOptions } from './transport';


// Transport types
export type { TransportType, TransportKey } from './transport';

// ─────────────────────────────────────────────────────────────────────────────
// MCP Apps (ext-apps) Support
// ─────────────────────────────────────────────────────────────────────────────

// ext-apps message handler for bidirectional widget communication
export {
  ExtAppsMessageHandler,
  createExtAppsMessageHandler,
  EXT_APPS_ERROR_CODES,
  ExtAppsError,
  ExtAppsMethodNotFoundError,
  ExtAppsInvalidParamsError,
  ExtAppsNotSupportedError,
  ExtAppsToolNotFoundError,
} from './ext-apps';

export type {
  // Core message params
  ExtAppsCallServerToolParams,
  ExtAppsUpdateModelContextParams,
  ExtAppsOpenLinkParams,
  // Display and lifecycle
  ExtAppsDisplayMode,
  ExtAppsSetDisplayModeParams,
  ExtAppsCloseParams,
  // Logging
  ExtAppsLogLevel,
  ExtAppsLogParams,
  // Widget-defined tools
  ExtAppsRegisterToolParams,
  ExtAppsUnregisterToolParams,
  // Capabilities
  ExtAppsHostCapabilities,
  ExtAppsWidgetCapabilities,
  // Initialization
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  // Handler context
  ExtAppsHandlerContext,
  ExtAppsMessageHandlerOptions,
  // JSON-RPC types
  ExtAppsJsonRpcRequest,
  ExtAppsJsonRpcResponse,
  ExtAppsJsonRpcNotification,
} from './ext-apps';

// ─────────────────────────────────────────────────────────────────────────────
// Auth Session Stores
// ─────────────────────────────────────────────────────────────────────────────

// Orchestrated token store for upstream provider tokens
export { InMemoryOrchestratedTokenStore, type InMemoryOrchestratedTokenStoreOptions } from '@frontmcp/auth';
