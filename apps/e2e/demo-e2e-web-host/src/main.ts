import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { BoardApp } from './apps/board';

const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : 3170;

@FrontMcp({
  info: { name: 'Demo E2E Web Host', version: '0.1.0' },
  apps: [BoardApp],
  logging: { level: LogLevel.Warn, enableConsole: true },
  http: { port, auth: { people: 'loopback-token' } },
})
export default class Server {}
