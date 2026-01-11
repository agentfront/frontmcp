/**
 * Stdio Entrypoint for E2E Testing
 *
 * This file is used as a CLI entrypoint for testing stdio transport.
 * It starts the FrontMCP server in stdio mode, reading from stdin and writing to stdout.
 *
 * Usage:
 *   npx ts-node --esm src/stdio-entrypoint.ts
 *   node dist/stdio-entrypoint.js
 */
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from './main.js';

// Run the server in stdio mode
FrontMcpInstance.runStdio(serverConfig).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
