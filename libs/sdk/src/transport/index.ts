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

// In-memory server for direct programmatic access
export { createInMemoryServer, CreateInMemoryServerOptions, InMemoryServerResult } from './in-memory-server';
