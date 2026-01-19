/**
 * Stdio Entrypoint for E2E Testing
 *
 * This file is used as a CLI entrypoint for testing stdio transport.
 * It starts the FrontMCP server in stdio mode, reading from stdin and writing to stdout.
 *
 * Usage:
 *   npx ts-node --esm src/stdio-entrypoint.ts
 *   node dist/stdio-entrypoint.js
 *
 * NOTE: This imports from config.js (not main.js) to avoid triggering
 * auto-bootstrap of the HTTP server via the @FrontMcp decorator.
 */
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

// Run the server in stdio mode
FrontMcpInstance.runStdio(serverConfig).catch((err) => {
  console.error('Failed to start stdio server:', err);
  process.exit(1);
});
