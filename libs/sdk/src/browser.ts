/**
 * @frontmcp/sdk - Browser Entry Point
 *
 * This entry point provides the browser-compatible subset of the FrontMCP SDK.
 * It excludes Node.js-specific features (HTTP server, Redis, file system operations)
 * and includes only what can run in a browser environment.
 *
 * Usage:
 * - ESM: `import { create, connect } from '@frontmcp/sdk/browser'`
 * - UMD: `<script src="frontmcp-sdk.js">` → `window.FrontMCP.create(...)`
 *
 * Included:
 * - reflect-metadata (works in browser)
 * - Common: decorators, metadata, types, schemas
 * - Errors: all error classes
 * - Context: with browser-compatible context storage
 * - Direct: create(), connect(), DirectClient, LLM formatters
 * - Transport: in-memory server only (createInMemoryServer)
 * - Tool, Resource, Prompt, Agent: entry classes
 * - Skill: registry and instances
 * - Elicitation: system
 * - ExtApps: widget message handler
 * - Config: pure functions only (parseEnvContent, schema utils)
 *
 * Excluded:
 * - process.emitWarning suppression (Node.js only)
 * - Serverless handler
 * - Remote MCP (HTTP-based remote connections)
 * - SSE/HTTP transports and Express adapter
 * - Redis event stores
 * - File-based env loaders (loadEnvFiles, populateProcessEnv)
 *
 * @packageDocumentation
 */

import 'reflect-metadata';

import { FlowHooksOf } from './common';

// ─────────────────────────────────────────────────────────────────────────────
// Core: FrontMcpInstance and Config
// ─────────────────────────────────────────────────────────────────────────────
export { FrontMcpInstance, FrontMcpConfig } from './front-mcp';

// ─────────────────────────────────────────────────────────────────────────────
// Common Module (platform-agnostic)
// ─────────────────────────────────────────────────────────────────────────────
export * from './common';
export * from './errors';
export * from './elicitation';

// Re-export MCP types commonly needed
export type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unified Context (with browser-compatible context storage)
// ─────────────────────────────────────────────────────────────────────────────
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
  // Context storage interface + browser implementation
  BrowserContextStorage,
  // Request metadata
  RequestMetadata,
  TransportAccessor,
  // Trace context
  TraceContext,
  parseTraceContext,
  generateTraceContext,
  createChildSpanContext,
} from './context';
export type { IContextStorage } from './context';

// ─────────────────────────────────────────────────────────────────────────────
// Tool change events
// ─────────────────────────────────────────────────────────────────────────────
export { ToolChangeEvent, ToolChangeKind, ToolChangeScope } from './tool/tool.events';

// ─────────────────────────────────────────────────────────────────────────────
// Skill exports
// ─────────────────────────────────────────────────────────────────────────────
export {
  SkillRegistry,
  SkillInstance,
  createSkillInstance,
  SkillEmitter,
  MemorySkillProvider,
  SkillToolValidator,
  createSkillStorageProvider,
  createMemorySkillProvider,
  normalizeSkill,
  isSkillRecord,
  formatSkillForLLM,
} from './skill';
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
} from './skill';

// ─────────────────────────────────────────────────────────────────────────────
// Agent exports
// ─────────────────────────────────────────────────────────────────────────────
export {
  Agent,
  FrontMcpAgent,
  agent,
  frontMcpAgent,
  AgentContext,
  AgentMetadata,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentSwarmConfig,
  AgentExecutionConfig,
  AgentType,
  WithConfig,
  withConfig,
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentToolCall,
  AgentToolDefinition,
} from './agent';

// ─────────────────────────────────────────────────────────────────────────────
// Hook factories
// ─────────────────────────────────────────────────────────────────────────────
export const ToolHook = FlowHooksOf('tools:call-tool');
export const ListToolsHook = FlowHooksOf('tools:list-tools');
export const HttpHook = FlowHooksOf('http:request');
export const ResourceHook = FlowHooksOf('resources:read-resource');
export const ListResourcesHook = FlowHooksOf('resources:list-resources');
export const ListResourceTemplatesHook = FlowHooksOf('resources:list-resource-templates');
export const AgentCallHook = FlowHooksOf('agents:call-agent');

// ─────────────────────────────────────────────────────────────────────────────
// ConfigPlugin (browser-safe subset: pure functions only)
// ─────────────────────────────────────────────────────────────────────────────
export {
  ConfigPlugin,
  ConfigService,
  ConfigMissingError,
  ConfigValidationError,
  ConfigPluginConfigToken,
  getConfig,
  tryGetConfig,
  // Env parsing utilities (pure functions, no file I/O)
  parseEnvContent,
  parseEnvContentSync,
  // Schema-based env mapping utilities (pure functions)
  pathToEnvKey,
  setNestedValue,
  getNestedValue,
  extractSchemaPaths,
  mapEnvToNestedConfig,
  // Config utilities (pure)
  deepMerge,
} from './builtin/config';
export type {
  ConfigPluginOptions,
  ConfigPluginOptionsInput,
  ParsedEnvConfig,
  ConfigLoaderOptions,
  ConfigEntityType,
  ConfigResolutionContext,
  ConfigResolver,
} from './builtin/config';

// Config resolver functions (pure)
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
// Direct Server Access (Programmatic / In-Memory)
// ─────────────────────────────────────────────────────────────────────────────
export { connect, connectOpenAI, connectClaude, connectLangChain, connectVercelAI } from './direct';
export type {
  DirectClient,
  ConnectOptions,
  LLMConnectOptions,
  SessionOptions,
  ClientInfo,
  LLMPlatform,
} from './direct';

export { detectPlatform, formatToolsForPlatform, formatResultForPlatform, PLATFORM_CLIENT_INFO } from './direct';
export type { OpenAITool, ClaudeTool, LangChainTool, VercelAITool, VercelAITools } from './direct';

export type { DirectMcpServer, DirectAuthContext, DirectCallOptions, DirectRequestMetadata } from './direct';

export { create, clearCreateCache } from './direct';
export type { CreateConfig } from './direct';

export { ServerRegistry } from './direct';

// In-memory server for MCP SDK Client integration
export { createInMemoryServer } from './transport';
export type { CreateInMemoryServerOptions, InMemoryServerResult } from './transport';

// Transport types
export type { TransportType, TransportKey } from './transport';

// ─────────────────────────────────────────────────────────────────────────────
// MCP Apps (ext-apps) Support
// ─────────────────────────────────────────────────────────────────────────────
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
  ExtAppsCallServerToolParams,
  ExtAppsUpdateModelContextParams,
  ExtAppsOpenLinkParams,
  ExtAppsDisplayMode,
  ExtAppsSetDisplayModeParams,
  ExtAppsCloseParams,
  ExtAppsLogLevel,
  ExtAppsLogParams,
  ExtAppsRegisterToolParams,
  ExtAppsUnregisterToolParams,
  ExtAppsHostCapabilities,
  ExtAppsWidgetCapabilities,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  ExtAppsHandlerContext,
  ExtAppsMessageHandlerOptions,
  ExtAppsJsonRpcRequest,
  ExtAppsJsonRpcResponse,
  ExtAppsJsonRpcNotification,
} from './ext-apps';

// ─────────────────────────────────────────────────────────────────────────────
// Auth Session Stores (memory only for browser)
// ─────────────────────────────────────────────────────────────────────────────
export { InMemoryOrchestratedTokenStore, type InMemoryOrchestratedTokenStoreOptions } from '@frontmcp/auth';
