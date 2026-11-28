/**
 * Jobs server for detached workflows, machine-wide admission and runners that boot only their run's app (#1351). Its
 * runs are kept in the SQLite file `JOBS_SQLITE_PATH`, which every instance and runner shares; at most one job attempt
 * runs at a time on the machine. With `JOBS_DETACHED_BOOT=app` a runner boots only the app its run needs.
 */
import * as os from 'node:os';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { pathJoin } from '@frontmcp/utils';

import { MarkerApp, RuntimeApp } from './apps/runtime';

const DEFAULT_PORT = 3124;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;
const sqlitePath = process.env['JOBS_SQLITE_PATH'] ?? pathJoin(os.tmpdir(), 'frontmcp-job-runtime.sqlite');

@FrontMcp({
  info: { name: 'Demo E2E Job Runtime', version: '0.1.0' },
  apps: [RuntimeApp, MarkerApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  sqlite: { path: sqlitePath },
  jobs: {
    enabled: true,
    admission: { concurrency: 1, scope: 'machine', maxWaitMs: 120_000 },
    detached: { boot: process.env['JOBS_DETACHED_BOOT'] === 'app' ? 'app' : 'server' },
  },
})
export default class Server {}
