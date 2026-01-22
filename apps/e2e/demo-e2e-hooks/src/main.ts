import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AuditApp } from './apps/audit';

const port = parseInt(process.env['PORT'] ?? '3120', 10);

@FrontMcp({
  info: { name: 'Demo E2E Hooks', version: '0.1.0' },
  apps: [AuditApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
})
export default class Server {}
