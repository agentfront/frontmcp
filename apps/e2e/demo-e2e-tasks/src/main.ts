import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { TasksDemoApp } from './apps/tasks-demo';

const port = parseInt(process.env['PORT'] ?? '3130', 10);

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
