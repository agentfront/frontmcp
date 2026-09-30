import { FrontMcp, LogLevel, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

import { ParentApp } from './apps/parent';

const port = parseInt(process.env['PORT'] ?? '3114', 10);

/**
 * E2E fixture for HTTP hardening (#646): security headers, `X-Powered-By`, and
 * the request body limit. Separate entry because the harness starts one server
 * per spec file and this one needs a tiny `bodyLimit`.
 */
@FrontMcp({
  info: { name: 'Demo E2E Hardening', version: '0.1.0' },
  apps: [ParentApp],
  logging: { level: LogLevel.Warn },
  http: {
    port,
    bodyLimit: '1kb',
    securityHeaders: {
      hsts: 'max-age=31536000',
      custom: { 'Referrer-Policy': 'no-referrer' },
    },
    routes: [
      {
        method: 'POST',
        path: '/custom/echo-size',
        handler: (req: ServerRequest, res: ServerResponse) => {
          res.status(200).json({ ok: true, keys: Object.keys((req.body as object | undefined) ?? {}).length });
        },
      },
    ],
  },
})
export default class Server {}
