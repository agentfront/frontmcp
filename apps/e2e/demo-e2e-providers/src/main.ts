import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ConfigApp } from './apps/config';

const port = parseInt(process.env['PORT'] ?? '3015', 10);

@FrontMcp({
  info: { name: 'Demo E2E Providers', version: '0.1.0' },
  apps: [ConfigApp],
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
