import { FrontMcp, LogLevel, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3113', 10);

/**
 * E2E fixture for issue #465 — custom http.routes with `auth: true` under a
 * NON-public auth mode.
 *
 * Unlike `main.ts` (public mode, which mints an anonymous session), this server
 * uses local auth with `allowDefaultPublic: false` — no anonymous fallback. An
 * unauthenticated request to an `auth: true` custom route therefore
 * short-circuits with HTTP 401 + WWW-Authenticate, exactly like the MCP
 * endpoint would.
 */
@FrontMcp({
  info: { name: 'Demo E2E Custom Route Auth', version: '0.1.0' },
  apps: [ParentApp],
  logging: { level: LogLevel.Warn },
  http: {
    port,
    routes: [
      // Public route — always reachable, proves the router still serves
      // unauthenticated custom routes when auth is NOT requested.
      {
        method: 'GET',
        path: '/open/ping',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true });
        },
      },
      // Auth-gated route — no anonymous fallback in gateway mode, so an
      // unauthenticated GET must return 401.
      {
        method: 'GET',
        path: '/secure/whoami',
        auth: true,
        handler: (req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true, hasAuthSession: !!req.authSession });
        },
      },
    ],
  },
  // Local OAuth mode with no anonymous fallback: tokens are required.
  auth: {
    mode: 'local',
    tokenStorage: 'memory',
    allowDefaultPublic: false,
  },
})
export default class Server {}
