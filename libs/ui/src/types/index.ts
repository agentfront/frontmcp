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
  // Content Security Policy
  type UIContentSecurityPolicy,
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
