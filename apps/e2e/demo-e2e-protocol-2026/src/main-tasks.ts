import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { TasksApp } from './apps/tasks';

const port = parseInt(process.env['PORT'] ?? '3161', 10);

/**
 * E2E server for the `io.modelcontextprotocol/tasks` extension.
 *
 * Runs with real token auth rather than public mode on purpose: 2026-07-28 has
 * no protocol sessions, so a task is keyed by the authenticated principal. An
 * anonymous caller has no such identity and the server refuses to create tasks
 * for one — which is exactly what the anonymous-refusal test asserts against
 * the public fixture.
 */
@FrontMcp({
  info: { name: 'Demo E2E Protocol 2026 Tasks', version: '0.1.0' },
  apps: [TasksApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
  },
  elicitation: { enabled: true },
  tasks: {
    enabled: true,
    defaultTtlMs: 60_000,
    maxTtlMs: 300_000,
    defaultPollIntervalMs: 50,
  },
})
export default class Server {}
