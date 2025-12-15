import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ComputeApp } from './apps/compute';

const port = parseInt(process.env['PORT'] ?? '3016', 10);

@FrontMcp({
  info: { name: 'Demo E2E Cache', version: '0.1.0' },
  apps: [ComputeApp],
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
