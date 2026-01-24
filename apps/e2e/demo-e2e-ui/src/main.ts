import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { WidgetsApp } from './apps/widgets';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

@FrontMcp({
  info: { name: 'Demo E2E UI', version: '0.1.0' },
  apps: [WidgetsApp],
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
