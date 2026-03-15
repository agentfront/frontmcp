/**
 * @frontmcp/react — React hooks, components, and utilities for FrontMCP.
 *
 * Entry points:
 * - `@frontmcp/react`        — Provider + hooks + components + ServerRegistry + SDK re-exports
 * - `@frontmcp/react/ai`     — AI SDK integration hooks (OpenAI, Vercel AI, Claude)
 * - `@frontmcp/react/router` — React Router integration (optional)
 * - `@frontmcp/react/state`  — State management integration (Redux, Valtio, generic)
 * - `@frontmcp/react/api`    — API client integration (OpenAPI)
 *
 * @packageDocumentation
 */

// ─────────────────────────────────────────────────────────────────────────────
// SDK Re-exports — use @frontmcp/react as single import for everything
// ─────────────────────────────────────────────────────────────────────────────

// Factory & direct server
export { create, clearCreateCache } from '@frontmcp/sdk';
export { connect, connectOpenAI, connectClaude, connectLangChain, connectVercelAI } from '@frontmcp/sdk';
export type { CreateConfig, DirectMcpServer, DirectClient, DirectCallOptions, DirectAuthContext } from '@frontmcp/sdk';
export type { ConnectOptions, LLMPlatform } from '@frontmcp/sdk';

// Decorators (class-based tools / resources / prompts / app)
export {
  Tool,
  FrontMcpTool,
  tool,
  frontMcpTool,
  Resource,
  FrontMcpResource,
  resource,
  frontMcpResource,
  ResourceTemplate,
  FrontMcpResourceTemplate,
  resourceTemplate,
  frontMcpResourceTemplate,
  Prompt,
  FrontMcpPrompt,
  prompt,
  frontMcpPrompt,
  App,
  FrontMcpApp,
  FrontMcp,
  Adapter,
  FrontMcpAdapter,
  Plugin,
  FrontMcpPlugin,
} from '@frontmcp/sdk';

// Base context classes
export { ToolContext, ResourceContext, PromptContext, ExecutionContextBase } from '@frontmcp/sdk';

// MCP protocol result types
export type {
  GetPromptResult,
  ReadResourceResult,
  CallToolResult,
  ListToolsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  TextContent,
  ImageContent,
  PromptMessage,
} from '@frontmcp/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// React-specific types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  FrontMcpContextValue,
  ResolvedServer,
  FrontMcpStatus,
  ToolInfo,
  ResourceInfo,
  ResourceTemplateInfo,
  PromptInfo,
  ToolState,
  ResourceState,
  PromptState,
  UseCallToolOptions,
  UseCallToolReturn,
  ComponentNode,
  FieldRenderProps,
  DynamicToolDef,
  DynamicResourceDef,
  StoreAdapter,
  McpColumnDef,
} from './types';

// Registry (multi-server singleton + dynamic registry)
export { ServerRegistry, serverRegistry } from './registry';
export { DynamicRegistry } from './registry';
export type { ServerEntry } from './registry';

// Provider
export { FrontMcpContext, FrontMcpProvider } from './provider';
export type { FrontMcpProviderProps } from './provider';

// Hooks
export {
  useFrontMcp,
  useServer,
  useResolvedServer,
  useCallTool,
  useReadResource,
  useGetPrompt,
  useListTools,
  useListResources,
  useListPrompts,
  useStoreResource,
  useDynamicTool,
  useDynamicResource,
  useComponentTree,
} from './hooks';
export type { ResolvedServerEntry, UseGetPromptReturn, UseListResourcesResult, UseStoreResourceReturn } from './hooks';
export type {
  UseDynamicToolOptions,
  UseDynamicToolSchemaOptions,
  UseDynamicToolJsonSchemaOptions,
  UseDynamicResourceOptions,
  UseComponentTreeOptions,
} from './hooks';

// Components
export {
  ComponentRegistry,
  DynamicRenderer,
  readDomById,
  readDomBySelector,
  ToolForm,
  PromptForm,
  ResourceViewer,
  OutputDisplay,
  AgentContent,
  AgentSearch,
  mcpComponent,
  mcpLazy,
} from './components';
export type {
  ComponentRegistryEntry,
  DynamicRendererProps,
  DomResourceResult,
  ToolFormProps,
  PromptFormProps,
  ResourceViewerProps,
  ResourceContent,
  OutputDisplayProps,
  AgentContentProps,
  AgentSearchProps,
  SearchInputRenderProps,
  McpComponentOptions,
  McpComponentInstance,
} from './components';

// Store adapters (also available from @frontmcp/react/state)
export { reduxStore, valtioStore, createStore } from './state/adapters';

// API client types (also available from @frontmcp/react/api)
export type { HttpClient, HttpRequestConfig, HttpResponse } from './api/api.types';
