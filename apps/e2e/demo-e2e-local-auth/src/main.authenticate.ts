/**
 * LOCAL-mode auth server with a CUSTOM `authenticate` verifier (Checkpoint 3a).
 *
 * Exercises the pluggable local-auth foundation end-to-end:
 *   - `login.fields` declares a single `apiKey` password field (replacing the
 *     default email/name form on the `/oauth/authorize` login page).
 *   - `authenticate` verifies the submitted `apiKey` against a fixed test secret
 *     and, on success, returns a stable `sub` plus a custom `tenantId` claim.
 *   - A wrong secret returns `{ ok: false }`, which re-renders the login page
 *     with the error instead of minting a code.
 *
 * The custom claim is asserted (over real HTTP) to be carried in the minted
 * access token. No PII is used — the secret/claim are synthetic test values.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { NotesApp } from './apps/notes';

const parsedPort = parseInt(process.env['PORT'] ?? '3156', 10);
const port = Number.isNaN(parsedPort) ? 3156 : parsedPort;

/** Fixed test secret the verifier checks against (synthetic, not a real key). */
const EXPECTED_API_KEY = 'sk-test-fixed-secret';

@FrontMcp({
  info: { name: 'Demo E2E Local Auth (authenticate)', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    // Declarative custom login field — an API key the operator pastes in.
    login: {
      title: 'Sign in with your API key',
      subtitle: 'Paste the test API key to continue',
      fields: {
        apiKey: { type: 'password', label: 'API Key', required: true, placeholder: 'sk-...' },
      },
      // Stable subject derived from the API key (same key → same sub).
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    // Custom verification step: validate the submitted apiKey and attach a claim.
    authenticate: async (input) => {
      const apiKey = input.fields['apiKey'];
      if (apiKey !== EXPECTED_API_KEY) {
        return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
      }
      return {
        ok: true,
        claims: { tenantId: 'acme-corp', plan: 'enterprise' },
      };
    },
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
