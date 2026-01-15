import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotifyApp } from './apps/notify';

const port = parseInt(process.env['PORT'] ?? '3113', 10);

@FrontMcp({
  info: { name: 'Demo E2E Notifications', version: '0.1.0' },
  apps: [NotifyApp],
  logging: { level: LogLevel.Verbose },
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
