import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ProbeApp } from './apps/probe';

const parsedPort = parseInt(process.env['PORT'] ?? '3170', 10);
const port = Number.isNaN(parsedPort) ? 3170 : parsedPort;

@FrontMcp({
  info: { name: 'Demo E2E Testing', version: '0.1.0' },
  apps: [ProbeApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: { protocol: { json: true, legacy: true } },
})
export default class Server {}
