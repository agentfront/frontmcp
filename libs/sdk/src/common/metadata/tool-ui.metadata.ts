/**
 * Tool UI Configuration Types
 *
 * Re-exports types from @frontmcp/uipack/types for SDK consumers.
 * This provides a single source of truth for UI configuration types
 * while maintaining backwards compatibility.
 *
 * @see {@link https://docs.agentfront.dev/docs/servers/tools#tool-ui | Tool UI Documentation}
 */

// Re-export all UI configuration types from @frontmcp/uipack
export {
  // Legacy UI Config Types
  type UIContentSecurityPolicy,
  type TemplateHelpers,
  type TemplateContext,
  type TemplateBuilderFn,
  type WidgetServingMode,
  type WidgetDisplayMode,
  // Re-export UITemplateConfig as ToolUIConfig for backwards compatibility
  type UITemplateConfig as ToolUIConfig,
  // New Widget Runtime Types
  type UIType,
  type BundlingMode,
  type DisplayMode,
  type ResourceMode,
  type CSPDirectives,
  type RendererAssets,
  type WidgetManifest,
  type RuntimePayload,
  type WidgetConfig,
  type WidgetTemplate,
  type WidgetRuntimeOptions,
  type BuildManifestResult,
  type BuildManifestOptions,
} from '@frontmcp/uipack/types';
