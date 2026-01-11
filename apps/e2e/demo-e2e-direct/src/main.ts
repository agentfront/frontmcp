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

const port = parseInt(process.env['PORT'] ?? '3015', 10);

@FrontMcp({
  info: { name: 'Demo E2E Direct', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'public',
  },
})
export default class Server {}

/**
 * Export the configuration for direct usage testing.
 * This allows tests to import the config directly.
 */
export const serverConfig = {
  info: { name: 'Demo E2E Direct', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Verbose, enableConsole: true },
  auth: {
    mode: 'public' as const,
  },
};
