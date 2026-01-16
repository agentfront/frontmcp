/**
 * Demo E2E Direct - Main Server Configuration
 *
 * This server is used for testing direct usage of FrontMCP:
 * - FrontMcpInstance.createDirect() for programmatic access
 * - createInMemoryServer() for MCP SDK Client integration
 * - FrontMcpInstance.runStdio() for stdio transport (Claude Code)
 */
import { FrontMcp } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

// Validate port - fallback to 3117 if invalid
const rawPort = parseInt(process.env['PORT'] ?? '3117', 10);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3117;

@FrontMcp({
  ...serverConfig,
  http: { port },
})
export default class Server {}

/**
 * Re-export the configuration for direct usage testing.
 * This allows tests to import the config directly.
 */
export { serverConfig } from './config.js';
