/**
 * @frontmcp/ui
 *
 * React components and hooks for FrontMCP applications.
 * This package provides React-specific UI components, hooks, and rendering utilities.
 *
 * For bundling, build tools, and platform adapters without React,
 * use @frontmcp/uipack instead.
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
 *
 * @example SSR bundling
 * ```typescript
 * import { InMemoryBundler, createBundler } from '@frontmcp/ui/bundler';
 * ```
 */

// ============================================
// React Components and Hooks
// ============================================
// The react module provides React components and hooks for building
// interactive MCP widgets. This is the primary export for @frontmcp/ui.
export * from './react';

// ============================================
// React 19 Static Rendering
// ============================================
// The render module provides React 19 static rendering utilities
// for server-side rendering.
export * from './render';

// ============================================
// React Renderer and Adapter
// ============================================
// The renderers module provides React rendering for template processing:
// - ReactRenderer: SSR (server-side rendering)
// - ReactRendererAdapter: Client-side hydration and rendering
export {
  ReactRenderer,
  reactRenderer,
  buildHydrationScript,
  ReactRendererAdapter,
  createReactAdapter,
  loadReactAdapter,
} from './renderers';

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
