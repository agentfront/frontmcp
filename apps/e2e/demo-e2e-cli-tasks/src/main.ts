import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { CliTasksDemoApp } from './apps/cli-tasks-demo';

const port = parseInt(process.env['PORT'] ?? '3131', 10);
const dbPath = process.env['FRONTMCP_TASKS_DB'] ?? '/tmp/frontmcp-cli-tasks.sqlite';

@FrontMcp({
  info: { name: 'Demo E2E CLI Tasks', version: '0.1.0' },
  apps: [CliTasksDemoApp],
  logging: { level: LogLevel.Info, enableConsole: true },
  http: { port },
  auth: { mode: 'public' },
  tasks: {
    enabled: true,
    // Spawn each task as a detached child process that writes its outcome to SQLite.
    runner: 'cli',
    sqlite: { path: dbPath, walMode: true },
    defaultTtlMs: 60_000,
    maxTtlMs: 300_000,
    defaultPollIntervalMs: 200,
  },
})
export default class Server {}
