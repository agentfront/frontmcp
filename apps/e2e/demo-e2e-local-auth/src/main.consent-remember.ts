/**
 * LOCAL-mode auth server with CONSENT MODE + rememberConsent ENABLED, for E2E.
 *
 * Same as `main.consent.ts` but with `auth.consent.rememberConsent: true` so the
 * end-to-end "remember a prior selection" behavior can be exercised:
 *
 *  - First login for a (user, client): the tool CONSENT SCREEN is shown and the
 *    user submits a selection (persisted, keyed by `consent:{userSub}:{clientId}`).
 *  - Second login for the SAME user+client: the screen is SKIPPED and the minted
 *    token reuses the remembered selection (∩ available, + excludedTools).
 *  - A login after a NEW tool is added re-prompts PRE-FILLED with the prior
 *    selection (a newly-added tool is never silently granted).
 *
 * `excludedTools: ['ping']` keeps `ping` always available (never offered).
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ConsentNotesApp } from './apps/consent';

const parsedPort = parseInt(process.env['PORT'] ?? '3159', 10);
const port = Number.isNaN(parsedPort) ? 3159 : parsedPort;

@FrontMcp({
  info: { name: 'Demo E2E Consent Remember', version: '0.1.0' },
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
      // The behavior under test: reuse a prior per-(user, client) selection.
      rememberConsent: true,
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
