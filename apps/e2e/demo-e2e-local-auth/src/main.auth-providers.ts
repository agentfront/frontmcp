// A local-mode server whose authProvidersVault keeps credentials in its SQLite auth.tokenStorage
// (e2e/local-auth-auth-providers-storage.e2e.spec.ts). INSTANCE_NAME tells the credentials of each process apart.
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { AuthProvidersApp } from './apps/auth-providers';

const port = parseInt(process.env['PORT'] ?? '3160', 10);
const instanceName = process.env['INSTANCE_NAME'] ?? 'instance';
const apiKey = 'sk-test-auth-providers';

let acquisitions = 0;

@FrontMcp({
  info: { name: 'Demo E2E Local Auth (auth providers)', version: '0.1.0' },
  apps: [AuthProvidersApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    requireRegisteredClients: false,
    allowDefaultPublic: false,
    tokenStorage: { sqlite: { path: process.env['TOKEN_STORAGE_SQLITE_PATH'] ?? './auth-providers-e2e.sqlite' } },
    login: {
      title: 'Sign in with your API key',
      fields: { apiKey: { type: 'password', label: 'API Key', required: true } },
      subject: { fromField: 'apiKey', strategy: 'per-account' },
    },
    authenticate: async (input) =>
      input.fields['apiKey'] === apiKey
        ? { ok: true }
        : { ok: false, message: 'Invalid API key', retryField: 'apiKey' },
  },
  authProvidersVault: {
    useSharedStorage: process.env['AUTH_PROVIDERS_SHARED_STORAGE'] !== 'false',
    providers: [
      {
        name: 'github',
        scope: 'user',
        loading: 'lazy',
        factory: async () => ({ type: 'bearer', token: `github-${instanceName}-${++acquisitions}` }),
      },
    ],
  },
  transport: {
    protocol: { sse: true, streamable: true, json: true, stateless: false, legacy: false, strictSession: false },
  },
})
export default class Server {}
