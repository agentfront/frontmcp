/**
 * @frontmcp/ui
 *
 * Comprehensive UI library for FrontMCP applications.
 * Provides theme system, layouts, components, page templates, and widgets
 * for building authentication and authorization UIs across multiple LLM platforms.
 *
 * Key features:
 * - Multi-framework renderer support (HTML, React, MDX)
 * - Platform-aware theming (OpenAI, Claude, etc.)
 * - Runtime JSX/TSX transpilation with SWC
 * - MCP Bridge integration for cross-platform widgets
 */

// Validation system
export * from './validation';

// Theme system
export * from './theme';

// Layout system
export * from './layouts';

// UI Components
export * from './components';

// Page templates
export * from './pages';

// Widgets (OpenAI App SDK, progress, etc.)
export * from './widgets';

// MCP Bridge Runtime (Tool UI templates)
export * from './runtime';

// Tool Template Builder
export * from './tool-template';

// Base Template (for Tool UI widgets)
export * from './base-template';

// Multi-Framework Renderer System
export * from './renderers';
