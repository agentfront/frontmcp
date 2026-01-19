import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ErrorsApp } from './apps/errors';

const port = parseInt(process.env['PORT'] ?? '3115', 10);

@FrontMcp({
  info: { name: 'Demo E2E Errors', version: '0.1.0' },
  apps: [ErrorsApp],
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
