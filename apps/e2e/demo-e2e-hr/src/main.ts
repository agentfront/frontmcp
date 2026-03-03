import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { HrApp } from './apps/hr';

const port = parseInt(process.env['PORT'] ?? '3130', 10);

@FrontMcp({
  info: { name: 'Demo E2E HR', version: '0.1.0' },
  apps: [HrApp],
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
