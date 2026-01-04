import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { LocalTestApp } from './apps/local-test';

const port = parseInt(process.env['PORT'] ?? '3099', 10);

@FrontMcp({
  info: { name: 'Local Test MCP', version: '0.1.0' },
  apps: [LocalTestApp],
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
export default class LocalTestMcpServer {}
