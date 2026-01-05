import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { EcommerceApp } from './apps/ecommerce';

const port = parseInt(process.env['PORT'] ?? '3012', 10);

@FrontMcp({
  info: { name: 'Demo E2E OpenAPI', version: '0.1.0' },
  apps: [EcommerceApp],
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
