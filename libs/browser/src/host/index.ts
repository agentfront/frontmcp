// file: libs/browser/src/host/index.ts
/**
 * App Bridge / Host SDK for embedding MCP-powered applications.
 *
 * @example Host Side (embedding apps):
 * ```typescript
 * import { createAppHost } from '@frontmcp/browser/host';
 *
 * const host = createAppHost({
 *   container: document.getElementById('app-container')!,
 *   allowedOrigins: ['https://trusted-app.com'],
 *   connectionTimeout: 30000,
 * });
 *
 * const app = await host.load({
 *   src: 'https://trusted-app.com/mcp-app',
 *   name: 'My MCP App',
 * });
 *
 * // Call tools on the embedded app
 * const result = await app.callTool('search', { query: 'hello' });
 * ```
 *
 * @example Child Side (embedded app):
 * ```typescript
 * import { createAppChild } from '@frontmcp/browser/host';
 *
 * const child = createAppChild({
 *   allowedOrigins: ['https://host-app.com'],
 * });
 *
 * // Signal that app is ready
 * child.ready();
 *
 * // Access initial data from host
 * const config = child.getInitialData<Config>();
 * ```
 */

// Factory functions
export { createAppHost } from './app-host';
export { createAppChild } from './app-child';

// Types
export type {
  // Core interfaces
  AppHost,
  AppChild,
  LoadedApp,

  // Configuration
  AppHostOptions,
  AppChildOptions,
  AppLoadConfig,

  // State and events
  LoadedAppState,
  AppHostEvent,
  AppEventHandler,

  // Security
  SandboxPermission,
  AuthContext,
  HiTLConfig,

  // Messages
  HostMessage,
  ChildMessage,

  // MCP types
  ServerInfo,
  ContentItem,
  ReadResourceResult,
  GetPromptResult,
} from './types';

// Error classes (exported as values for instanceof checks)
export {
  AppHostError,
  AppLoadError,
  AppConnectionError,
  AppTimeoutError,
  OriginNotAllowedError,
  AppChildError,
} from './types';
