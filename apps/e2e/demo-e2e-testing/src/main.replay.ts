import { CallRecorderPlugin, FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ReplayApp } from './apps/replay';

const parsedPort = parseInt(process.env['PORT'] ?? '3172', 10);
const port = Number.isNaN(parsedPort) ? 3172 : parsedPort;
const callsFile = process.env['CALLS_FILE'];

@FrontMcp({
  info: { name: 'Demo E2E Testing (replay)', version: '0.1.0' },
  apps: [ReplayApp],
  plugins: callsFile ? [CallRecorderPlugin.init({ path: callsFile })] : [],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: { protocol: { json: true, legacy: true } },
})
export default class Server {}
