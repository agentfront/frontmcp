import { FrontMcp, LogLevel, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

import { IsolatedApp } from './apps/isolated';
import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3103', 10);

/**
 * E2E Test Server for Standalone Apps
 *
 * This server has:
 * - ParentApp: Non-standalone app in root scope (accessible at /)
 * - IsolatedApp: Standalone app with isolated scope (accessible at /isolated)
 *
 * Expected behavior:
 * - Root scope SSE at /sse → only has parent-hello tool
 * - Isolated scope SSE at /isolated/sse → only has isolated-hello tool
 * - Root scope message at /message → works with root session
 * - Isolated scope message at /isolated/message → works with isolated session
 */
@FrontMcp({
  info: { name: 'Demo E2E Standalone', version: '0.1.0' },
  apps: [ParentApp, IsolatedApp],
  logging: { level: LogLevel.Warn },
  http: {
    port,
    // First-class custom HTTP routes (issue #465). These ride the same Express
    // app as the MCP endpoint and share its CORS/body-limit/security middleware.
    routes: [
      // Public GET route — returns JSON.
      {
        method: 'GET',
        path: '/custom/ping',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true, route: 'custom-ping' });
        },
      },
      // Public GET route returning HTML — exercises the Content-Type gotcha:
      // the adapter defaults to application/json, so the handler MUST set its
      // own content type before sending the body.
      {
        method: 'GET',
        path: '/custom/page',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.status(200).send('<!doctype html><h1>custom-page</h1>');
        },
      },
      // Auth-gated route — runs the MCP session:verify flow. In public-mode auth
      // (this server) an anonymous session is created, so the handler runs and
      // can read req.authSession.
      {
        method: 'GET',
        path: '/custom/whoami',
        auth: true,
        handler: (req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true, hasAuthSession: !!req.authSession });
        },
      },
      // POST route that reads and validates a JSON body — mirrors the issue's
      // `/connect-env` use case (#465): validate a user-entered secret
      // server-side without finalizing an OAuth exchange. The body is parsed by
      // the shared express.json() middleware (subject to http.bodyLimit).
      {
        method: 'POST',
        path: '/custom/connect-env',
        handler: (req: ServerRequest, res: ServerResponse) => {
          const secret = (req.body as { secret?: string } | undefined)?.secret;
          if (secret === 'sk-valid') {
            res.status(200).json({ ok: true, connected: true });
          } else {
            res.status(400).json({ ok: false, error: 'invalid secret' });
          }
        },
      },
    ],
  },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
