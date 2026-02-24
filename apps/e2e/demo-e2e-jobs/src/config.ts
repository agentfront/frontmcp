import { LogLevel } from '@frontmcp/sdk';
import { JobsApp } from './apps/jobs';

export const serverConfig = {
  info: { name: 'Demo E2E Jobs', version: '0.1.0' },
  apps: [JobsApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  auth: { mode: 'public' as const },
  jobs: { enabled: true },
};
