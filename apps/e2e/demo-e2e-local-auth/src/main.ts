/**
 * Single-operator LOCAL-mode auth server for E2E testing.
 *
 * This server signs its own tokens (`auth.mode: 'local'`) WITHOUT consent or
 * federated login — so `/oauth/authorize` renders the simple login page and
 * `/oauth/callback` mints an authorization code directly. It exercises the
 * recently-landed local-auth fixes:
 *
 *   - #466: a non-federated local login completes (mints a code, no 500)
 *   - #468: `requireEmail: false` mints a code WITHOUT an email, deriving a
 *           STABLE anonymous `sub` from `anonymousSubject`
 *   - #467: discovery docs advertise reachable, host-derived OAuth URLs at root
 *   - #473: `/oauth/token` accepts urlencoded (and hybrid Content-Type) bodies
 *   - #472/#458: `tokenStorage: { sqlite: { path } }` survives a server restart
 *
 * `tokenStorage` is selected from env so a single entry can be reused for both
 * the in-memory and the sqlite-restart-persistence scenarios:
 *   - TOKEN_STORAGE_SQLITE_PATH set  → `{ sqlite: { path } }` (persistent)
 *   - otherwise                      → 'memory' (default)
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { NotesApp } from './apps/notes';

const parsedPort = parseInt(process.env['PORT'] ?? '3155', 10);
const port = Number.isNaN(parsedPort) ? 3155 : parsedPort;

const sqlitePath = process.env['TOKEN_STORAGE_SQLITE_PATH'];
const tokenStorage = sqlitePath ? ({ sqlite: { path: sqlitePath } } as const) : ('memory' as const);

// Email opt-out is the focus of #468. Default to opted-out for this single
// operator server, but allow a test to force the historical require-email
// behavior via REQUIRE_EMAIL=true.
const requireEmail = process.env['REQUIRE_EMAIL'] === 'true';

@FrontMcp({
  info: { name: 'Demo E2E Local Auth', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    // No consent and no per-app providers → simple (non-federated) login page.
    tokenStorage,
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    // #468 — single-operator email opt-out + stable anonymous subject.
    requireEmail,
    anonymousSubject: 'local-operator',
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
