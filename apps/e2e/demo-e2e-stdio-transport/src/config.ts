/**
 * Shared server configuration for stdio transport E2E tests.
 *
 * Separated from main.ts to prevent auto-bootstrap of HTTP server
 * when only the config is needed (e.g., for stdio mode).
 */
import { LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

export const serverConfig = {
  info: { name: 'Stdio Transport E2E', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Info, enableConsole: true },
  auth: { mode: 'public' as const },
};
