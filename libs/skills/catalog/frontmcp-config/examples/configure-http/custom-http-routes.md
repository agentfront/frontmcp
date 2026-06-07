---
name: custom-http-routes
reference: configure-http
level: intermediate
description: 'Mount first-class custom HTTP routes (download, secret-validation POST, auth-gated webhook) on the MCP listener via http.routes.'
tags: [config, http, routes, custom, webhook, download, auth]
features:
  - 'Registering custom HTTP endpoints with `http.routes` — no tool/resource/prompt needed'
  - 'A POST endpoint that validates a user-entered secret server-side (the `/connect-env` pattern)'
  - 'Overriding the default `application/json` Content-Type for binary/HTML delivery'
  - 'Gating a route behind the MCP `session:verify` flow with `auth: true`'
  - 'Avoiding reserved paths (`/sse`, `/message`, `/oauth/*`, `/.well-known/*`, `/health`, `/metrics`)'
---

# Custom HTTP Routes

Mount first-class custom HTTP routes (download, secret-validation POST, auth-gated webhook) on the MCP listener via http.routes.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

@App({ name: 'my-app' })
class MyApp {}

@FrontMcp({
  info: { name: 'routes-server', version: '1.0.0' },
  apps: [MyApp],
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  http: {
    port: Number(process.env['PORT']) || 3000,
    routes: [
      // 1. Public binary download. The adapter defaults responses to JSON, so a
      //    binary/HTML handler MUST set its own Content-Type before sending.
      {
        method: 'GET',
        path: '/download/:id',
        handler: (req: ServerRequest, res: ServerResponse) => {
          res.setHeader('Content-Type', 'application/pdf');
          res.status(200).send(loadPdfBytes(req.params['id']));
        },
      },

      // 2. The `/connect-env` pattern: validate a user-entered secret against a
      //    backend WITHOUT finalizing an OAuth exchange. The shared
      //    express.json() middleware parses req.body (subject to http.bodyLimit).
      {
        method: 'POST',
        path: '/connect-env',
        handler: async (req: ServerRequest, res: ServerResponse) => {
          const secret = (req.body as { secret?: string } | undefined)?.secret;
          if (!secret || !(await isValidSecret(secret))) {
            res.status(400).json({ ok: false, error: 'invalid secret' });
            return;
          }
          res.status(200).json({ ok: true, connected: true });
        },
      },

      // 3. Auth-gated webhook. With auth: true the request runs the MCP
      //    session:verify flow first; req.authSession is populated on success.
      {
        method: 'POST',
        path: '/webhooks/billing',
        auth: true,
        handler: (req: ServerRequest, res: ServerResponse) => {
          res.status(202).json({ accepted: true, user: req.authSession?.user?.sub });
        },
      },
    ],
  },
})
class Server {}

declare function loadPdfBytes(id: string): Buffer;
declare function isValidSecret(secret: string): Promise<boolean>;
```

## What This Demonstrates

- Registering custom HTTP endpoints with `http.routes` — no tool/resource/prompt needed
- A POST endpoint that validates a user-entered secret server-side (the `/connect-env` pattern)
- Overriding the default `application/json` Content-Type for binary/HTML delivery
- Gating a route behind the MCP `session:verify` flow with `auth: true`
- Avoiding reserved paths (`/sse`, `/message`, `/oauth/*`, `/.well-known/*`, `/health`, `/metrics`)

## Gotchas

- Reserved paths fail-fast at startup: the resolved MCP entry path and its `/sse` + `/message` siblings, anything under `/oauth/*` and `/.well-known/*`, and `/health` + `/metrics`.
- For large payloads, prefer a custom GET route + a `resource_link` over a `@Resource` — a resource rides the JSON-RPC channel and is not out-of-band.
- A custom `hostFactory` owns its Express app (body limits, CORS, Content-Type defaults); `http.routes` and `bodyLimit` are consumed only by the built-in `ExpressHostAdapter`.

## Related

- See `configure-http` for the full HTTP configuration reference
- See `configure-auth-modes` for how `auth: true` behaves under each auth mode
