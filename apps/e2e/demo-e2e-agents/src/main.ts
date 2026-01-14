import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AgentsApp } from './apps/agents';

const port = parseInt(process.env['PORT'] ?? '3020', 10);

@FrontMcp({
  info: { name: 'Demo E2E Agents', version: '0.1.0' },
  apps: [AgentsApp],
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
