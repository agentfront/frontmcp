// Re-export the real MCP Server for browser builds.
// The Server class and InMemoryTransport do not depend on Node.js streams.
export { Server, type ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
