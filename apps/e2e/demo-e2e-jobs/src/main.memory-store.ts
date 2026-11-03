/**
 * Jobs server with a top-level SQLite store, whose job runs stay in this process memory (`jobs.store: false`).
 */
import * as os from 'node:os';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { pathJoin } from '@frontmcp/utils';

import { DurableApp } from './apps/durable';

const DEFAULT_PORT = 3123;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;
const sqlitePath =
  process.env['JOBS_SQLITE_PATH'] ?? pathJoin(os.tmpdir(), `frontmcp-memory-jobs-${process.pid}.sqlite`);

@FrontMcp({
  info: { name: 'Demo E2E Memory Jobs', version: '0.1.0' },
  apps: [DurableApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  sqlite: { path: sqlitePath },
  jobs: { enabled: true, store: false },
})
export default class Server {}
