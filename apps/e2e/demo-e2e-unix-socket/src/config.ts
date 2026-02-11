/**
 * Demo E2E Unix Socket - Shared Server Configuration
 *
 * This file contains the base configuration shared between:
 * - HTTP server (main.ts)
 * - Unix socket transport (socket-entrypoint.ts)
 * - E2E tests
 *
 * Separating this from main.ts prevents auto-bootstrapping of HTTP server
 * when only the config is needed (e.g., for socket mode).
 */
import { LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

/**
 * Base configuration shared between HTTP server and unix socket usage.
 * This ensures consistency and prevents config drift.
 */
export const serverConfig = {
  info: { name: 'Demo E2E Unix Socket', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  auth: { mode: 'public' as const },
};
