// file: libs/browser/src/scope/index.ts
/**
 * Browser Scope module.
 *
 * Provides a browser-compatible scope for MCP servers that works
 * without Node.js dependencies.
 *
 * @example
 * ```typescript
 * import { createBrowserScope } from '@frontmcp/browser';
 *
 * const scope = createBrowserScope({
 *   serverInfo: { name: 'my-app', version: '1.0.0' },
 * });
 *
 * scope.registerTool({
 *   name: 'calculate',
 *   description: 'Perform a calculation',
 *   handler: (input) => input.a + input.b,
 * });
 *
 * await scope.start();
 * ```
 */

export { BrowserScope, createBrowserScope } from './browser-scope';

export type {
  BrowserScopeOptions,
  BrowserServerInfo,
  ScopeToolDefinition,
  ScopeResourceDefinition,
  ScopePromptDefinition,
  BrowserToolChangeEvent,
  BrowserResourceChangeEvent,
  BrowserScopeCapabilities,
} from './types';
