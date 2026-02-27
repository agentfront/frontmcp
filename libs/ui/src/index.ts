/**
 * @frontmcp/ui
 *
 * MUI-based React component library for FrontMCP applications.
 * Provides themed components, content renderers, and MCP bridge hooks.
 *
 * @example Theme
 * ```typescript
 * import { FrontMcpThemeProvider, createFrontMcpTheme } from '@frontmcp/ui/theme';
 * ```
 *
 * @example Components
 * ```typescript
 * import { FmcpButton, FmcpCard, FmcpAlert } from '@frontmcp/ui/components';
 * ```
 *
 * @example React hooks
 * ```typescript
 * import { useMcpBridge, useCallTool } from '@frontmcp/ui/react';
 * ```
 *
 * @example Renderer
 * ```typescript
 * import { renderContent, detectContentType } from '@frontmcp/ui/renderer';
 * ```
 */

// ============================================
// MCP Bridge
// ============================================
export {
  // Core types
  type PlatformAdapter,
  type AdapterCapabilities,
  type BridgeConfig,
  // Bridge class
  FrontMcpBridge,
  createBridge,
  // Registry
  AdapterRegistry,
  defaultRegistry,
  registerAdapter,
  // Runtime script generation
  generateBridgeIIFE,
  generatePlatformBundle,
  UNIVERSAL_BRIDGE_SCRIPT,
  BRIDGE_SCRIPT_TAGS,
} from './bridge';

// ============================================
// React Hooks (re-exported for convenience)
// ============================================
export * from './react';

// ============================================
// Theme, Components, and Renderer are available
// via subpath imports:
//   @frontmcp/ui/theme
//   @frontmcp/ui/components
//   @frontmcp/ui/renderer
// ============================================
