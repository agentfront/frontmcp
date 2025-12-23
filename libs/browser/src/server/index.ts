// file: libs/browser/src/server/index.ts
/**
 * Browser MCP server implementation.
 *
 * Provides a browser-native MCP server that handles JSON-RPC
 * requests over browser transports.
 */

export {
  BrowserMcpServer,
  type BrowserMcpServerOptions,
  type BrowserToolDefinition,
  type BrowserResourceDefinition,
  type BrowserPromptDefinition,
  type BrowserToolContext,
  type BrowserResourceContext,
  type BrowserPromptContext,
  type BrowserServerCapabilities,
  type ResourceContent,
} from './browser-server';

// Alias for consistency with FrontMcpProvider naming
export { BrowserMcpServer as FrontMcpServer } from './browser-server';
export type { BrowserMcpServerOptions as FrontMcpServerOptions } from './browser-server';
