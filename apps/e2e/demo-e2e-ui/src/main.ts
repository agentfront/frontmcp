import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { WidgetsApp } from './apps/widgets';

const port = parseInt(process.env['PORT'] ?? '3017', 10);

@FrontMcp({
  info: { name: 'Demo E2E UI', version: '0.1.0' },
  apps: [WidgetsApp],
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
