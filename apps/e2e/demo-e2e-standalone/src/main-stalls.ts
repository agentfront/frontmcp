import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { StallProbeApp } from './apps/stall-probe';

const port = parseInt(process.env['PORT'] ?? '3115', 10);

/** E2E server for the stall detector: `observability.stalls` reports any event-loop stall of 200 ms or more. */
@FrontMcp({
  info: { name: 'Demo E2E Stalls', version: '0.1.0' },
  apps: [StallProbeApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  transport: { protocol: { json: true, legacy: true, strictSession: false } },
  observability: { tracing: false, logging: false, stalls: { thresholdMs: 200 } },
})
export default class Server {}
