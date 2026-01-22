import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ServerlessApp } from './apps/serverless';

const port = parseInt(process.env['PORT'] ?? '3110', 10);

@FrontMcp({
  info: { name: 'Demo E2E Serverless', version: '0.1.0' },
  apps: [ServerlessApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { sse: false, json: true, stateless: true, strictSession: false },
  },
})
export default class Server {}
