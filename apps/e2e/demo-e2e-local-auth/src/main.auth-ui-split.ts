/**
 * `splitByApp` server proving PER-APP custom-auth-UI scoping (#469 follow-up).
 *
 * The single app declares its OWN `auth: { mode: 'local', ui: { login: './login.tsx' } }`
 * under `@App({ auth })`. Because each split-app scope builds its own
 * AuthUiRegistry from its own resolved auth options, the app's scoped
 * `/oauth/authorize` serves a thin shell + inline transpiled module for ITS
 * custom login (not the built-in page) — there is no top-level auth UI anywhere.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { SplitAuthUiApp } from './apps/auth-ui/split-auth-app';

const parsedPort = parseInt(process.env['PORT'] ?? '3172', 10);
const port = Number.isNaN(parsedPort) ? 3172 : parsedPort;

@FrontMcp({
  info: { name: 'Demo E2E Auth UI (split)', version: '0.1.0' },
  splitByApp: true,
  apps: [SplitAuthUiApp],
  logging: { level: LogLevel.Warn },
  http: { port },
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
