/**
 * LOCAL-mode auth server with CONSENT MODE enabled, for E2E testing.
 *
 * `auth.consent.enabled: true` (non-federated): `/oauth/authorize` renders the
 * simple login page, and after login `/oauth/callback` renders the TOOL CONSENT
 * SCREEN. Only the tools the user selects are embedded in the minted token's
 * `consent` claim, and the call-tool flow REJECTS any tool not in that set.
 *
 * `excludedTools: ['ping']` makes the `ping` tool always available (never
 * offered, never required) — exercising the exclusion contract end-to-end.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ConsentNotesApp } from './apps/consent';

const parsedPort = parseInt(process.env['PORT'] ?? '3158', 10);
const port = Number.isNaN(parsedPort) ? 3158 : parsedPort;

@FrontMcp({
  info: { name: 'Demo E2E Consent', version: '0.1.0' },
  apps: [ConsentNotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    consent: {
      enabled: true,
      groupByApp: true,
      showDescriptions: true,
      allowSelectAll: true,
      requireSelection: true,
      // Pin OFF so the existing consent assertions are deterministic: every
      // login (even repeated same-user logins) must re-show the consent screen.
      // The rememberConsent behavior is covered by main.consent-remember.ts.
      rememberConsent: false,
      // `ping` is always available: never shown on the consent screen and
      // never blocked at call time.
      excludedTools: ['ping'],
    },
    tokenStorage: 'memory',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    requireEmail: false,
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
