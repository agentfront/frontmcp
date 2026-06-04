/**
 * LOCAL-mode auth server with a CUSTOM `auth.ui.login` page and an
 * `auth.extras['envs:add']` handler, for the auth-UI E2E (#469 — map form).
 *
 * `/oauth/authorize` serves a thin shell (instead of the built-in HTML), injects
 * `window.__FRONTMCP_AUTH__`, inlines the developer's TRANSPILED React login
 * component as a `<script type="module">` (esm.sh import-map, no bundle), and
 * `@frontmcp/ui/auth`'s `mountAuthPage` renders it into the empty mount. An
 * extra submit to `/oauth/ui/extra` routes to the handler and accumulates items.
 *
 * The `auth.ui` path is RELATIVE and auto-anchored to THIS file's directory —
 * no manual path anchoring, no decorator, no class.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { addEnvExtra } from './apps/auth-ui/auth-ui.entries';
import { ConsentNotesApp } from './apps/consent';

const parsedPort = parseInt(process.env['PORT'] ?? '3171', 10);
const port = Number.isNaN(parsedPort) ? 3171 : parsedPort;

@FrontMcp({
  info: { name: 'Demo E2E Auth UI', version: '0.1.0' },
  apps: [ConsentNotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    tokenStorage: 'memory',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    // Single-operator: email is optional so the no-JS login submit can mint a code.
    requireEmail: false,
    anonymousSubject: 'local-operator',
    // #469 — custom auth UI as a slot→file map (relative path anchored to THIS
    // file) + an extras name→handler map. Per-app under splitByApp.
    ui: { login: './apps/auth-ui/login.tsx' },
    extras: { 'envs:add': addEnvExtra },
  },
  transport: {
    sessionMode: 'stateful',
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: false,
      strictSession: false,
    },
  },
})
export default class Server {}
