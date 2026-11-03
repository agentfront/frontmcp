/**
 * Jobs server whose jobs run detached by default, in processes of their own, keeping their runs in the
 * top-level SQLite store, so a run outlives the server that started it.
 */
import * as os from 'node:os';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { pathJoin } from '@frontmcp/utils';

import { DetachedApp } from './apps/detached';

const DEFAULT_PORT = 3123;
const parsedPort = Number.parseInt(process.env['PORT'] ?? '', 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : DEFAULT_PORT;
const sqlitePath = process.env['JOBS_SQLITE_PATH'] ?? pathJoin(os.tmpdir(), 'frontmcp-detached-jobs.sqlite');

@FrontMcp({
  info: { name: 'Demo E2E Detached Jobs', version: '0.1.0' },
  apps: [DetachedApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  sqlite: { path: sqlitePath },
  jobs: { enabled: true, runner: 'detached' },
})
export default class Server {}
