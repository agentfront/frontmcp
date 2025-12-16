import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ConfigApp } from './apps/config';

const port = parseInt(process.env['PORT'] ?? '3015', 10);

@FrontMcp({
  info: { name: 'Demo E2E Providers', version: '0.1.0' },
  apps: [ConfigApp],
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
