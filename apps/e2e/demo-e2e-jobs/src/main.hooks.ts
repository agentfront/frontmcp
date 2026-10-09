/**
 * Jobs server whose app audits every job attempt with a plugin hook on `jobs:execute-job` (#700).
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { JobHooksApp } from './apps/job-hooks';

const DEFAULT_PORT = 3121;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;

@FrontMcp({
  info: { name: 'Demo E2E Job Hooks', version: '0.1.0' },
  apps: [JobHooksApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  jobs: { enabled: true },
})
export default class Server {}
