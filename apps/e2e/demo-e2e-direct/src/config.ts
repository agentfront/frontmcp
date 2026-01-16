/**
 * Demo E2E Direct - Shared Server Configuration
 *
 * This file contains the base configuration shared between:
 * - HTTP server (main.ts)
 * - Stdio transport (stdio-entrypoint.ts)
 * - Direct usage tests
 *
 * Separating this from main.ts prevents auto-bootstrapping of HTTP server
 * when only the config is needed (e.g., for stdio mode).
 */
import { LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

/**
 * Base configuration shared between HTTP server and direct usage.
 * This ensures consistency and prevents config drift.
 */
export const serverConfig = {
  info: { name: 'Demo E2E Direct', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Verbose, enableConsole: true },
  auth: { mode: 'public' as const },
};
