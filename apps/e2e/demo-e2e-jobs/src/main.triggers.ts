/**
 * Jobs server whose workflows start from their triggers: a signed webhook, or an event a tool emits. Each webhook's
 * secret comes from the environment the e2e sets.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { TriggersApp } from './apps/triggers';

const DEFAULT_PORT = 3124;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

@FrontMcp({
  info: { name: 'Demo E2E Job Triggers', version: '0.1.0' },
  apps: [TriggersApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  jobs: { enabled: true },
})
export default class Server {}
