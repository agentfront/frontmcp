/**
 * Unix Socket Entrypoint for E2E Testing
 *
 * This file is used as a CLI entrypoint for testing Unix socket transport.
 * It starts the FrontMCP server listening on a Unix socket file.
 *
 * Usage:
 *   SOCKET_PATH=/tmp/my-app.sock npx tsx src/socket-entrypoint.ts
 *
 * NOTE: This imports from config.js (not main.js) to avoid triggering
 * auto-bootstrap of the HTTP server via the @FrontMcp decorator.
 */
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

const socketPath = process.env['SOCKET_PATH'];

if (!socketPath) {
  console.error('SOCKET_PATH environment variable is required');
  process.exit(1);
}

FrontMcpInstance.runUnixSocket({
  ...serverConfig,
  socketPath,
}).catch((err) => {
  console.error('Failed to start unix socket server:', err);
  process.exit(1);
});
