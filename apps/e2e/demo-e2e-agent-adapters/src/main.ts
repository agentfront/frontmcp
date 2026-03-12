import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AgentAdaptersApp } from './apps/agent-adapters';

const port = parseInt(process.env['PORT'] ?? '3101', 10);

@FrontMcp({
  info: { name: 'Demo E2E Agent Adapters', version: '0.1.0' },
  apps: [AgentAdaptersApp],
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
