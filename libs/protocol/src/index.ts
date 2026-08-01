/**
 * @frontmcp/protocol
 * @internal
 *
 * Internal library — DO NOT import from apps or consumer code.
 * Consumers should import MCP types from @frontmcp/sdk.
 * For raw MCP Client in tests, use McpClient from @frontmcp/testing.
 */

// MCP protocol types (environment-agnostic)
export * from './types';

// MCP protocol revision 2026-07-28 (not yet shipped by @modelcontextprotocol/sdk)
export * from './types-2026';

// Auth types
export * from './auth-types';

// Shared protocol types (Transport, RequestHandlerExtra)
export * from './shared';

// MCP Client
export * from './client';

// Stdio transport
export * from './stdio';

// In-memory transport
export * from './in-memory';

// Server (browser/node conditional via #imports)
export { Server as McpServer, type ServerOptions as McpServerOptions } from '#mcp-server';
export {
  StreamableHTTPServerTransport,
  WebStandardStreamableHTTPServerTransport,
  type EventStore,
  type EventId,
  type StreamId,
} from '#mcp-streamable-http';
export { IncomingMessage, HttpServerResponse } from '#server-types';
