import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { AuditApp } from './apps/audit';

const port = parseInt(process.env['PORT'] ?? '3018', 10);

@FrontMcp({
  info: { name: 'Demo E2E Hooks', version: '0.1.0' },
  apps: [AuditApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  transport: {
    enableStatefulHttp: true,
    enableStreamableHttp: true,
    enableStatelessHttp: false,
    requireSessionForStreamable: false,
    enableLegacySSE: true,
    enableSseListener: true,
  },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
})
export default class Server {}
