/**
 * Jobs server whose runs live in the top-level SQLite store and are admitted one at a time,
 * waiting at most 300 ms for a slot.
 */
import * as os from 'node:os';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { pathJoin } from '@frontmcp/utils';

import { DurableApp } from './apps/durable';

const DEFAULT_PORT = 3122;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;
const sqlitePath =
  process.env['JOBS_SQLITE_PATH'] ?? pathJoin(os.tmpdir(), `frontmcp-durable-jobs-${process.pid}.sqlite`);

@FrontMcp({
  info: { name: 'Demo E2E Durable Jobs', version: '0.1.0' },
  apps: [DurableApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  sqlite: { path: sqlitePath },
  jobs: { enabled: true, admission: { concurrency: 1, maxWaitMs: 300 } },
})
export default class Server {}
