import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { GuardApp } from './apps/guard';

const port = parseInt(process.env['PORT'] ?? '50341', 10);

@FrontMcp({
  info: { name: 'Demo E2E Guard IP Filter', version: '0.1.0' },
  apps: [GuardApp],
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
  throttle: {
    enabled: true,
    ipFilter: {
      allowList: ['127.0.0.0/8', '::1', '198.51.100.0/24', '2001:db8::/32'],
      denyList: ['203.0.113.0/24', '198.51.100.128/25', '2001:db8:dead::/48'],
      defaultAction: 'deny',
    },
  },
})
export default class Server {}
