import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { OpsWithExplicitCheckApp } from './apps/ops/explicit-check.app';

const port = parseInt(process.env['PORT'] ?? '3121', 10);

@FrontMcp({
  info: { name: 'Demo E2E Approval (explicit check plugin)', version: '0.1.0' },
  apps: [OpsWithExplicitCheckApp],
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
