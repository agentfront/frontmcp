import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { TransportTestApp } from './apps/transport-test';

const port = parseInt(process.env['PORT'] ?? '3020', 10);

@FrontMcp({
  info: { name: 'Demo E2E Transport Recreation', version: '0.1.0' },
  apps: [TransportTestApp],
  logging: { level: LogLevel.VERBOSE },
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
