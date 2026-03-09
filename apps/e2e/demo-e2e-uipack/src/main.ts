import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { UipackApp } from './apps/uipack';

const parsed = parseInt(process.env['PORT'] ?? '3120', 10);
const port = Number.isNaN(parsed) ? 3120 : parsed;

@FrontMcp({
  info: { name: 'Demo E2E UIpack', version: '0.1.0' },
  apps: [UipackApp],
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
