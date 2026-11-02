import { LogLevel } from '@frontmcp/sdk';

import { ConfigApp } from './apps/config';
import { LifecycleJournal } from './providers/lifecycle-journal.provider';

/** Shared by the HTTP server (main.ts), the stdio entrypoint and direct use; importing it starts nothing. */
export const serverConfig = {
  info: { name: 'Demo E2E Providers', version: '0.1.0' },
  apps: [ConfigApp],
  providers: [LifecycleJournal],
  logging: { level: LogLevel.Warn },
  auth: {
    mode: 'public' as const,
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
};
