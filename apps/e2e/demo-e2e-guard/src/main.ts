import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { GuardApp } from './apps/guard';

const port = parseInt(process.env['PORT'] ?? '50340', 10);

@FrontMcp({
  info: { name: 'Demo E2E Guard', version: '0.1.0' },
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
    global: { maxRequests: 200, windowMs: 10_000, partitionBy: 'global' },
    defaultTimeout: { executeMs: 5000 },
  },
})
export default class Server {}
