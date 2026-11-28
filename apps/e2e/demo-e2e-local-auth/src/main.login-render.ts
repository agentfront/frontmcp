/**
 * LOCAL-mode server whose sign-in page is a `login.render` page with its own
 * strict Content-Security-Policy (#1477).
 *
 * The page allows only `ctx.formTargets` beside `'self'` in `form-action`, so a
 * browser follows the callback's redirect back to the client. The secret is a
 * synthetic test value.
 */
import { escapeHtml } from '@frontmcp/auth';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { NotesApp } from './apps/notes';

const parsedPort = parseInt(process.env['PORT'] ?? '3173', 10);
const port = Number.isNaN(parsedPort) ? 3173 : parsedPort;

const DESK_KEY = 'desk-test-key';

@FrontMcp({
  info: { name: 'Demo E2E Local Auth (login.render)', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    requireRegisteredClients: false,
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    login: {
      fields: { deskKey: { type: 'password', label: 'Desk key', required: true } },
      render: (ctx) => `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'self' ${escapeHtml((ctx.formTargets ?? []).join(' '))}">
    <title>Desk sign-in</title>
  </head>
  <body>
    <h1>Sign in to ${escapeHtml(ctx.clientName)}</h1>
    ${ctx.error ? `<p role="alert">${escapeHtml(ctx.error)}</p>` : ''}
    <form method="POST" action="${escapeHtml(ctx.callbackPath)}">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(ctx.pendingAuthId)}">
      <label>Desk key <input type="password" name="deskKey" required></label>
      <button id="sign-in">Sign in</button>
    </form>
  </body>
</html>`,
    },
    authenticate: async ({ fields }) =>
      fields['deskKey'] === DESK_KEY ? { ok: true, sub: 'operator' } : { ok: false, message: 'Unknown desk key' },
  },
  transport: {
    sessionMode: 'stateful',
    protocol: { sse: true, streamable: true, json: true, stateless: false, legacy: false, strictSession: false },
  },
})
export default class Server {}
