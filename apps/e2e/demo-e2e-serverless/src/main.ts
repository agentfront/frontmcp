import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ServerlessApp } from './apps/serverless';

const port = parseInt(process.env['PORT'] ?? '3021', 10);

@FrontMcp({
  info: { name: 'Demo E2E Serverless', version: '0.1.0' },
  apps: [ServerlessApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
    transport: {
      enableStatefulHttp: true,
      enableStreamableHttp: true,
      enableStatelessHttp: true,
      requireSessionForStreamable: false,
      enableLegacySSE: false,
      enableSseListener: false,
    },
  },
})
export default class Server {}
