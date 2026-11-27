/** The web host with a sqlite store (`PEOPLE_SQLITE`), so its people sessions outlive a restart (#1355). */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { BoardApp } from './apps/board';

const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : 3171;
const path = process.env['PEOPLE_SQLITE'];
if (!path) throw new Error('set PEOPLE_SQLITE to the sqlite file the people sessions are kept in');

@FrontMcp({
  info: { name: 'Demo E2E Web Host', version: '0.1.0' },
  apps: [BoardApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  http: { port, auth: { people: 'loopback-token' } },
  sqlite: { path },
})
export default class Server {}
