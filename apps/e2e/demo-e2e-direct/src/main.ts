/**
 * Demo E2E Direct - Main Server Configuration
 *
 * This server is used for testing direct usage of FrontMCP:
 * - FrontMcpInstance.createDirect() for programmatic access
 * - createInMemoryServer() for MCP SDK Client integration
 * - FrontMcpInstance.runStdio() for stdio transport (Claude Code)
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

// Validate port - fallback to 3117 if invalid
const rawPort = parseInt(process.env['PORT'] ?? '3117', 10);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3117;

/**
 * Base configuration shared between HTTP server and direct usage.
 * This ensures consistency and prevents config drift.
 */
const baseConfig = {
  info: { name: 'Demo E2E Direct', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Verbose, enableConsole: true },
  auth: { mode: 'public' as const },
};

@FrontMcp({
  ...baseConfig,
  http: { port },
})
export default class Server {}

/**
 * Export the configuration for direct usage testing.
 * This allows tests to import the config directly.
 */
export const serverConfig = baseConfig;
