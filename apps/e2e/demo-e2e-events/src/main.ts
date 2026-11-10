import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { EventsApp } from './apps/events';

const port = parseInt(process.env['PORT'] ?? '3150', 10);
const idpProviderUrl = process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com';
const expectedAudience = process.env['IDP_EXPECTED_AUDIENCE'] || idpProviderUrl;

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
  // The receiver of the tests listens on 127.0.0.1 over http, which only this test option accepts
  events: { webhook: { unsafeAllowLocalCallbacks: true } },
})
export default class Server {}
