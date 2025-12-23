/**
 * @frontmcp/ui Types
 *
 * Standalone types for UI configuration that don't depend on @frontmcp/sdk.
 * These types enable external systems (like AgentLink) to use @frontmcp/ui
 * without requiring the full SDK as a dependency.
 *
 * @packageDocumentation
 */
export {
  type UIContentSecurityPolicy,
  type UIContentSecurity,
  type TemplateHelpers,
  type TemplateContext,
  type TemplateBuilderFn,
  type WidgetServingMode,
  type WidgetDisplayMode,
  type UITemplateConfig,
  type UITemplate,
} from './ui-config';
export {
  type UIType,
  type BundlingMode,
  type ResourceMode,
  type OutputMode,
  type DisplayMode,
  type CSPDirectives,
  type CDNResource,
  type RendererAssets,
  type WidgetManifest,
  type UIMetaFields,
  type OpenAIMetaFields,
  type ToolResponseMeta,
  type WidgetConfig,
  type WidgetTemplate,
  type WidgetTemplateContext,
  type WidgetTemplateHelpers,
  type WidgetRuntimeOptions,
  type BuildManifestResult,
  type BuildManifestOptions,
  isUIType,
  isBundlingMode,
  isResourceMode,
  isOutputMode,
  isDisplayMode,
  DEFAULT_CSP_BY_TYPE,
  DEFAULT_RENDERER_ASSETS,
  /** @deprecated Use UIMetaFields instead */
  type RuntimePayload,
} from './ui-runtime';
//# sourceMappingURL=index.d.ts.map
