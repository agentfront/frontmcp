import 'reflect-metadata';
import { LogLevel } from '@frontmcp/sdk';
import { CliExecApp } from './apps/cli-exec';

const serverConfig = {
  info: { name: 'CLI Exec E2E Demo', version: '1.0.0' },
  apps: [CliExecApp],
  logging: { level: LogLevel.Warn, enableConsole: false },
  auth: { mode: 'public' as const },
  http: { port: 3151 },
  jobs: { enabled: true },
};

export default serverConfig;
