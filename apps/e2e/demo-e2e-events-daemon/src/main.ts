import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { DaemonApp } from './apps/daemon';

const port = parseInt(process.env['PORT'] ?? '3170', 10);

/** The local daemon: public auth, events offered by poll and push. */
@FrontMcp({
  info: { name: 'Drop Folder Daemon', version: '0.1.0' },
  apps: [DaemonApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  // A local daemon: every local client may read its events, by poll or by stream
  auth: { mode: 'public' },
  events: { poll: { nextPollMs: 5_000 } },
})
export default class Server {}
