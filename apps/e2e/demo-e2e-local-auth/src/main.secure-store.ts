/**
 * LOCAL-mode auth server exercising the general session secure-secret store
 * (#470) via `this.secureStore`.
 *
 * The backing is selected at boot from `SECURE_STORE_BACKING`:
 *   - `memory` (default): in-memory, AES-256-GCM-encrypted (lost on restart).
 *   - `sqlite`: local SQLite-file persistence (survives restart) at
 *     `SECURE_STORE_SQLITE_PATH`.
 *
 * The login uses a stable per-account subject derived from the `apiKey` field so
 * the SAME operator maps to the SAME `sub` across sessions — which lets the
 * sqlite e2e assert that a secret written in one session is readable in another.
 *
 * No PII — synthetic secrets only; the tool never returns the raw secret.
 */
import { FrontMcp, LogLevel, type SecureStoreConfig } from '@frontmcp/sdk';

import { SecureStoreApp } from './apps/secure-store';

const parsedPort = parseInt(process.env['PORT'] ?? '3159', 10);
const port = Number.isNaN(parsedPort) ? 3159 : parsedPort;

/** Fixed test secret the verifier checks against (synthetic, not a real key). */
const EXPECTED_API_KEY = 'sk-test-secure-store-secret';

/** Select the secure-store backing from the environment (default: memory). */
function resolveSecureStore(): SecureStoreConfig {
  const backing = process.env['SECURE_STORE_BACKING'] ?? 'memory';
  if (backing === 'sqlite') {
    const path = process.env['SECURE_STORE_SQLITE_PATH'] ?? '/tmp/frontmcp-secure-store-e2e.sqlite';
    return { sqlite: { path }, scope: 'user' };
  }
  return { scope: 'user' }; // in-memory, user-scoped (encrypted at rest)
}

@FrontMcp({
  info: { name: 'Demo E2E Local Auth (secure-store)', version: '0.1.0' },
  apps: [SecureStoreApp],
  logging: { level: process.env['SECURE_STORE_DEBUG'] === '1' ? LogLevel.Debug : LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    secureStore: resolveSecureStore(),
    login: {
      title: 'Sign in with your API key',
      fields: {
        apiKey: { type: 'password', label: 'API Key', required: true, placeholder: 'sk-...' },
      },
      // Stable subject per apiKey so the same operator maps to the same sub
      // across sessions (required for the sqlite persistence assertion).
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    authenticate: async (input) => {
      const apiKey = input.fields['apiKey'];
      if (apiKey !== EXPECTED_API_KEY) {
        return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
      }
      return { ok: true, claims: { tenantId: 'secure-store-corp' } };
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
