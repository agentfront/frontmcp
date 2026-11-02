/**
 * A server whose app has two plugins hooking the same stage, logging at info level so a dev-mode run shows the
 * resolved hook order.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { HookOrderApp } from './apps/hook-order';

const port = parseInt(process.env['PORT'] ?? '3120', 10);

@FrontMcp({
  info: { name: 'Demo E2E Hook Order', version: '0.1.0' },
  apps: [HookOrderApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: { mode: 'public' },
})
export default class Server {}
