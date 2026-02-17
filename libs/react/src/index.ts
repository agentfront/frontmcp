/**
 * @frontmcp/react — React hooks, components, and utilities for FrontMCP.
 *
 * Entry points:
 * - `@frontmcp/react`        — SDK re-exports + Provider + hooks + components
 * - `@frontmcp/react/ai`     — AI SDK integration hooks (OpenAI, Vercel AI, Claude)
 * - `@frontmcp/react/router` — React Router integration (optional)
 *
 * @packageDocumentation
 */

// SDK re-exports
export * from './sdk-reexports';

// Types
export type {
  FrontMcpContextValue,
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

// Provider
export { FrontMcpContext, FrontMcpProvider } from './provider';
export type { FrontMcpProviderProps } from './provider';

// Hooks
export {
  useFrontMcp,
  useCallTool,
  useReadResource,
  useGetPrompt,
  useListTools,
  useListResources,
  useListPrompts,
  useStoreResource,
} from './hooks';
export type { UseGetPromptReturn, UseListResourcesResult, UseStoreResourceReturn } from './hooks';

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
