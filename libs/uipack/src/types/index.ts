/**
 * @frontmcp/ui Types
 *
 * Standalone types for UI configuration that don't depend on @frontmcp/sdk.
 * These types enable external systems (like AgentLink) to use @frontmcp/ui
 * without requiring the full SDK as a dependency.
 *
 * @packageDocumentation
 */

// ============================================
// UI Config Types (Legacy/Base)
// ============================================

export {
  // Content Security Policy
  type UIContentSecurityPolicy,
  // XSS Protection Options
  type UIContentSecurity,
  // Template Context & Helpers
  type TemplateHelpers,
  type TemplateContext,
  type TemplateBuilderFn,
  // Widget Serving & Display
  type WidgetServingMode,
  type WidgetDisplayMode,
  // UI Template Configuration
  type UITemplateConfig,
  type UITemplate,
} from './ui-config';

// ============================================
// Widget Runtime Types (New)
// ============================================

export {
  // Core Types
  type UIType,
  type BundlingMode,
  type ResourceMode,
  type OutputMode,
  type DisplayMode,
  // CSP & Assets
  type CSPDirectives,
  type CDNResource,
  type RendererAssets,
  // Widget Manifest
  type WidgetManifest,
  // _meta Field Types (NEW)
  type UIMetaFields,
  type OpenAIMetaFields,
  type ToolResponseMeta,
  // Widget Configuration
  type WidgetConfig,
  type WidgetTemplate,
  type WidgetTemplateContext,
  type WidgetTemplateHelpers,
  type WidgetRuntimeOptions,
  // Build Types
  type BuildManifestResult,
  type BuildManifestOptions,
  // Type Guards
  isUIType,
  isBundlingMode,
  isResourceMode,
  isOutputMode,
  isDisplayMode,
  // Default Values
  DEFAULT_CSP_BY_TYPE,
  DEFAULT_RENDERER_ASSETS,
} from './ui-runtime';
