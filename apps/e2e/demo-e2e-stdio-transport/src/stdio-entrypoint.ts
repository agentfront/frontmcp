/**
 * Stdio Entrypoint for E2E Testing
 *
 * Starts the FrontMCP server in stdio mode (stdin/stdout JSON-RPC).
 * Used to verify that:
 * - stdout contains ONLY MCP protocol messages (no log leakage)
 * - All logging is redirected to stderr or file
 * - Tools, resources, and prompts work over stdio transport
 *
 * Usage:
 *   npx tsx src/stdio-entrypoint.ts
 */
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

FrontMcpInstance.runStdio(serverConfig).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
