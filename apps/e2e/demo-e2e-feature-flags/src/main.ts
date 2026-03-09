import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { FlaggedApp } from './apps/flagged';

const port = parseInt(process.env['PORT'] ?? '3115', 10);

@FrontMcp({
  info: { name: 'Demo E2E Feature Flags', version: '0.1.0' },
  apps: [FlaggedApp],
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
