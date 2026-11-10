/**
 * Test-only server for the conformance specs: the events of the e2e app, plus test-only events and controls that make
 * the conditions a healthy server never produces (a failing or gapped upstream, revoked access). Timings are short so
 * heartbeats, re-authorization and the `check()` loop are seen within a test.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ConformanceApp } from './apps/conformance';
import { EventsApp } from './apps/events';

const port = parseInt(process.env['PORT'] ?? '3152', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;
const maxPerPrincipal = parseInt(process.env['EVENTS_MAX_PER_PRINCIPAL'] ?? '3', 10);
// A test of the callback rules starts a second server that keeps them, where local callbacks are refused
const allowLocalCallbacks = process.env['EVENTS_ALLOW_LOCAL_CALLBACKS'] !== 'false';
// A test of retention across a restart keeps subscriptions in a SQLite file, which allows a grant without expiry
const sqlitePath = process.env['EVENTS_SQLITE_PATH'];
// A test of the fallback starts a server without the extension
const eventsEnabled = process.env['EVENTS_ENABLED'] !== 'false';

/** The conformance server: transparent auth, so each test mints the principals it needs. */
@FrontMcp({
  info: { name: 'Demo E2E Events Conformance', version: '0.1.0' },
  apps: [EventsApp, ConformanceApp],
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
    enabled: eventsEnabled,
    store: sqlitePath ? { sqlite: { path: sqlitePath } } : undefined,
    subscriptions: { maxPerPrincipal, reauthorizeEveryMs: 300, allowNoExpiry: sqlitePath !== undefined },
    // The receiver of the tests listens on 127.0.0.1 over http, which only this test option accepts
    webhook: {
      unsafeAllowLocalCallbacks: allowLocalCallbacks,
      // Every receiver of the tests is on 127.0.0.1, one host for the limit of verification attempts
      verification: { maxAttemptsPerHost: 1000 },
      delivery: { backoffMs: 100, maxBackoffMs: 400, maxAttempts: 4 },
    },
    buffer: { maxEvents: 50 },
    push: { heartbeatMs: 400 },
    poll: { nextPollMs: 200, maxEvents: 25 },
  },
})
export default class Server {}
