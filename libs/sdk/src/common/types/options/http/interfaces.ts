// common/types/options/http/interfaces.ts
// Explicit TypeScript interfaces for HTTP configuration

import { FrontMcpServer } from '../../../interfaces';

/**
 * HTTP server configuration options.
 */
export interface HttpOptionsInterface {
  /**
   * Port number to listen on.
   * @default 3001
   */
  port?: number;

  /**
   * MCP JSON-RPC entry path ('' or '/mcp').
   * MUST match PRM resourcePath returned in well-known.
   * @default ''
   */
  entryPath?: string;

  /**
   * Custom host factory to provide HTTP server implementation.
   * Can be a FrontMcpServer instance or a factory function.
   */
  hostFactory?: FrontMcpServer | ((config: HttpOptionsInterface) => FrontMcpServer);
}
