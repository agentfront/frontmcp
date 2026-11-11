import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { EventsApp } from './apps/events';

const port = parseInt(process.env['PORT'] ?? '3150', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;
const sqlitePath = process.env['EVENTS_SQLITE_PATH'];
const backoffMs = parseInt(process.env['EVENTS_BACKOFF_MS'] ?? '100', 10);
const publishSecret = process.env['EVENTS_PUBLISH_SECRET'];
const publishAsAdmin = process.env['EVENTS_PUBLISH_BEARER'] === 'admin';

/** The HTTP publish endpoint a test asks for: signed requests, bearer callers with the admin role, or none. */
function publishEndpoint() {
  if (publishSecret) return { enabled: true, secret: publishSecret };
  return publishAsAdmin ? { enabled: true, authorities: 'admin' } : undefined;
}

const heartbeatMs = parseInt(process.env['EVENTS_HEARTBEAT_MS'] ?? '25000', 10);
const nextPollMs = parseInt(process.env['EVENTS_NEXT_POLL_MS'] ?? '30000', 10);

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
    // Every receiver of the tests is on 127.0.0.1, one host for the limit of verification attempts
    webhook: { unsafeAllowLocalCallbacks: true, delivery: { backoffMs }, verification: { maxAttemptsPerHost: 1000 } },
    publishEndpoint: publishEndpoint(),
    // A test of the heartbeat of a stream shortens it
    push: { heartbeatMs },
    // Tests of webhook delivery for an event with check() and of a polling client shorten the poll interval
    poll: { nextPollMs },
  },
})
export default class Server {}
