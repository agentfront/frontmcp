/**
 * Base Template Module
 *
 * Provides default HTML wrappers for Tool UI widgets with:
 * - Theming (Tailwind CSS + @theme)
 * - Platform polyfills (callTool, detectMcpSession, getToolOutput)
 * - Cross-platform compatibility (OpenAI, Claude, custom hosts)
 *
 * @module @frontmcp/ui/base-template
 */

// Default base template
export {
  createDefaultBaseTemplate,
  createMinimalBaseTemplate,
  type BaseTemplateOptions,
} from './default-base-template';

// Theme styles renderer
export {
  renderThemeStyles,
  renderMinimalThemeStyles,
  renderThemeCssOnly,
  type ThemeStylesOptions,
} from './theme-styles';

// Platform polyfills
export { renderMcpSessionPolyfill, type McpSession } from './polyfills';

// Platform bridge (reactive data store)
export { renderBridgeScript, type BridgeState, type PlatformBridge, BRIDGE_TYPES } from './bridge';
