import { FrontMcp, LogLevel, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3113', 10);

/**
 * E2E fixture for the CORS opt-in — the counterpart to `main.ts`, which
 * configures no `cors` at all and therefore sends no CORS headers.
 *
 * Kept as a separate entry because the test harness starts one server per spec
 * file, so the two CORS states cannot share a fixture.
 */
@FrontMcp({
  info: { name: 'Demo E2E CORS', version: '0.1.0' },
  apps: [ParentApp],
  logging: { level: LogLevel.Warn },
  http: {
    port,
    cors: { origin: 'https://allowed.example.com' },
    routes: [
      {
        method: 'GET',
        path: '/custom/ping',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true, route: 'custom-ping' });
        },
      },
    ],
  },
})
export default class Server {}
