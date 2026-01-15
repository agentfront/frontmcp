import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { SessionsApp } from './apps/sessions';
import { VaultApp } from './apps/vault';
import { TransportApp } from './apps/transport';

const port = parseInt(process.env['PORT'] ?? '3111', 10);

@FrontMcp({
  info: { name: 'Demo E2E Redis', version: '0.1.0' },
  apps: [SessionsApp, VaultApp, TransportApp],
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
