/**
 * Events server whose events come from background code: a worker on a timer, a worker that watches a folder
 * (`EVENTS_INBOX_DIR`) and a duty, whose lease lives in the folder the e2e sets (`FRONTMCP_HOME`). A workflow listens
 * to order.created on the server's event bus, where the events bridge emits each published event.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { EventsApp } from './apps/events';
import { SourcesApp } from './apps/sources';

const port = parseInt(process.env['PORT'] ?? '3151', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

@FrontMcp({
  info: { name: 'Demo E2E Event Sources', version: '0.1.0' },
  apps: [EventsApp, SourcesApp],
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
  jobs: { enabled: true },
  events: {
    // The receiver of the tests listens on 127.0.0.1 over http, which only this test option accepts
    webhook: { unsafeAllowLocalCallbacks: true, delivery: { backoffMs: 100 } },
  },
})
export default class Server {}
