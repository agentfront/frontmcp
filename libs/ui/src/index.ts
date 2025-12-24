/**
 * @frontmcp/ui
 *
 * UI component library for FrontMCP applications.
 * Provides HTML components, React components, and rendering utilities.
 *
 * For build tools, bundling, platform adapters, and theming, use @frontmcp/uipack.
 *
 * @example HTML components
 * ```typescript
 * import { button, card, alert, badge } from '@frontmcp/ui/components';
 * import { baseLayout } from '@frontmcp/ui/layouts';
 * ```
 *
 * @example Theme (from uipack)
 * ```typescript
 * import { DEFAULT_THEME, createTheme } from '@frontmcp/uipack/theme';
 * ```
 *
 * @example React components
 * ```typescript
 * import { Button, Card, Alert, Badge } from '@frontmcp/ui/react';
 * import { useMcpBridge, useCallTool } from '@frontmcp/ui/react/hooks';
 * ```
 *
 * @example Universal renderer
 * ```typescript
 * import { UniversalApp, FrontMCPProvider } from '@frontmcp/ui/universal';
 * ```
 */

// ============================================
// HTML Components (Pure HTML string generation)
// ============================================
export * from './components';

// ============================================
// Layout System
// ============================================
export * from './layouts';

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
// Web Components
// ============================================
export {
  // Registration
  registerAllComponents,
  registerFmcpButton,
  registerFmcpCard,
  registerFmcpAlert,
  registerFmcpBadge,
  registerFmcpInput,
  registerFmcpSelect,
  // Element classes
  FmcpButton,
  FmcpCard,
  FmcpAlert,
  FmcpBadge,
  FmcpInput,
  FmcpSelect,
  // Base class for custom elements
  FmcpElement,
} from './web-components';

// ============================================
// React Components and Hooks
// ============================================
export * from './react';

// ============================================
// React Renderer and Adapter
// ============================================
export { ReactRenderer, reactRenderer, ReactRendererAdapter, createReactAdapter, loadReactAdapter } from './renderers';

// ============================================
// Universal Renderer (separate import path)
// ============================================
// Use '@frontmcp/ui/universal' for UniversalApp and related exports.
// Not re-exported here to avoid conflicts with ./react exports.

// ============================================
// SSR Bundler (separate import path)
// ============================================
// Use '@frontmcp/ui/bundler' for InMemoryBundler and related exports.
// Not re-exported here to avoid conflicts.

// ============================================
// Note: Theme, validation, utils, styles are in @frontmcp/uipack
// ============================================
// These foundational modules are in @frontmcp/uipack to avoid circular deps:
// - Theme (@frontmcp/uipack/theme)
// - Validation (@frontmcp/uipack/validation)
// - Utils (@frontmcp/uipack/utils)
// - Styles (@frontmcp/uipack/styles)
