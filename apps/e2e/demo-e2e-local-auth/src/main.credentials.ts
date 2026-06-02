/**
 * LOCAL-mode auth server exercising the per-session credential VAULT
 * (Checkpoint 3b).
 *
 * The custom `authenticate` verifier:
 *   - validates a single `apiKey` field (synthetic test secret), and
 *   - on success returns a per-session credential `{ key: 'acme', secret, metadata }`
 *     plus a `resume`-aware branch that ADDS a `globex` credential when the
 *     mid-session connect flow re-invokes it.
 *
 * The persisted credential is read back by the `read-credential` tool via
 * `this.credentials.get('acme')` over a real authenticated session. No PII —
 * synthetic secrets only.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { CredentialsApp } from './apps/credentials';

const parsedPort = parseInt(process.env['PORT'] ?? '3157', 10);
const port = Number.isNaN(parsedPort) ? 3157 : parsedPort;

/** Fixed test secret the verifier checks against (synthetic, not a real key). */
const EXPECTED_API_KEY = 'sk-test-credentials-secret';
/** The credential the verifier persists for the session on login. */
const ACME_SECRET = 'acme-token-abcdef123456';

@FrontMcp({
  info: { name: 'Demo E2E Local Auth (credentials)', version: '0.1.0' },
  apps: [CredentialsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    login: {
      title: 'Sign in with your API key',
      fields: {
        apiKey: { type: 'password', label: 'API Key', required: true, placeholder: 'sk-...' },
      },
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    authenticate: async (input) => {
      // Mid-session add-credential (resume) branch: ADD a globex credential.
      if (input.resume) {
        const connectKey = input.fields['apiKey'];
        if (connectKey !== EXPECTED_API_KEY) {
          return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
        }
        return {
          ok: true,
          credentials: [
            { key: input.resume.key, secret: `${input.resume.key}-secret-xyz`, metadata: { connected: true } },
          ],
        };
      }

      // Initial login branch.
      const apiKey = input.fields['apiKey'];
      if (apiKey !== EXPECTED_API_KEY) {
        return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
      }
      return {
        ok: true,
        claims: { tenantId: 'acme-corp' },
        // Persisted into the per-session credential vault, keyed by the minted sub.
        credentials: [{ key: 'acme', secret: ACME_SECRET, metadata: { baseUrl: 'https://acme.example' } }],
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
