import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { EventsApp } from './apps/events';

const port = parseInt(process.env['PORT'] ?? '3150', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;
const sqlitePath = process.env['EVENTS_SQLITE_PATH'];
const backoffMs = parseInt(process.env['EVENTS_BACKOFF_MS'] ?? '100', 10);

@FrontMcp({
  info: { name: 'Demo E2E Events', version: '0.1.0' },
  apps: [EventsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'transparent',
    provider: idpProviderUrl,
    providerConfig: { name: 'mock-idp', dcrEnabled: false },
    expectedAudience,
    requiredScopes: [],
    allowAnonymous: true,
  },
  authorities: {
    claimsMapping: { roles: 'roles', tenantId: 'tenantId' },
    profiles: { admin: { roles: { any: ['admin'] } } },
  },
  events: {
    // A test that restarts the server keeps subscriptions and pending deliveries in a SQLite file
    store: sqlitePath ? { sqlite: { path: sqlitePath } } : undefined,
    // The receiver of the tests listens on 127.0.0.1 over http, which only this test option accepts
    webhook: { unsafeAllowLocalCallbacks: true, delivery: { backoffMs } },
  },
})
export default class Server {}
