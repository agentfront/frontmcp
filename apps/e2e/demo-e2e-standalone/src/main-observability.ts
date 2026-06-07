import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3104', 10);

/**
 * E2E server for #453 — `@frontmcp/observability` detection.
 *
 * `observability` config is set AND `@frontmcp/observability` is resolvable in
 * this monorepo (workspace package). The SDK must therefore NOT log
 * "@frontmcp/observability is not installed" — that misleading warning (emitted
 * whenever the lazy `require()` threw for ANY reason) is exactly what #453 fixes.
 * Telemetry must activate (or, if the module genuinely fails to load, the SDK
 * must say so accurately rather than claim it isn't installed).
 *
 * Uses the issue's exact config shape.
 */
@FrontMcp({
  info: { name: 'Demo E2E Observability', version: '0.1.0' },
  apps: [ParentApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  transport: { protocol: { json: true, legacy: true, strictSession: false } },
  observability: {
    tracing: true,
    logging: { sinks: [{ type: 'stdout' }] },
    requestLogs: true,
  },
})
export default class Server {}
