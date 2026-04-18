import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { TasksDemoApp } from './apps/tasks-demo';

const DEFAULT_PORT = 3130;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;

@FrontMcp({
  info: { name: 'Demo E2E Tasks', version: '0.1.0' },
  apps: [TasksDemoApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  tasks: {
    enabled: true,
    defaultTtlMs: 60_000,
    maxTtlMs: 300_000,
    defaultPollIntervalMs: 200,
  },
})
export default class Server {}
