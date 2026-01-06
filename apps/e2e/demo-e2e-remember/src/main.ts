import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { MemoryApp } from './apps/memory';

const port = parseInt(process.env['PORT'] ?? '3020', 10);

@FrontMcp({
  info: { name: 'Demo E2E Remember', version: '0.1.0' },
  apps: [MemoryApp],
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
