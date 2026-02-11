/**
 * Demo E2E Unix Socket - Main Server Configuration
 *
 * This server is used for testing Unix socket transport of FrontMCP.
 * For HTTP fallback, it listens on port 3118.
 */
import { FrontMcp } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

// Validate port - fallback to 3118 if invalid
const rawPort = parseInt(process.env['PORT'] ?? '3118', 10);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3118;

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
