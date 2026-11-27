import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { SlowProbeApp } from './apps/slow-probe';

const port = parseInt(process.env['PORT'] ?? '3118', 10);

/** E2E server for the MCP streams' keep-alive: a quiet tool, every transport, and a 300 ms heartbeat. */
@FrontMcp({
  info: { name: 'Demo E2E Keep-alive', version: '0.1.0' },
  apps: [SlowProbeApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  transport: { protocol: 'full', sse: { heartbeatMs: 300 } },
})
export default class Server {}
