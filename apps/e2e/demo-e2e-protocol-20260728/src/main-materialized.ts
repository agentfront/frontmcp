import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { BoardApp } from './apps/board';

const port = parseInt(process.env['PORT'] ?? '3162', 10);

/** E2E server for a materialized resource whose updates reach 2026-07-28 `subscriptions/listen` streams. */
@FrontMcp({
  info: { name: 'Demo E2E Protocol 2026 Materialized', version: '0.1.0' },
  apps: [BoardApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
})
export default class Server {}
