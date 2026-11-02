import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { FeaturesApp } from './apps/features';

const port = parseInt(process.env['PORT'] ?? '3114', 10);

@FrontMcp({
  info: { name: 'Demo E2E Live Surface', version: '0.1.0' },
  apps: [FeaturesApp],
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
