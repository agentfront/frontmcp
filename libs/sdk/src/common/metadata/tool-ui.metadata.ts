/**
 * Tool UI Configuration Types
 *
 * Re-exports types from @frontmcp/ui/types for SDK consumers.
 * This provides a single source of truth for UI configuration types
 * while maintaining backwards compatibility.
 *
 * @see {@link https://docs.agentfront.dev/docs/servers/tools#tool-ui | Tool UI Documentation}
 */

// Re-export all UI configuration types from @frontmcp/ui
export {
  type UIContentSecurityPolicy,
  type TemplateHelpers,
  type TemplateContext,
  type TemplateBuilderFn,
  type WidgetServingMode,
  type WidgetDisplayMode,
  // Re-export UITemplateConfig as ToolUIConfig for backwards compatibility
  type UITemplateConfig as ToolUIConfig,
} from '@frontmcp/ui/types';
