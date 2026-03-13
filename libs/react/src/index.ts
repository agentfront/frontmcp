/**
 * @frontmcp/react — React hooks, components, and utilities for FrontMCP.
 *
 * Entry points:
 * - `@frontmcp/react`        — Provider + hooks + components + ServerRegistry
 * - `@frontmcp/react/ai`     — AI SDK integration hooks (OpenAI, Vercel AI, Claude)
 * - `@frontmcp/react/router` — React Router integration (optional)
 *
 * @packageDocumentation
 */

// Types
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
} from './types';

// Registry (multi-server singleton)
export { ServerRegistry, serverRegistry } from './registry';
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
} from './hooks';
export type { ResolvedServerEntry, UseGetPromptReturn, UseListResourcesResult, UseStoreResourceReturn } from './hooks';

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
} from './components';
