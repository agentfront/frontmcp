/**
 * Demo server for PROGRESSIVE / INCREMENTAL authorization (orchestrated/local).
 *
 * `incrementalAuth.enabled: true` turns on app-level gating: the minted token
 * carries an `authorized_apps` claim, and a `tools/call` for an app NOT in that
 * claim throws AuthorizationRequiredError. An incremental authorize for that app
 * mints a fresh token whose claim is the UNION of the prior apps + the newly
 * authorized one, so the previously-403'd tool then succeeds — WITHOUT
 * re-authorizing the apps already granted.
 *
 * Consent is intentionally OFF here so the OAuth round-trip is the simple
 * login-page → callback → token path (no per-tool consent screen), keeping the
 * incremental round-trip focused.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

const port = parseInt(process.env['PORT'] ?? '3122', 10);

@FrontMcp({
  info: { name: 'Demo Incremental Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    // Progressive/Incremental authorization — opt-in. Enables app-level gating
    // and the incremental-authorize expansion path.
    incrementalAuth: {
      enabled: true,
      skippedAppBehavior: 'require-auth',
    },
    // Single-operator login with no email and no consent screen.
    requireEmail: false,
    tokenStorage: 'memory',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
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
