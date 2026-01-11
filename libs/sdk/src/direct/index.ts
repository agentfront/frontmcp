/**
 * Direct MCP Server Module
 *
 * Provides programmatic access to FrontMCP servers without HTTP/stdio transports.
 */

export type { DirectMcpServer, DirectAuthContext, DirectCallOptions, DirectRequestMetadata } from './direct.types';

export { DirectMcpServerImpl } from './direct-server';
