import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { BoardApp } from './apps/board';

const port = parseInt(process.env['PORT'] ?? '3115', 10);

@FrontMcp({
  info: { name: 'Demo E2E Materialized Resources', version: '0.1.0' },
  apps: [BoardApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
