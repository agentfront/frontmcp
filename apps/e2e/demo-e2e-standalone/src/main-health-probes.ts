import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { LateProbeApp } from './apps/late-probe';

const port = parseInt(process.env['PORT'] ?? '3116', 10);

/** E2E server for `scope.registerHealthProbe()` after startup: a tool starts a feature that adds a /readyz check. */
@FrontMcp({
  info: { name: 'Demo E2E Health Probes', version: '0.1.0' },
  apps: [LateProbeApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  health: { includeDetails: true },
})
export default class Server {}
