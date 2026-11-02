/**
 * A server whose first app orders two plugins with `before` and installs an `appliesTo: 'all-apps'` hook that also
 * runs for the second app's tool.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { OrderedApp, SecondApp } from './apps/hook-ordering';

const port = parseInt(process.env['PORT'] ?? '3121', 10);

@FrontMcp({
  info: { name: 'Demo E2E Hook Ordering', version: '0.1.0' },
  apps: [OrderedApp, SecondApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
})
export default class Server {}
