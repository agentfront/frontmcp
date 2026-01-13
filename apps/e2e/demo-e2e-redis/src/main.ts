import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { SessionsApp } from './apps/sessions';
import { VaultApp } from './apps/vault';
import { TransportApp } from './apps/transport';

const port = parseInt(process.env['PORT'] ?? '3014', 10);

@FrontMcp({
  info: { name: 'Demo E2E Redis', version: '0.1.0' },
  apps: [SessionsApp, VaultApp, TransportApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
    transport: {
      enableStatefulHttp: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      requireSessionForStreamable: false,
      enableLegacySSE: true,
      enableSseListener: true,
    },
  },
})
export default class Server {}
