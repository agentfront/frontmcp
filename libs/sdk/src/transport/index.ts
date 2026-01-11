/**
 * @file index.ts
 * @description Transport module barrel exports.
 *
 * Provides recreateable transport classes for session recreation support
 * in serverless environments and distributed systems.
 *
 * @example
 * ```typescript
 * import {
 *   RecreateableStreamableHTTPServerTransport,
 *   RecreateableSSEServerTransport,
 * } from '@frontmcp/sdk/transport';
 * ```
 *
 * @module @frontmcp/sdk/transport
 */

// Recreateable transports for session recreation support
export {
  RecreateableStreamableHTTPServerTransport,
  StreamableHTTPServerTransportOptions,
} from './adapters/streamable-http-transport';

export { RecreateableSSEServerTransport, RecreateableSSEServerTransportOptions } from './adapters/sse-transport';

// Base SSE transport (for type compatibility)
export { SSEServerTransport, SSEServerTransportOptions } from './legacy/legacy.sse.tranporter';

// Transport types
export { SupportedTransport } from './adapters/transport.local.adapter';
export { TransportType, TransportKey } from './transport.types';

/**
 * Creates an in-memory MCP server for programmatic access without HTTP transport.
 *
 * Use this for:
 * - MCP SDK Client integration
 * - LangChain MCP adapter integration
 * - Unit/integration testing
 * - Agent backends with custom invocation
 *
 * @example
 * ```typescript
 * import { createInMemoryServer } from '@frontmcp/sdk';
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *
 * const { clientTransport, setAuthInfo, close } = await createInMemoryServer(scope, {
 *   authInfo: { token: 'jwt-token' }
 * });
 *
 * const client = new Client({ name: 'my-client', version: '1.0.0' });
 * await client.connect(clientTransport);
 *
 * // Use MCP SDK Client methods
 * const tools = await client.listTools();
 *
 * // Update auth context per-request
 * setAuthInfo({ token: 'new-token' });
 *
 * // Cleanup when done
 * await client.close();
 * await close();
 * ```
 */
export { createInMemoryServer } from './in-memory-server';

/**
 * Options for creating an in-memory MCP server.
 * @see createInMemoryServer
 */
export type { CreateInMemoryServerOptions } from './in-memory-server';

/**
 * Result returned by createInMemoryServer.
 * Contains the client transport, auth setter, and close function.
 * @see createInMemoryServer
 */
export type { InMemoryServerResult } from './in-memory-server';
