import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ErrorsApp } from './apps/errors';

const port = parseInt(process.env['PORT'] ?? '3019', 10);

@FrontMcp({
  info: { name: 'Demo E2E Errors', version: '0.1.0' },
  apps: [ErrorsApp],
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
