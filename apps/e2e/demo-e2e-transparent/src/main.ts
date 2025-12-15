import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { TasksApp } from './apps/tasks';

const port = parseInt(process.env['PORT'] ?? '3011', 10);

@FrontMcp({
  info: { name: 'Demo E2E Transparent', version: '0.1.0' },
  apps: [TasksApp],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'transparent',
    remote: {
      provider: process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com',
      name: 'frontegg',
      dcrEnabled: false,
    },
    expectedAudience: process.env['IDP_EXPECTED_AUDIENCE'] || 'https://sample-app.frontegg.com',
    requiredScopes: [],
    allowAnonymous: false,
    transport: {
      enableStatefulHttp: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      requireSessionForStreamable: true,
      enableLegacySSE: true,
      enableSseListener: true,
    },
  },
})
export default class Server {}
