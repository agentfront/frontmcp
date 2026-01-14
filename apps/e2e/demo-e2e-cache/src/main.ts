import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ComputeApp } from './apps/compute';

const port = parseInt(process.env['PORT'] ?? '3016', 10);

@FrontMcp({
  info: { name: 'Demo E2E Cache', version: '0.1.0' },
  apps: [ComputeApp],
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
